"""Role permission grants (Settings → Permissions): GET/PUT /settings/permissions.

Grants live in role_permissions and are read on every request (auth_context), so a saved change
applies to the next request of every session. Only the 48 configurable keys are editable; the
non-configurable protections of PERMISSIONS §4 are enforced here.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, validation
from app.domain.identity import ADMIN_LOCKOUT_GUARD, CONFIGURABLE_KEYS, PROTECTED, PermissionKey, RoleKey
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, now

_KEYS = sorted(k.value for k in CONFIGURABLE_KEYS)


def _role_rows(staff: StaffRepository) -> dict[RoleKey, Any]:
    rows = {key: staff.role(key) for key in RoleKey}
    if any(r is None for r in rows.values()):
        raise AppError("SETUP_REQUIRED", 409, "roles are not set up")
    return rows


def _snapshot(staff: StaffRepository, roles: dict[RoleKey, Any], *, lock: bool = False) -> dict[str, dict[str, bool]]:
    result = {}
    for key, row in roles.items():
        grants = staff.role_grants(row.id, lock=lock)
        result[key.value] = {k: bool(grants[k].granted) if k in grants else False for k in _KEYS}
    return result


def get_permissions(session: Session, actor: Actor) -> dict:
    actor.require(PermissionKey.STAFF_MANAGE_PERMISSIONS)
    staff = StaffRepository(session)
    return {"roles": _snapshot(staff, _role_rows(staff))}


def put_permissions(session: Session, actor: Actor, data: dict) -> dict:
    actor.require(PermissionKey.STAFF_MANAGE_PERMISSIONS)
    requested = data.get("roles") if isinstance(data, dict) else None
    if not isinstance(requested, dict) or not requested:
        raise validation("roles must be an object of role → {permission: granted}")
    staff, system = StaffRepository(session), SystemRepository(session)
    roles = _role_rows(staff)
    current = _snapshot(staff, roles, lock=True)

    changes: dict[str, dict[str, bool]] = {}
    for role_name, grants in requested.items():
        if role_name not in current:
            raise validation(f"unknown role {role_name}")
        if not isinstance(grants, dict):
            raise validation(f"{role_name} grants must be an object")
        unknown = [k for k in grants if k not in current[role_name]]
        if unknown:  # includes the non-configurable gap keys (PERMISSIONS §2.1)
            raise validation(f"not configurable: {', '.join(sorted(unknown))}")
        if any(not isinstance(v, bool) for v in grants.values()):
            raise validation("grant values must be true or false")
        diff = {k: v for k, v in grants.items() if current[role_name][k] != v}
        if diff:
            changes[role_name] = diff

    for role_name, diff in changes.items():
        # §4 item 3: no self-escalation — nobody edits their own role's grants.
        if role_name == actor.role.value:
            raise AppError("PERMISSION_DENIED", 403, "You cannot change the permissions of your own role")
        # §4 item 2: the Admin role keeps the keys that prevent lock-out.
        if role_name == RoleKey.ADMIN.value and any(k in diff and not diff[k] for k in (g.value for g in ADMIN_LOCKOUT_GUARD)):
            raise validation("Admin must keep Manage Permissions and View Settings")

    at = now()
    for role_name, diff in changes.items():
        role_id = roles[RoleKey(role_name)].id
        for key, granted in diff.items():
            staff.set_grant(role_id, key, granted, actor.user_id, at)
        protected_granted = sorted(k for k, v in diff.items() if v and PermissionKey(k) in PROTECTED)
        audit(system, actor, actor.business_id, "permissions.changed", "role", role_name,
              before={k: current[role_name][k] for k in diff},
              after={**diff, **({"protected_granted": protected_granted} if protected_granted else {})})

    return {"roles": _snapshot(staff, roles)}
