"""Audit log access (✱audit.view — Admin-only gap key until Q-SET-3; staff activity ✱staff.view)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import not_found
from app.domain.identity import PermissionKey
from app.models import AuditLogRow
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, parse_uuid

MAX_ROWS = 500


def _dtos(session: Session, actor: Actor, rows: list[AuditLogRow]) -> list[dict[str, Any]]:
    names = {u.id: u.full_name for u in StaffRepository(session).users(actor.business_id)}
    return [{"id": str(r.id), "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
             "actor_id": str(r.actor_id) if r.actor_id else None,
             "actor_name": names.get(r.actor_id) if r.actor_id else None,
             "before": r.before, "after": r.after, "created_at": r.created_at} for r in rows]


def list_audit(session: Session, actor: Actor, entity_type: str | None = None, action: str | None = None,
               limit: int = 100) -> list[dict[str, Any]]:
    actor.require(PermissionKey.AUDIT_VIEW)
    rows = SystemRepository(session).audit_logs(actor.business_id, entity_type=entity_type or None,
                                                action=action or None, limit=max(1, min(int(limit), MAX_ROWS)))
    return _dtos(session, actor, rows)


def staff_activity(session: Session, actor: Actor, user_id: str) -> list[dict[str, Any]]:
    """GET /staff/{id}/activity: what the user did, and what was done to their account."""
    actor.require(PermissionKey.STAFF_VIEW)
    uid = parse_uuid(user_id, "staff member")
    row = StaffRepository(session).user(uid)
    if row is None or row.business_id != actor.business_id:
        raise not_found("staff member")
    return _dtos(session, actor, SystemRepository(session).audit_logs(actor.business_id, involving_user=uid, limit=20))
