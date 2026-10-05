"""Refunds (Q-REF-1, Q-REF-4; BUSINESS-RULES §10).

Implemented: FULL and PARTIAL refunds of completed orders — each a separate immutable record
allocated to completed payments; the order, payments and document snapshot are never edited; the
sales document status becomes ``partially_refunded`` / ``refunded``.
- PARTIAL (Q-REF-5, decided in the hardening release — DECISIONS.md): a money amount (2 dp,
  > 0, ≤ refundable). It is allocated to completed payments newest first, never more than a
  payment's unrefunded amount (Q-REF-2 allocation). Line-level partial refunds are not offered.
- How money is returned stays ⚠ OPEN Q-REF-2 → ``refunds.method`` stays null (same as the payment).
- Restock (Q-REF-3, decided): never — a sold drink/food item was prepared and its ingredients used.
- Refund document numbering ⚠ VR-3 → no refund document is issued automatically.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from decimal import Decimal, InvalidOperation

from app.core.exceptions import AppError, validation
from app.domain.money import Money
from app.domain.identity import PermissionKey
from app.domain.refund import Refund, RefundAllocation, RefundKind
from app.repositories.document_repository import DocumentRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, feature_on, idempotent, now
from app.services.order_service import _load, order_dto


def _amount(value: Any, currency: str) -> Money:
    if value is None or isinstance(value, (bool, float)):
        raise validation("a partial refund needs an amount (decimal string)")
    try:
        money = Money.of(Decimal(str(value)), currency)
    except (InvalidOperation, ValueError, Exception) as exc:
        raise validation("amount must be a decimal with at most 2 places") from exc
    if not money.is_positive:
        raise validation("refund amount must be greater than 0")
    return money


def _allocate_newest_first(order, amount: Money, methods) -> tuple[RefundAllocation, ...]:  # type: ignore[no-untyped-def]
    """Q-REF-2 allocation: newest completed payment first, capped by each payment's unrefunded amount."""
    remaining, result = amount, []
    for payment in sorted((p for p in order.payments if p.status.value == "completed"),
                          key=lambda p: p.created_at, reverse=True):
        if remaining.is_zero:
            break
        free = order.unrefunded_amount_of(payment.id)
        if not free.is_positive:
            continue
        take = free if free < remaining else remaining
        result.append(RefundAllocation(payment.id, take, methods[payment.id]))
        remaining = remaining - take
    if not remaining.is_zero:
        raise validation("refund amount exceeds what the payments can return")
    return tuple(result)


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
        row, order = _load(session, actor, order_id, lock=True)
        methods = {p.id: p.method for p in order.payments}
        with domain_errors():
            if kind is RefundKind.PARTIAL:
                amount = _amount(data.get("amount"), actor.currency)
                if amount > order.refundable_amount:
                    raise validation(f"refund amount exceeds the refundable {order.refundable_amount.amount}")
                allocations = _allocate_newest_first(order, amount, methods)
            else:
                amount = order.refundable_amount
                allocations = tuple(RefundAllocation(pid, a, methods[pid]) for pid, a in order.full_refund_allocations())
            if not allocations:
                raise validation("nothing left to refund")
            doc_row = DocumentRepository(session).for_order(row.id)
            refund = Refund(id=str(uuid.uuid4()), order_id=order.id, kind=kind, amount=amount,
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
              after={"refund_id": refund.id, "amount": str(refund.amount.amount), "kind": kind.value,
                     "reason": refund.reason, "allocations": [{"payment_id": a.payment_id, "amount": str(a.amount.amount),
                                                               "method": a.method.value} for a in refund.allocations],
                     "refund_status": status.value})
        emit(system, actor, actor.business_id, "refund.recorded", "refund", refund.id, 1, {"order_id": order.id})
        return 201, order_dto(order)

    return idempotent(session, actor.business_id, f"refund:{order_id}", idempotency_key, data, run)
