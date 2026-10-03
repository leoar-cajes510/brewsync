"""Refunds (Q-REF-1, Q-REF-4; BUSINESS-RULES §10).

Implemented: FULL refunds of completed orders — a separate immutable record allocated to
each completed payment's unrefunded amount; the order, payments and document snapshot are
never edited; the sales document status becomes ``refunded``.
Blocked with DECISION_PENDING (never guessed):
- PARTIAL refunds: granularity ⚠ OPEN Q-REF-5 and allocation across split payments Q-REF-2.
- How money is returned (refund method / time limit) ⚠ OPEN Q-REF-2 → ``refunds.method`` stays null.
- Restock on refund ⚠ OPEN Q-REF-3 → never restocked.
- Refund document numbering ⚠ VR-3 → no refund document is issued automatically.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, validation
from app.domain.identity import PermissionKey
from app.domain.refund import Refund, RefundAllocation, RefundKind
from app.repositories.document_repository import DocumentRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, feature_on, idempotent, now
from app.services.order_service import _load, order_dto


def record_refund(session: Session, actor: Actor, order_id: str, data: dict[str, Any],
                  idempotency_key: str | None) -> tuple[int, dict]:
    actor.require(PermissionKey.POS_PROCESS_REFUNDS)
    terminal_id = actor.require_terminal()
    system = SystemRepository(session)
    enabled = feature_on(system, actor.business_id, "refunds")

    def run() -> tuple[int, dict]:
        try:
            kind = RefundKind(data.get("kind"))
        except ValueError as exc:
            raise validation("kind must be 'full' or 'partial'") from exc
        if kind is RefundKind.PARTIAL:
            raise AppError("DECISION_PENDING", 409,
                           "Partial refund granularity (Q-REF-5) and allocation across split payments (Q-REF-2) are OPEN",
                           {"question_id": "Q-REF-5"})
        row, order = _load(session, actor, order_id, lock=True)
        methods = {p.id: p.method for p in order.payments}
        with domain_errors():
            allocations = tuple(RefundAllocation(pid, amount, methods[pid]) for pid, amount in order.full_refund_allocations())
            if not allocations:
                raise validation("nothing left to refund")
            doc_row = DocumentRepository(session).for_order(row.id)
            refund = Refund(id=str(uuid.uuid4()), order_id=order.id, kind=kind, amount=order.refundable_amount,
                            reason=str(data.get("reason", "")), allocations=allocations, user_id=str(actor.user_id),
                            terminal_id=str(terminal_id), idempotency_key=idempotency_key or "", created_at=now(),
                            document_id=str(doc_row.id) if doc_row else None)
            status = order.add_refund(refund, refunds_enabled=enabled)
        OrderRepository(session).save(row, order)
        if doc_row is not None:
            doc = DocumentRepository.to_domain(doc_row)
            with domain_errors():
                doc.mark_refunded(fully=status.value == "refunded")
            doc_row.status = doc.status.value
        audit(system, actor, actor.business_id, "refund.recorded", "order", order.id,
              after={"refund_id": refund.id, "amount": str(refund.amount.amount), "kind": kind.value})
        emit(system, actor, actor.business_id, "refund.recorded", "refund", refund.id, 1, {"order_id": order.id})
        return 201, order_dto(order)

    return idempotent(session, actor.business_id, f"refund:{order_id}", idempotency_key, data, run)
