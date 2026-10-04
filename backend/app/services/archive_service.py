"""Archiving (Q-ARC-1, Q-ARC-2, Q-ARC-4; BUSINESS-RULES §12). Timing/window come from the
Admin-configured ``archiving`` settings (no defaults — Q-SET-4). ``app.services.archive_scheduler``
calls ``run_auto_archive`` when the deployment enables it."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import validation
from app.domain.archive import ArchiveMethod, ArchivePolicy
from app.domain.identity import PermissionKey
from app.repositories.order_repository import OrderRepository
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, now, section
from app.services.order_service import _load, order_dto


def _policy(system: SystemRepository, business_id) -> ArchivePolicy:  # type: ignore[no-untyped-def]
    data = section(system, business_id, "archiving") or {}
    with domain_errors():
        return ArchivePolicy(auto_archive_after=timedelta(hours=data["auto_archive_after_hours"]),
                             restore_window=timedelta(hours=data["restore_window_hours"]))


def archive_orders(session: Session, actor: Actor, order_ids: list[str], reason: str) -> list[dict[str, Any]]:
    """POST /archive: permission is checked even for an empty request, which is refused."""
    actor.require(PermissionKey.ARCHIVE_MANAGE)
    if not order_ids:
        raise validation("order_ids must list at least one order")
    return [archive_order(session, actor, oid, reason) for oid in order_ids]


def archive_order(session: Session, actor: Actor, order_id: str, reason: str) -> dict[str, Any]:
    actor.require(PermissionKey.ARCHIVE_MANAGE)
    row, order = _load(session, actor, order_id, lock=True)
    with domain_errors():
        order.archive(now(), ArchiveMethod.MANUAL, by=str(actor.user_id), reason=reason)
    OrderRepository(session).save(row, order)
    system = SystemRepository(session)
    audit(system, actor, actor.business_id, "order.archived", "order", order.id, after={"reason": reason})
    emit(system, actor, actor.business_id, "order.archived", "order", order.id, order.version, {"method": "manual"})
    return order_dto(order)


def restore_order(session: Session, actor: Actor, order_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.ARCHIVE_MANAGE)
    system = SystemRepository(session)
    policy = _policy(system, actor.business_id)
    row, order = _load(session, actor, order_id, lock=True)
    with domain_errors():
        order.restore(now(), by=str(actor.user_id), policy=policy)
    OrderRepository(session).save(row, order)
    audit(system, actor, actor.business_id, "order.restored", "order", order.id)
    emit(system, actor, actor.business_id, "order.restored", "order", order.id, order.version, {})
    return order_dto(order)


def list_archive(session: Session, actor: Actor) -> dict[str, list[dict[str, Any]]]:
    actor.require(PermissionKey.ARCHIVE_MANAGE)
    repo = OrderRepository(session)
    names = {str(u.id): u.full_name for u in StaffRepository(session).users(actor.business_id)}
    archived = [{**order_dto(o), "archived_by_name": names.get(o.archived_by) if o.archived_by else None}
                for o in repo.to_domain_many(
                    repo.list(actor.business_id, statuses=["completed", "cancelled"], archived=True), actor.currency)]
    cancelled_review = [order_dto(o) for o in repo.to_domain_many(
        repo.list(actor.business_id, statuses=["cancelled"], archived=False), actor.currency)]
    return {"archived": archived, "cancelled_review": cancelled_review}


def run_auto_archive(session: Session, business_id, at: datetime | None = None) -> int:  # type: ignore[no-untyped-def]
    """Archive completed orders past the configured timing (system actor). Cancelled orders are
    never auto-archived. Returns the number archived."""
    system, repo = SystemRepository(session), OrderRepository(session)
    policy = _policy(system, business_id)
    at = at or now()
    business = system.business()
    assert business is not None
    count = 0
    rows = repo.list(business_id, statuses=["completed"], archived=False, limit=1000)
    for r, order in zip(rows, repo.to_domain_many(rows, business.currency_code)):
        if order.is_auto_archive_eligible(at, policy):
            locked_row, order = repo.load(r.id, business.currency_code, lock=True)  # type: ignore[misc]
            with domain_errors():
                order.archive(at, ArchiveMethod.AUTO, by=None, policy=policy)
            repo.save(locked_row, order)
            system.audit(business_id=business_id, actor_id=None, action="order.auto_archived", entity_type="order",
                         entity_id=order.id, at=at)
            system.append_event(business_id=business_id, type="order.archived", entity_type="order",
                                entity_id=order.id, entity_version=order.version, actor_id=None, terminal_id=None,
                                payload={"method": "auto"}, at=at)
            count += 1
    return count
