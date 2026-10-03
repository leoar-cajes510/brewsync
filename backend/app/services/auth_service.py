"""Authentication & sessions (Q-AUTH-2, Q-AUTH-4, Q-TRM-1; BUSINESS-RULES §14).

- Admin: username + password. Cashier: username + the account's method (password or PIN).
- Credentials are Argon2-hashed; failed attempts and lockout use the owner-configured policy.
- Sessions are opaque bearer tokens (only a SHA-256 digest is stored) and are ended by the
  server after the configured idle timeout; background requests do not extend them.
- Every sign-in needs an activated terminal (device credential) — interim for Q-TRM-8, with an
  explicit deployment flag for Admin back-office sign-in (see core/config.py).
- Concurrent sessions per user (Q-AUTH-6) are not restricted (no policy invented).
"""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError, settings_required, validation
from app.core.security import hash_credential, new_token, token_digest, verify_credential
from app.domain.errors import AccountInactive, AccountLocked, AuthMethodNotAllowed, SessionExpired
from app.domain.identity import AuthMethod, PermissionKey, RoleKey, SessionEndReason
from app.models import SessionRow, TerminalRow, UserRow
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, emit, now, section
from app.services.settings_service import security_settings
from app.services.setup_service import require_completed

GENERIC_FAILURE = "Invalid username or credential"


def _fail() -> AppError:
    return AppError("UNAUTHENTICATED", 401, GENERIC_FAILURE)


def resolve_terminal(staff: StaffRepository, device_credential: str | None):  # type: ignore[no-untyped-def]
    if not device_credential:
        return None
    row = staff.terminal_by_credential(token_digest(device_credential))
    if row is None or row.status != "active":
        raise AppError("TERMINAL_NOT_ACTIVATED", 403, "Device is not an activated terminal")
    return row


def _terminal_required() -> AppError:
    return AppError("TERMINAL_NOT_ACTIVATED", 403,
                    "Sign-in requires an activated terminal (first-device behaviour is OPEN: Q-TRM-8)",
                    {"question_id": "Q-TRM-8"})


def login(session: Session, username: str, credential: str, device_credential: str | None) -> dict[str, Any]:
    """Returns the session token. Failed attempts are committed before the error is raised."""
    require_completed(session)
    system, staff = SystemRepository(session), StaffRepository(session)
    business = system.business()
    assert business is not None
    terminal = resolve_terminal(staff, device_credential)
    interim = get_settings().interim_admin_login_without_terminal
    # AUTH-04: the answer must not depend on whether the username exists. Without an activated
    # terminal (and without the interim flag) every attempt gets the same 403, before any lookup.
    if terminal is None and not interim:
        raise _terminal_required()
    row = staff.user_by_username(business.id, (username or "").strip().lower(), lock=True)
    if row is None:
        raise _fail()
    user = staff.to_domain_user(row)
    _, policy, _ = security_settings(section(system, business.id, "security") or {})
    at = now()
    try:
        user.ensure_can_sign_in(at, user.auth_method)
    except AccountLocked as exc:
        raise AppError("ACCOUNT_LOCKED", 423, "Account is temporarily locked") from exc
    except AccountInactive as exc:
        raise AppError("UNAUTHENTICATED", 401, "Account inactive") from exc
    stored = row.password_hash if user.auth_method is AuthMethod.PASSWORD else row.pin_hash
    if not verify_credential(credential or "", stored):
        locked = user.record_failed_sign_in(at, policy)
        staff.apply_user(row, user)
        audit(system, None, business.id, "auth.lockout" if locked else "auth.failed", "user", row.id,
              after={"terminal_id": str(terminal.id) if terminal else None})
        session.commit()  # keep the failure count even though the request fails
        raise AppError("ACCOUNT_LOCKED", 423, "Account is temporarily locked") if locked else _fail()
    if terminal is None and user.role is not RoleKey.ADMIN:
        # Interim flag: only Admins may sign in without a terminal; checked after the credential
        # so a wrong password and an unknown user get the same generic 401.
        raise _terminal_required()
    user.record_successful_sign_in()
    staff.apply_user(row, user)
    token = new_token("bss")
    srow = SessionRow(user_id=row.id, terminal_id=terminal.id if terminal else None, token_hash=token_digest(token),
                      started_at=at, last_activity_at=at)
    session.add(srow)
    row.last_active_at = at
    if terminal is not None:
        terminal.last_seen_at = at
    session.flush()
    audit(system, None, business.id, "auth.login", "session", srow.id,
          after={"user_id": str(row.id), "terminal_id": str(terminal.id) if terminal else None})
    emit(system, None, business.id, "session.started", "session", srow.id, 1, {"user_id": str(row.id)})
    return {"token": token, "token_type": "bearer", "user": {"id": str(row.id), "username": row.username,
            "full_name": row.full_name, "role": user.role.value, "must_change_credential": row.must_change_credential},
            "terminal_id": str(terminal.id) if terminal else None}


def authenticate(session: Session, token: str | None, *, user_initiated: bool = True) -> Actor:
    """Resolve the bearer token, enforce the idle timeout server-side and load permissions."""
    if not token:
        raise AppError("UNAUTHENTICATED", 401, "Missing bearer token")
    require_completed(session)
    staff = StaffRepository(session)
    # One query loads everything below live (nothing cached); the session row stays locked as before.
    ctx = staff.auth_context(token_digest(token))
    if ctx is None:
        raise AppError("UNAUTHENTICATED", 401, "Invalid session")
    srow, user, role, business, terminal, security_data, granted = ctx
    if srow.ended_at is not None and srow.end_reason != "idle_timeout":
        raise AppError("UNAUTHENTICATED", 401, "Session ended")  # logout/lock/forced/... (API §1.8)
    if security_data is None:
        raise settings_required("security")
    security, _, _ = security_settings(dict(security_data))
    domain_session = staff.to_domain_session(srow)
    try:
        domain_session.touch(now(), security.idle_timeout_minutes, user_initiated=user_initiated)
    except SessionExpired as exc:
        staff.apply_session(srow, domain_session)
        session.commit()  # persist the idle-timeout end
        raise AppError("SESSION_EXPIRED", 401, str(exc)) from exc
    staff.apply_session(srow, domain_session)
    if user.status != "active":
        raise AppError("UNAUTHENTICATED", 401, "Account inactive")
    return Actor(user_id=user.id, business_id=business.id, currency=business.currency_code,
                 role=RoleKey(role.key), permissions=granted, session_id=srow.id,
                 terminal_id=srow.terminal_id, full_name=user.full_name,
                 must_change_credential=user.must_change_credential,
                 # rows loaded above, reused by me() within this request (the ORM only holds them weakly)
                 extra={"user_row": user, "terminal_row": terminal})


def end_session(session: Session, actor: Actor, reason: SessionEndReason) -> None:
    staff, system = StaffRepository(session), SystemRepository(session)
    srow = session.get(SessionRow, actor.session_id)
    assert srow is not None
    domain_session = staff.to_domain_session(srow)
    domain_session.end(reason, now())
    staff.apply_session(srow, domain_session)
    audit(system, actor, actor.business_id, f"auth.{reason.value}", "session", srow.id)
    emit(system, actor, actor.business_id, "session.ended", "session", srow.id, 2, {"reason": reason.value})


def change_credential(session: Session, actor: Actor, current: str, new: str, method: AuthMethod) -> None:
    """A user changes their own credential (their account's method only)."""
    staff, system = StaffRepository(session), SystemRepository(session)
    row = staff.user(actor.user_id, lock=True)
    assert row is not None
    user = staff.to_domain_user(row)
    if method is not user.auth_method:
        raise AppError("AUTH_METHOD_NOT_ALLOWED", 422, "This account uses a different sign-in method")
    stored = row.password_hash if method is AuthMethod.PASSWORD else row.pin_hash
    if not verify_credential(current or "", stored):
        # Not 401: the session is valid, and 401 UNAUTHENTICATED ends the client session (SET-ACC-02).
        raise AppError("VALIDATION_ERROR", 422, "Current credential is incorrect")
    _, _, lengths = security_settings(section(system, actor.business_id, "security") or {})
    validate_credential(method, new, lengths)
    if method is AuthMethod.PASSWORD:
        row.password_hash = hash_credential(new)
    else:
        row.pin_hash = hash_credential(new)
    row.must_change_credential, row.credential_set_at = False, now()
    audit(system, actor, actor.business_id, "auth.credential_changed", "user", row.id, after={"method": method.value})


def validate_credential(method: AuthMethod, value: str, lengths: dict) -> None:
    """Owner-configured values (Q-AUTH-7 open — no built-in policy)."""
    if method is AuthMethod.PASSWORD:
        if len(value or "") < lengths["min_password_length"]:
            raise validation(f"password must have at least {lengths['min_password_length']} characters")
    else:
        if not (value or "").isdigit() or len(value) != lengths["pin_length"]:
            raise validation(f"PIN must be exactly {lengths['pin_length']} digits")


def ensure_method_allowed(role: RoleKey, method: AuthMethod) -> None:
    if role is RoleKey.ADMIN and method is not AuthMethod.PASSWORD:
        raise AppError("AUTH_METHOD_NOT_ALLOWED", 422, "Admin accounts must use password authentication")


_ = (uuid, AuthMethodNotAllowed)


def me(session: Session, actor: Actor) -> dict[str, Any]:
    """The caller's own account (never credential hashes)."""
    # Reuse the rows authenticate() loaded in this request; fall back to a lookup otherwise.
    row = actor.extra.get("user_row") or session.get(UserRow, actor.user_id)
    assert row is not None
    terminal = actor.extra.get("terminal_row") if "terminal_row" in actor.extra else (
        session.get(TerminalRow, actor.terminal_id) if actor.terminal_id else None)
    return {"user_id": str(actor.user_id), "code": row.code, "username": row.username, "full_name": row.full_name,
            "role": actor.role.value, "auth_method": row.auth_method, "permissions": sorted(actor.permissions),
            "terminal_id": str(actor.terminal_id) if actor.terminal_id else None,
            "terminal_code": terminal.code if terminal else None, "terminal_name": terminal.name if terminal else None,
            "must_change_credential": actor.must_change_credential}


def update_me(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """PATCH /auth/me: the caller edits their own display name only (✱settings.account)."""
    actor.require(PermissionKey.SETTINGS_ACCOUNT)
    staff = StaffRepository(session)
    row = staff.user(actor.user_id, lock=True)
    assert row is not None
    name = str(data.get("full_name", "")).strip()
    if not name or len(name) > 120:
        raise AppError("VALIDATION_ERROR", 422, "full name is required (max 120 characters)")
    before = row.full_name
    row.full_name = name
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "account.updated", "user", row.id,
          before={"full_name": before}, after={"full_name": name})
    actor = replace(actor, full_name=name)
    return me(session, actor)
