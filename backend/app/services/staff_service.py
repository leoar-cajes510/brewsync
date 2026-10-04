"""Staff accounts (BUSINESS-RULES §13–§14; PERMISSIONS §4)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.core.security import hash_credential
from app.domain.identity import AuthMethod, PermissionKey, RoleKey, SessionEndReason, User
from app.models import UserRow
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.auth_service import ensure_method_allowed, validate_credential
from app.services.base import Actor, audit, domain_errors, emit, now, parse_uuid, section, text
from app.services.settings_service import security_settings


def user_dto(row: UserRow, role: str) -> dict[str, Any]:
    """Never includes credential hashes."""
    return {"id": str(row.id), "code": row.code, "username": row.username, "full_name": row.full_name, "role": role,
            "auth_method": row.auth_method, "status": row.status, "must_change_credential": row.must_change_credential}


def list_staff(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.STAFF_VIEW)
    staff = StaffRepository(session)
    return [user_dto(r, staff.role_by_id(r.role_id).key) for r in staff.users(actor.business_id)]


def create_staff(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """Create an account with an initial credential set by the Admin; the user must change it."""
    actor.require(PermissionKey.STAFF_ADD)
    staff, system = StaffRepository(session), SystemRepository(session)
    try:
        role_key, method = RoleKey(data.get("role")), AuthMethod(data.get("auth_method"))
    except ValueError as exc:
        raise validation("role must be admin/cashier and auth_method password/pin") from exc
    if role_key is RoleKey.ADMIN:
        actor.require(PermissionKey.STAFF_MANAGE_PERMISSIONS)
    ensure_method_allowed(role_key, method)
    staffing = section(system, actor.business_id, "staffing") or {}
    role_row = staff.role(role_key)
    assert role_row is not None
    if staff.count_users(actor.business_id) >= staffing["max_staff"]:
        raise AppError("LIMIT_REACHED", 409, "Maximum staff accounts reached")
    if role_key is RoleKey.ADMIN and staff.count_users(actor.business_id, role_row.id) >= staffing["max_admins"]:
        raise AppError("LIMIT_REACHED", 409, "Maximum administrators reached")
    _, _, lengths = security_settings(section(system, actor.business_id, "security") or {})
    credential = text(data.get("credential", ""), "credential")
    validate_credential(method, credential, lengths)
    username = text(data.get("username", ""), "username").strip().lower()
    if staff.user_by_username(actor.business_id, username):
        raise AppError("CONFLICT", 409, "Username already exists")
    with domain_errors():
        user = User(id="new", code=f"STF-{system.next_value(actor.business_id, 'staff'):02d}", username=username,
                    full_name=text(data.get("full_name", ""), "full_name"), role=role_key, auth_method=method,
                    must_change_credential=True)
    hashed = hash_credential(credential)
    row = UserRow(business_id=actor.business_id, code=user.code, username=user.username, full_name=user.full_name,
                  role_id=role_row.id, auth_method=method.value, status="active", must_change_credential=True,
                  password_hash=hashed if method is AuthMethod.PASSWORD else None,
                  pin_hash=hashed if method is AuthMethod.PIN else None, credential_set_at=now(), failed_attempts=0)
    session.add(row)
    session.flush()
    audit(system, actor, actor.business_id, "staff.created", "user", row.id,
          after={"role": role_key.value, "auth_method": method.value})
    emit(system, actor, actor.business_id, "staff.status_changed", "user", row.id, 1, {"status": "active"})
    return user_dto(row, role_key.value)


def _load_user(staff: StaffRepository, actor: Actor, user_id: str) -> UserRow:
    row = staff.user(parse_uuid(user_id, "user"), lock=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("user")
    return row


def _guard_last_admin(staff: StaffRepository, actor: Actor, row: UserRow) -> None:
    """The last active Admin can be neither deactivated nor demoted (PERMISSIONS §4)."""
    admin = staff.role(RoleKey.ADMIN)
    assert admin is not None
    if row.role_id == admin.id and row.status == "active" and staff.count_users(actor.business_id, admin.id) <= 1:
        raise AppError("PERMISSION_DENIED", 403, "The last active Admin cannot be deactivated or demoted")


def _guard_admin_limit(staff: StaffRepository, system: SystemRepository, actor: Actor) -> None:
    """Settings → Staffing → Max administrators also applies to promotions and reactivations."""
    staffing = section(system, actor.business_id, "staffing") or {}
    role_row = staff.role(RoleKey.ADMIN)
    assert role_row is not None
    if staff.count_users(actor.business_id, role_row.id) >= staffing["max_admins"]:
        raise AppError("LIMIT_REACHED", 409, "Maximum administrators reached")


def update_staff(session: Session, actor: Actor, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """PATCH /staff/{id}: full name (✱staff.edit) and role (✱staff.managePermissions). Username
    rename is ⚠ OPEN (Q-AUTH-5) and not accepted."""
    actor.require(PermissionKey.STAFF_EDIT)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = _load_user(staff, actor, user_id)
    if "username" in data and text(data["username"], "username").strip().lower() != row.username:
        raise AppError("DECISION_PENDING", 409, "Renaming a username is not decided yet", {"question_id": "Q-AUTH-5"})
    user = staff.to_domain_user(row)
    before_role = user.role.value
    if "full_name" in data:
        name = text(data["full_name"], "full_name").strip()
        if not name:
            raise validation("full name is required")
        row.full_name = name
    if "role" in data and data["role"] != user.role.value:
        actor.require(PermissionKey.STAFF_MANAGE_PERMISSIONS)
        try:
            new_role = RoleKey(data["role"])
        except ValueError as exc:
            raise validation("role must be admin or cashier") from exc
        if user.role is RoleKey.ADMIN:
            _guard_last_admin(staff, actor, row)
        with domain_errors():
            user.change_role(new_role, changed_by=str(actor.user_id))
        if new_role is RoleKey.ADMIN and user.is_active:
            _guard_admin_limit(staff, system, actor)
        staff.apply_user(row, user)
    session.flush()
    audit(system, actor, actor.business_id, "staff.updated", "user", row.id,
          before={"role": before_role}, after={"role": user.role.value, "full_name": row.full_name})
    return user_dto(row, user.role.value)


def set_staff_status(session: Session, actor: Actor, user_id: str, active: bool) -> dict[str, Any]:
    """POST /staff/{id}/activate|deactivate. Deactivation ends the user's sessions (user_deactivated)."""
    actor.require(PermissionKey.STAFF_DEACTIVATE)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = _load_user(staff, actor, user_id)
    user = staff.to_domain_user(row)
    if active == user.is_active:
        return user_dto(row, user.role.value)
    if active:
        staffing = section(system, actor.business_id, "staffing") or {}
        if staff.count_users(actor.business_id) >= staffing["max_staff"]:
            raise AppError("LIMIT_REACHED", 409, "Maximum staff accounts reached")
        if user.role is RoleKey.ADMIN:
            _guard_admin_limit(staff, system, actor)
        user.activate()
    else:
        _guard_last_admin(staff, actor, row)
        user.deactivate()
        for srow in staff.active_sessions_for_user(row.id):
            ds = staff.to_domain_session(srow)
            ds.end(SessionEndReason.USER_DEACTIVATED, now())
            staff.apply_session(srow, ds)
    staff.apply_user(row, user)
    audit(system, actor, actor.business_id, "staff.activated" if active else "staff.deactivated", "user", row.id)
    emit(system, actor, actor.business_id, "staff.status_changed", "user", row.id, 1, {"status": row.status})
    return user_dto(row, user.role.value)


def reset_credential(session: Session, actor: Actor, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """POST /staff/{id}/reset-credential: the Admin sets a temporary password or PIN (per the
    account's method); the user must change it at next sign-in. The value is never returned."""
    actor.require(PermissionKey.STAFF_RESET_PASSWORDS)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = _load_user(staff, actor, user_id)
    method = AuthMethod(row.auth_method)
    _, _, lengths = security_settings(section(system, actor.business_id, "security") or {})
    credential = text(data.get("credential", ""), "credential")
    validate_credential(method, credential, lengths)
    hashed = hash_credential(credential)
    if method is AuthMethod.PASSWORD:
        row.password_hash = hashed
    else:
        row.pin_hash = hashed
    row.must_change_credential, row.credential_set_at, row.failed_attempts, row.locked_until = True, now(), 0, None
    session.flush()
    audit(system, actor, actor.business_id, "staff.credential_reset", "user", row.id, after={"auth_method": method.value})
    return user_dto(row, staff.role_by_id(row.role_id).key)
