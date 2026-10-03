"""Refunds as separate immutable financial records (BUSINESS-RULES §10; Q-REF-1, Q-REF-4).

Still ⚠ OPEN and therefore NOT decided here:
- Q-REF-2 refund method, time limit and allocation across split payments — allocations
  must be supplied explicitly by the caller (``RefundAllocationStrategy`` has no default).
- Q-REF-3 restock on refund — ``restocked=True`` is rejected.
- Q-REF-5 partial refund granularity — the partial amount is computed by a
  ``PartialRefundAmountPolicy`` that does not exist yet; the domain only validates caps.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol

from .errors import UndecidedPolicy, ValidationError
from .money import Money, sum_money
from .payment import PaymentMethod


class RefundKind(StrEnum):
    FULL = "full"
    PARTIAL = "partial"


@dataclass(frozen=True, slots=True)
class RefundLine:
    """What is refunded (line + quantity). Its exact semantics depend on Q-REF-5."""

    order_item_id: str
    quantity: int

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValidationError("refund line quantity must be > 0")


@dataclass(frozen=True, slots=True)
class RefundAllocation:
    """Portion of the refund returned against one original payment. ``method`` is the method of
    that original payment; HOW the money is returned (refund method) is ⚠ OPEN (Q-REF-2)."""

    payment_id: str
    amount: Money
    method: PaymentMethod
    reference: str | None = None

    def __post_init__(self) -> None:
        self.amount.require_positive("allocation amount")


@dataclass(frozen=True, slots=True)
class Refund:
    id: str
    order_id: str
    kind: RefundKind
    amount: Money
    reason: str
    allocations: tuple[RefundAllocation, ...]
    user_id: str
    terminal_id: str
    idempotency_key: str
    created_at: datetime
    lines: tuple[RefundLine, ...] = ()
    document_id: str | None = None
    approved_by: str | None = None
    restocked: bool = False

    def __post_init__(self) -> None:
        self.amount.require_positive("refund amount")
        if not self.reason.strip():
            raise ValidationError("a refund reason is required")
        if not self.idempotency_key:
            raise ValidationError("idempotency key is required")
        if not self.allocations:
            raise ValidationError("a refund must be allocated to at least one payment")
        if sum_money([a.amount for a in self.allocations], self.amount.currency) != self.amount:
            raise ValidationError("refund allocations must sum to the refund amount")
        if len({a.payment_id for a in self.allocations}) != len(self.allocations):
            raise ValidationError("one allocation per payment")
        if len({l.order_item_id for l in self.lines}) != len(self.lines):
            raise ValidationError("one refund line per order item")
        if self.restocked:
            raise UndecidedPolicy("Q-REF-3", "whether refunded items are returned to stock")


class PartialRefundAmountPolicy(Protocol):
    """Extension point for Q-REF-5 (by line/quantity vs arbitrary amount). No implementation
    exists until the decision is made."""

    def amount_for(self, lines: tuple[RefundLine, ...]) -> Money: ...


class RefundAllocationStrategy(Protocol):
    """Extension point for Q-REF-2 (how a partial refund is spread across split payments)."""

    def allocate(self, amount: Money) -> tuple[RefundAllocation, ...]: ...
