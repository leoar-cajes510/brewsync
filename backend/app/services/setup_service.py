"""First-run setup wizard (Q-AUTH-1; BUSINESS-RULES §18).

Complete Setup is ONE atomic transaction: system data (roles, permission catalogue, default
grants), the owner-entered business row, the first Admin (owner-chosen password — no
default), the owner-chosen security settings, tax disabled (SR-9), a neutral default
document series per type, and setup_status = completed. Nothing else is seeded.
Wizard protection (Q-AUTH-8, approved): a deployment setup token is required. First device
(Q-TRM-8, approved option c): completing setup registers the first terminal and returns a
one-time, short-lived activation code (stored hashed) that the setup device uses immediately;
afterwards normal terminal authentication applies.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

import hmac

from app.core.config import get_settings
from app.core.exceptions import AppError, validation
from app.core.security import hash_credential
from app.domain.identity import (
    CASHIER_DEFAULT_GRANTS, AuthMethod, Business, PermissionKey, RoleGrants, RoleKey, SetupStatus, SystemState, User,
)
from app.domain.settings import SettingsSection
from app.models import (
    BusinessRow, DocumentSeriesRow, PermissionRow, RolePermissionRow, RoleRow, TerminalRow, UserRow,
)
from app.repositories.system_repository import SystemRepository
from app.services.base import audit, domain_errors, now
from app.services.settings_service import save_initial, security_settings

MIN_SETUP_TOKEN = 16
NEUTRAL_SERIES_TEMPLATE = "{number}"  # SR-9 default neutral series; real formats are compliance config ⚖ VR-3


def status(session: Session) -> dict[str, Any]:
    row = SystemRepository(session).system_state()
    return {"setup_status": row.setup_status if row else SetupStatus.NOT_STARTED.value}


def require_setup_token(presented: str | None) -> None:
    """Q-AUTH-8: setup actions need the installer's token (constant-time compare)."""
    expected = (get_settings().setup_token or "").strip()
    if len(expected) < MIN_SETUP_TOKEN:  # a short token is treated as not configured
        raise AppError("SETUP_TOKEN_NOT_CONFIGURED", 503,
                       "Setup is locked: the installer must set SETUP_TOKEN (at least 16 characters) on the server first")
    if not presented or not hmac.compare_digest(presented.encode(), expected.encode()):
        raise AppError("SETUP_TOKEN_INVALID", 403, "The setup token is missing or incorrect")


def _first_terminal(session: Session, system: SystemRepository, business_id: Any, data: dict[str, Any],
                    actor_id: Any) -> dict[str, Any]:
    """Register (or reuse) the first terminal and issue its one-time activation code."""
    from app.repositories.staff_repository import StaffRepository
    from app.services.terminal_service import _issue_code, terminal_dto
    staff = StaffRepository(session)
    code = str(data.get("code") or "REG-01").strip().upper()
    name = str(data.get("name") or "Main Terminal").strip()
    if not code or len(code) > 20 or not name or len(name) > 80:
        raise validation("first terminal code (≤ 20) and name (≤ 80) are required")
    row = staff.terminal_by_code(business_id, code, lock=True)
    if row is None:
        row = TerminalRow(business_id=business_id, code=code, name=name, status="pending_activation")
        session.add(row)
    elif row.status != "pending_activation":
        raise AppError("INVALID_TRANSITION", 409, f"terminal {code} is {row.status}")
    activation_code = _issue_code(row, get_settings().first_terminal_code_minutes)
    session.flush()
    audit(system, None, business_id, "terminal.registered", "terminal", row.id,
          after={"code": code, "first_terminal": True, "by": str(actor_id) if actor_id else None})
    return {**terminal_dto(row), "activation_code": activation_code, "activation_expires_at": row.activation_expires_at}


def reissue_first_terminal(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    """POST /setup/first-terminal (setup token): recover a lost/expired first-terminal code. Allowed
    only after setup and only while NO terminal is active, so it can never bypass an installed system."""
    from app.repositories.staff_repository import StaffRepository
    system = SystemRepository(session)
    state = system.system_state()
    if state is None or state.setup_status != SetupStatus.COMPLETED.value:
        raise AppError("SETUP_REQUIRED", 409, "Complete setup first")
    business = system.business()
    assert business is not None
    staff = StaffRepository(session)
    if staff.count_active_terminals(business.id) > 0:
        raise AppError("INVALID_TRANSITION", 409,
                       "A terminal is already active; an Admin issues further codes in Settings → Terminals")
    return _first_terminal(session, system, business.id, payload or {}, None)


def complete(session: Session, payload: dict[str, Any]) -> dict[str, Any]:
    system = SystemRepository(session)
    state_row = system.ensure_system_state()  # row-locked: concurrent completions serialize
    state = SystemState(SetupStatus(state_row.setup_status))
    with domain_errors():
        state.begin()  # raises SETUP_ALREADY_COMPLETED when done

    business_in = payload.get("business") or {}
    admin_in = payload.get("admin") or {}
    security_in = payload.get("security") or {}
    with domain_errors():
        business = Business(id="new", name=str(business_in.get("name", "")),
                            currency_code=str(business_in.get("currency_code", "")),
                            timezone=str(business_in.get("timezone", "")),
                            business_type=str(business_in.get("business_type", "")),
                            address=str(business_in.get("address", "")), phone=str(business_in.get("phone", "")),
                            email=str(business_in.get("email", "")))
        _, _, lengths = security_settings(security_in)
    password = str(admin_in.get("password", ""))
    if len(password) < lengths["min_password_length"]:
        raise validation(f"Admin password must have at least {lengths['min_password_length']} characters")

    at = now()
    biz = system.add(BusinessRow(name=business.name, business_type=business.business_type, address=business.address,
                                 phone=business.phone, email=business.email, currency_code=business.currency_code,
                                 timezone=business.timezone))
    # System data: roles, permission catalogue, default grants (allowed by SR-9).
    roles = {key: system.add(RoleRow(key=key.value, name=key.value.title(), is_system=True)) for key in RoleKey}
    for key in PermissionKey:
        session.add(PermissionRow(key=key.value, group=key.value.split(".")[0], label=key.value,
                                  protected=key not in CASHIER_DEFAULT_GRANTS))
    session.flush()
    for role_key, role_row in roles.items():
        granted = RoleGrants.defaults(role_key).granted
        for key in PermissionKey:
            session.add(RolePermissionRow(role_id=role_row.id, permission_key=key.value, granted=key in granted))

    with domain_errors():
        admin = User(id="new", code=f"STF-{system.next_value(biz.id, 'staff'):02d}",
                     username=str(admin_in.get("username", "")).strip().lower(), full_name=str(admin_in.get("full_name", "")),
                     role=RoleKey.ADMIN, auth_method=AuthMethod.PASSWORD)
    admin_row = system.add(UserRow(business_id=biz.id, code=admin.code, username=admin.username,
                                   full_name=admin.full_name, role_id=roles[RoleKey.ADMIN].id,
                                   auth_method=AuthMethod.PASSWORD.value, password_hash=hash_credential(password),
                                   status="active", must_change_credential=False, credential_set_at=at,
                                   failed_attempts=0))

    save_initial(system, biz.id, SettingsSection.SECURITY, security_in, admin_row.id)
    save_initial(system, biz.id, SettingsSection.TAX, {"enabled": False, "mode": "included", "name": "", "rate": None},
                 admin_row.id)
    optional = payload.get("settings") or {}
    for name, data in optional.items():
        try:
            section = SettingsSection(name)
        except ValueError as exc:
            raise validation(f"unknown settings section {name}") from exc
        if section in (SettingsSection.SECURITY, SettingsSection.PERMISSIONS, SettingsSection.DISCOUNTS):
            raise validation(f"{name} cannot be supplied here")
        with domain_errors():
            if section is SettingsSection.TAX:
                system.save_settings(biz.id, "tax", data, 2, admin_row.id)
            else:
                save_initial(system, biz.id, section, data, admin_row.id)

    for doc_type in ("sales", "refund"):
        system.add(DocumentSeriesRow(business_id=biz.id, document_type=doc_type, scope="business",
                                     format_template=NEUTRAL_SERIES_TEMPLATE, start_number=1, next_number=1,
                                     range_end=None, terminal_id=None, active=True))

    with domain_errors():
        state.complete(at=at, admin_user_id=str(admin_row.id))
    state_row.setup_status, state_row.completed_at, state_row.completed_by = state.setup_status.value, at, admin_row.id
    audit(system, None, biz.id, "setup.completed", "system_state", 1, after={"admin_user_id": str(admin_row.id)})
    session.flush()
    first = _first_terminal(session, system, biz.id, payload.get("first_terminal") or {}, admin_row.id)
    return {"setup_status": state_row.setup_status, "business_id": str(biz.id), "admin_user_id": str(admin_row.id),
            "first_terminal": first}


# Databases (url + schema) already seen with setup completed. Completion is one-way (no code path
# reverts it), so only that result is cached; an incomplete setup is re-checked on every call.
_completed: set[tuple[str, str]] = set()


def _db_key(session: Session) -> tuple[str, str]:
    bind = session.get_bind()
    schema = (bind.get_execution_options().get("schema_translate_map") or {}).get(None) or ""
    return bind.url.render_as_string(hide_password=True), schema


def reset_setup_cache() -> None:
    """Tests only: forget cached completion after the database is emptied outside the app."""
    _completed.clear()


def require_completed(session: Session) -> None:
    key = _db_key(session)
    if key in _completed:
        return
    row = SystemRepository(session).system_state()
    if row is None or row.setup_status != SetupStatus.COMPLETED.value:
        raise AppError("SETUP_REQUIRED", 409, "First-run setup has not been completed")
    _completed.add(key)
