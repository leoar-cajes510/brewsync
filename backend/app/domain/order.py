"""Order aggregate: lifecycle, frozen sale snapshots, payments, refunds, archive
(BUSINESS-RULES §1, §2, §7, §9–§12).

Order first, pay later (Q-ORD-1): orders exist unpaid; completion requires
payment_status = paid. Status, payment_status and refund_status are independent.

OPEN questions respected here (never silently decided):
- Q-ORD-2 editing after placement → ``apply_discount``/edits raise ``UndecidedPolicy``.
- Q-CAN-1 cancelling an order with completed payments → ``UndecidedPolicy``
  (matches the documented interim: reject).
- "Undo within the same shift": the shift boundary is undefined; the service must check it.
- Q-ORD-3 per-type status steps: one flow for all order types.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from enum import StrEnum

from .archive import ArchiveMethod, ArchivePolicy
from .discount import OrderDiscount
from .errors import (
    DiscountAlreadyApplied,
    DuplicateOperation,
    EmptyOrder,
    FeatureDisabled,
    InvalidPayment,
    InvalidStateTransition,
    OrderNotSettled,
    Overpayment,
    RefundExceedsPayment,
    RefundNotAllowed,
    RestoreWindowExpired,
    UndecidedPolicy,
    ValidationError,
    VersionConflict,
)
from .inventory import ReservationPlan
from .money import Money, sum_money
from .payment import Payment, PaymentRecordStatus
from .pricing import PricingResult, TaxBreakdownEntry
from .product import ChoiceGroup, ChoiceOption, Product
from .refund import Refund, RefundKind
from .tax import TaxClass, TaxMode

MAX_CANCEL_REASON = 200


class OrderStatus(StrEnum):
    PENDING = "pending"
    PREPARING = "preparing"
    READY = "ready"  # UI label "Ready for Pickup"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

    @property
    def is_active(self) -> bool:
        return self in (OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY)


class PaymentStatus(StrEnum):
    UNPAID = "unpaid"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"


class RefundStatus(StrEnum):
    NONE = "none"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"


class OrderOrigin(StrEnum):
    ONLINE = "online"
    OFFLINE = "offline"


class OrderType(StrEnum):
    DINE_IN = "dine_in"
    TAKEOUT = "takeout"
    DELIVERY = "delivery"


_STEP_FORWARD = {
    OrderStatus.PENDING: {OrderStatus.PREPARING, OrderStatus.READY},
    OrderStatus.PREPARING: {OrderStatus.READY},
}
_UNDO = {OrderStatus.PREPARING: OrderStatus.PENDING, OrderStatus.READY: OrderStatus.PREPARING}


@dataclass(frozen=True, slots=True)
class OrderItemChoice:
    """Sale-time snapshot of one selected option."""

    option_id: str | None
    group_name: str
    option_name: str
    price_delta: Money


@dataclass(frozen=True, slots=True)
class OrderItem:
    """A line frozen at sale time; never depends on the live Product afterwards."""

    id: str
    product_id: str
    product_code: str
    product_name: str
    tax_class: TaxClass
    base_price: Money
    unit_price: Money
    quantity: int
    line_total: Money
    choices: tuple[OrderItemChoice, ...] = ()
    discount_allocation: Money | None = None

    def __post_init__(self) -> None:
        if isinstance(self.quantity, bool) or not isinstance(self.quantity, int) or self.quantity <= 0:
            raise ValidationError("product quantity must be a positive whole number")

    @classmethod
    def from_product(cls, item_id: str, product: Product,
                     selections: Sequence[tuple[ChoiceGroup, ChoiceOption]], quantity: int) -> OrderItem:
        if not product.is_sellable:
            raise ValidationError(f"product {product.name} is not active and available")
        choices = tuple(
            OrderItemChoice(option.id, group.label, option.name, option.price_delta)
            for group, option in selections
        )
        unit_price = product.price
        for choice in choices:
            unit_price = unit_price + choice.price_delta
        return cls(id=item_id, product_id=product.id, product_code=product.code, product_name=product.name,
                   tax_class=product.tax_class, base_price=product.price, unit_price=unit_price,
                   quantity=quantity, line_total=unit_price * quantity, choices=choices)


@dataclass(frozen=True, slots=True)
class OrderTotals:
    """Totals frozen at creation (names follow DATABASE.md)."""

    subtotal: Money
    discount_total: Money
    net_amount: Money
    tax_amount: Money
    tax_breakdown: tuple[TaxBreakdownEntry, ...]
    total: Money
    tax_name: str
    tax_rate: object
    tax_mode: TaxMode | None

    @classmethod
    def from_pricing(cls, pricing: PricingResult) -> OrderTotals:
        return cls(subtotal=pricing.subtotal, discount_total=pricing.discount_total,
                   net_amount=pricing.net_amount, tax_amount=pricing.tax_amount,
                   tax_breakdown=pricing.tax_breakdown, total=pricing.total, tax_name=pricing.tax_name,
                   tax_rate=pricing.tax_rate, tax_mode=pricing.tax_mode)


@dataclass(frozen=True, slots=True)
class Attribution:
    """Taken from the authenticated session, never from the request body (R2.13)."""

    terminal_id: str
    session_id: str
    cashier_id: str


class Order:
    def __init__(self, *, id: str, number: str | None, origin: OrderOrigin, order_type: OrderType,
                 items: tuple[OrderItem, ...], totals: OrderTotals, discount: OrderDiscount | None,
                 attribution: Attribution, reservation: ReservationPlan, created_at: datetime,
                 offline_ref: str | None = None, tag: str | None = None, note: str | None = None,
                 customer_name: str | None = None) -> None:
        self.id = id
        self.number = number
        self.origin = origin
        self.offline_ref = offline_ref
        self.order_type = order_type
        self.items = items
        self.totals = totals
        self.discount = discount
        self.attribution = attribution
        self.reservation = reservation
        self.tag = tag
        self.note = note
        # Keeping customer names/records is ⚠ OPEN (Q-ORD-5, ⚖ VR-7); stored only if supplied.
        self.customer_name = customer_name
        self.created_at = created_at
        self.status = OrderStatus.PENDING
        self.version = 1
        self.started_at: datetime | None = None
        self.ready_at: datetime | None = None
        self.completed_at: datetime | None = None
        self.cancelled_at: datetime | None = None
        self.cancel_reason: str | None = None
        self.archived_at: datetime | None = None
        self.archived_by: str | None = None  # None = system actor
        self.archive_method: ArchiveMethod | None = None
        self.archive_reason: str | None = None
        self.restored_at: datetime | None = None
        self.restored_by: str | None = None
        self._payments: list[Payment] = []
        self._refunds: list[Refund] = []

    # --- creation -------------------------------------------------------------------------
    @classmethod
    def place(cls, *, id: str, number: str | None, origin: OrderOrigin, order_type: OrderType,
              items: Sequence[OrderItem], pricing: PricingResult, discount: OrderDiscount | None,
              attribution: Attribution, reservation: ReservationPlan, created_at: datetime,
              offline_ref: str | None = None, tag: str | None = None, note: str | None = None,
              customer_name: str | None = None) -> Order:
        """Create a pending, unpaid order (Q-ORD-1). Stock must already be reserved
        (``inventory.reserve_all``) in the same transaction by the service."""
        if not items:
            raise EmptyOrder("an order needs at least one line")
        if len(pricing.line_discounts) != len(items):
            raise ValidationError("pricing does not match the order items")
        if any(item.line_total.currency != pricing.total.currency for item in items):
            raise ValidationError("item currency mismatch")
        if sum_money([i.line_total for i in items], pricing.total.currency) != pricing.subtotal:
            raise ValidationError("pricing subtotal does not match the order items")
        if discount is None and not pricing.discount_total.is_zero:
            raise ValidationError("pricing has a discount but no discount snapshot was given")
        if discount is not None and discount.amount != pricing.discount_total:
            raise ValidationError("discount snapshot amount differs from pricing")
        if origin is OrderOrigin.ONLINE and not number:
            raise ValidationError("online orders get their order number at creation")
        if origin is OrderOrigin.OFFLINE and not (number or offline_ref):
            raise ValidationError("offline orders need an offline_ref until they are numbered at sync")
        frozen_items = tuple(
            replace(item, discount_allocation=line_discount)
            for item, line_discount in zip(items, pricing.line_discounts)
        )
        return cls(id=id, number=number, origin=origin, order_type=order_type, items=frozen_items,
                   totals=OrderTotals.from_pricing(pricing), discount=discount, attribution=attribution,
                   reservation=reservation, created_at=created_at, offline_ref=offline_ref, tag=tag,
                   note=note, customer_name=customer_name)

    @classmethod
    def rehydrate(cls, *, payments: Sequence[Payment], refunds: Sequence[Refund], status: OrderStatus,
                version: int, lifecycle: dict[str, object], **fields: object) -> Order:
        """Rebuild a persisted order (used by repositories). No business rules run here:
        persisted state was validated when it was written."""
        order = cls(**fields)  # type: ignore[arg-type]
        order.status, order.version = status, version
        for name, value in lifecycle.items():
            if not hasattr(order, name):
                raise ValidationError(f"unknown order field {name}")
            setattr(order, name, value)
        order._payments = list(payments)
        order._refunds = list(refunds)
        return order

    # --- helpers -----------------------------------------------------------------------------
    @property
    def currency(self) -> str:
        return self.totals.total.currency

    @property
    def payments(self) -> tuple[Payment, ...]:
        return tuple(self._payments)

    @property
    def refunds(self) -> tuple[Refund, ...]:
        return tuple(self._refunds)

    def _check_version(self, expected_version: int | None) -> None:
        if expected_version is not None and expected_version != self.version:
            raise VersionConflict(f"order version is {self.version}, expected {expected_version}")

    def _bump(self) -> None:
        self.version += 1

    def _require_active(self) -> None:
        if not self.status.is_active:
            raise InvalidStateTransition(f"order is {self.status}")

    # --- discount / editing -------------------------------------------------------------------
    def apply_discount(self, discount: OrderDiscount) -> None:
        if self.discount is not None:
            raise DiscountAlreadyApplied("only one discount may apply to an order (Q-DSC-1)")
        raise UndecidedPolicy("Q-ORD-2", "adding a discount after placement is an order edit")

    def edit_items(self, *_: object) -> None:
        raise UndecidedPolicy("Q-ORD-2", "editing an order after placement")

    # --- preparation lifecycle ------------------------------------------------------------------
    def advance(self, target: OrderStatus, at: datetime, expected_version: int | None = None) -> None:
        """Forward steps and forward skips to preparing/ready (completion uses ``complete``)."""
        self._check_version(expected_version)
        if target not in _STEP_FORWARD.get(self.status, set()):
            raise InvalidStateTransition(f"{self.status} → {target} is not allowed")
        if self.status is OrderStatus.PENDING:
            self.started_at = at
        if target is OrderStatus.READY:
            self.ready_at = at
        self.status = target
        self._bump()

    def undo_last_step(self, at: datetime, expected_version: int | None = None) -> None:
        """preparing → pending, ready → preparing. The 'same shift' limit is checked by the
        service (shift boundary not defined in the docs). Reservations are unchanged."""
        self._check_version(expected_version)
        previous = _UNDO.get(self.status)
        if previous is None:
            raise InvalidStateTransition(f"cannot undo from {self.status}")
        if self.status is OrderStatus.PREPARING:
            self.started_at = None
        else:
            self.ready_at = None
        self.status = previous
        self._bump()

    def complete(self, at: datetime, expected_version: int | None = None) -> ReservationPlan:
        """Complete a settled order (R11.1). Returns the reservation to convert into sales."""
        self._check_version(expected_version)
        if self.status is OrderStatus.COMPLETED:
            raise InvalidStateTransition("order is already completed")
        self._require_active()
        if self.payment_status is not PaymentStatus.PAID:
            raise OrderNotSettled("completion requires payment_status = paid")
        self.started_at = self.started_at or at
        self.ready_at = self.ready_at or at
        self.completed_at = at
        self.status = OrderStatus.COMPLETED
        self._bump()
        return self.reservation

    def cancel(self, reason: str, at: datetime, expected_version: int | None = None) -> ReservationPlan:
        """Cancel before completion (R9). Returns the reservation to release."""
        self._check_version(expected_version)
        if self.status is OrderStatus.CANCELLED:
            raise InvalidStateTransition("order is already cancelled")
        self._require_active()
        reason = (reason or "").strip()
        if not reason or len(reason) > MAX_CANCEL_REASON:
            raise ValidationError(f"a cancel reason (≤ {MAX_CANCEL_REASON} chars) is required")
        if any(p.status is PaymentRecordStatus.COMPLETED for p in self._payments):
            raise UndecidedPolicy("Q-CAN-1", "cancelling an order that has completed payments")
        self._payments = [p.void() if p.status is PaymentRecordStatus.PENDING else p for p in self._payments]
        self.cancel_reason = reason
        self.cancelled_at = at
        self.status = OrderStatus.CANCELLED
        self._bump()
        return self.reservation

    # --- payments (§7) ------------------------------------------------------------------------------
    def _sum(self, payments: Sequence[Payment], attr: str) -> Money:
        return sum_money([getattr(p, attr) for p in payments], self.currency)

    @property
    def settled_amount(self) -> Money:
        completed = [p for p in self._payments if p.status is PaymentRecordStatus.COMPLETED]
        return self._sum(completed, "settlement_value")

    @property
    def pending_amount(self) -> Money:
        return self._sum([p for p in self._payments if p.status is PaymentRecordStatus.PENDING], "amount")

    @property
    def remaining_balance(self) -> Money:
        """total − Σ completed (amount + rounding_adjustment) − Σ pending amount (R7.4)."""
        return self.totals.total - self.settled_amount - self.pending_amount

    @property
    def payment_status(self) -> PaymentStatus:
        settled = self.settled_amount
        if settled == self.totals.total:
            return PaymentStatus.PAID
        if settled.is_positive:
            return PaymentStatus.PARTIALLY_PAID
        return PaymentStatus.UNPAID

    def add_payment(self, payment: Payment) -> bool:
        """Record a payment. Returns True when this payment made the order paid
        (the service then issues the sales document in the same transaction, R7.12)."""
        self._require_active()
        if payment.order_id != self.id or payment.amount.currency != self.currency:
            raise InvalidPayment("payment belongs to another order or currency")
        if self.payment_status is PaymentStatus.PAID:
            raise InvalidStateTransition("order is already paid")
        if any(p.idempotency_key == payment.idempotency_key or p.id == payment.id for p in self._payments):
            raise DuplicateOperation("payment already recorded (idempotency)")
        if payment.status is PaymentRecordStatus.VOIDED:
            raise InvalidPayment("cannot record a voided payment")
        if payment.settlement_value > self.remaining_balance:
            raise Overpayment(f"payment exceeds remaining balance {self.remaining_balance}")
        was_paid = self.payment_status is PaymentStatus.PAID
        self._payments.append(payment)
        self._bump()
        return not was_paid and self.payment_status is PaymentStatus.PAID

    def _replace_payment(self, payment_id: str, change) -> Payment:  # type: ignore[no-untyped-def]
        for index, payment in enumerate(self._payments):
            if payment.id == payment_id:
                updated = change(payment)
                self._payments[index] = updated
                self._bump()
                return updated
        raise ValidationError(f"payment {payment_id} not found on this order")

    def confirm_payment(self, payment_id: str, by: str, at: datetime) -> bool:
        """pending → completed. What confirmation means is ⚠ OPEN (Q-PAY-3)."""
        self._require_active()
        was_paid = self.payment_status is PaymentStatus.PAID
        self._replace_payment(payment_id, lambda p: p.confirm(by, at))
        return not was_paid and self.payment_status is PaymentStatus.PAID

    def void_payment(self, payment_id: str) -> None:
        self._require_active()
        self._replace_payment(payment_id, lambda p: p.void())

    # --- refunds (§10) --------------------------------------------------------------------------------
    @property
    def refunded_amount(self) -> Money:
        return sum_money([r.amount for r in self._refunds], self.currency)

    @property
    def completed_payment_total(self) -> Money:
        return self._sum([p for p in self._payments if p.status is PaymentRecordStatus.COMPLETED], "amount")

    @property
    def refundable_amount(self) -> Money:
        """Σ completed payment amount − Σ refunds (R10.6)."""
        return self.completed_payment_total - self.refunded_amount

    def unrefunded_amount_of(self, payment_id: str) -> Money:
        payment = next((p for p in self._payments if p.id == payment_id), None)
        if payment is None or payment.status is not PaymentRecordStatus.COMPLETED:
            raise ValidationError(f"payment {payment_id} is not a completed payment of this order")
        refunded = sum_money([a.amount for r in self._refunds for a in r.allocations
                              if a.payment_id == payment_id], self.currency)
        return payment.amount - refunded

    def full_refund_allocations(self) -> tuple[tuple[str, Money], ...]:
        """For a FULL refund every completed payment returns its unrefunded amount. How the
        money is returned (method/time limit) is ⚠ OPEN (Q-REF-2)."""
        result = []
        for payment in self._payments:
            if payment.status is PaymentRecordStatus.COMPLETED:
                remaining = self.unrefunded_amount_of(payment.id)
                if remaining.is_positive:
                    result.append((payment.id, remaining))
        return tuple(result)

    def refunded_quantity_of(self, item_id: str) -> int:
        return sum(l.quantity for r in self._refunds for l in r.lines if l.order_item_id == item_id)

    @property
    def refund_status(self) -> RefundStatus:
        if not self._refunds:
            return RefundStatus.NONE
        if self.refundable_amount.is_zero:
            return RefundStatus.REFUNDED
        return RefundStatus.PARTIALLY_REFUNDED

    def add_refund(self, refund: Refund, *, refunds_enabled: bool) -> RefundStatus:
        """Record a refund as a separate record; the order, payments and document are untouched."""
        if not refunds_enabled:
            raise FeatureDisabled("the Refunds feature is off (Q-REF-4)")
        if self.status is not OrderStatus.COMPLETED:
            raise RefundNotAllowed("refunds apply to completed orders (paid-not-completed: Q-CAN-1)")
        if refund.order_id != self.id or refund.amount.currency != self.currency:
            raise ValidationError("refund belongs to another order or currency")
        if any(r.idempotency_key == refund.idempotency_key or r.id == refund.id for r in self._refunds):
            raise DuplicateOperation("refund already recorded (idempotency)")
        if refund.amount > self.refundable_amount:
            raise RefundExceedsPayment(f"refund {refund.amount} exceeds refundable {self.refundable_amount}")
        if refund.kind is RefundKind.FULL and refund.amount != self.refundable_amount:
            raise ValidationError("a full refund returns the whole refundable amount")
        for allocation in refund.allocations:
            payment = next((p for p in self._payments if p.id == allocation.payment_id), None)
            if payment is None or payment.method is not allocation.method:
                raise ValidationError(f"allocation {allocation.payment_id} does not match an order payment")
            if allocation.amount > self.unrefunded_amount_of(allocation.payment_id):
                raise RefundExceedsPayment(f"allocation exceeds unrefunded amount of {allocation.payment_id}")
        items = {item.id: item for item in self.items}
        for line in refund.lines:
            item = items.get(line.order_item_id)
            if item is None:
                raise ValidationError(f"refund line {line.order_item_id} is not an item of this order")
            if line.quantity > item.quantity - self.refunded_quantity_of(item.id):
                raise RefundExceedsPayment(f"refund quantity exceeds the unrefunded quantity of {item.product_name}")
        self._refunds.append(refund)
        self._bump()
        return self.refund_status

    # --- archive (§12) ------------------------------------------------------------------------------------
    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    def is_auto_archive_eligible(self, now: datetime, policy: ArchivePolicy) -> bool:
        """Completed, not archived, never restored, and past the configured timing (Q-ARC-4)."""
        return (self.status is OrderStatus.COMPLETED and not self.is_archived and self.restored_at is None
                and self.completed_at is not None and now >= self.completed_at + policy.auto_archive_after)

    def archive(self, at: datetime, method: ArchiveMethod, *, by: str | None, reason: str | None = None,
                policy: ArchivePolicy | None = None) -> None:
        if self.is_archived:
            raise InvalidStateTransition("order is already archived")
        if self.status not in (OrderStatus.COMPLETED, OrderStatus.CANCELLED):
            raise InvalidStateTransition("only completed or cancelled orders can be archived")
        if method is ArchiveMethod.AUTO:
            if policy is None or not self.is_auto_archive_eligible(at, policy):
                raise InvalidStateTransition("order is not eligible for automatic archive")
            by = None  # system actor
        else:
            if not by or not (reason or "").strip():
                raise ValidationError("manual archive requires an actor and a reason")
        self.archived_at, self.archived_by = at, by
        self.archive_method, self.archive_reason = method, reason
        self._bump()

    def restore(self, at: datetime, *, by: str, policy: ArchivePolicy) -> None:
        """Admin-only (checked by the service via archive.manage); completed orders only."""
        if not self.is_archived or self.archived_at is None:
            raise InvalidStateTransition("order is not archived")
        if self.status is not OrderStatus.COMPLETED:
            raise InvalidStateTransition("only completed orders can be restored")
        if at > self.archived_at + policy.restore_window:
            raise RestoreWindowExpired("restore window has passed")
        self.archived_at = self.archived_by = self.archive_method = self.archive_reason = None
        self.restored_at, self.restored_by = at, by
        self._bump()
