"""Payments, settlement inputs and cash rounding (BUSINESS-RULES §7; Q-PAY-1, Q-PAY-2, Q-TRM-4).

Settlement: an order is paid when Σ over completed payments of
(amount + rounding_adjustment) = total. ``rounding_adjustment = remaining − collected``
is only non-zero on a cash payment that settles the full remaining balance while cash
rounding is enabled. The meaning of payment confirmation is ⚠ OPEN (Q-PAY-3): the
domain only models pending → completed / voided.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from decimal import ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, Decimal
from enum import StrEnum
from types import MappingProxyType

from .errors import (
    ImmutableRecordError,
    InsufficientTender,
    InvalidPayment,
    Overpayment,
    PaymentMethodNotEnabled,
    ReferenceRequired,
    ValidationError,
)
from .money import CENT, Money, to_decimal


class PaymentMethod(StrEnum):
    CASH = "cash"
    GCASH = "gcash"
    CARD = "card"
    BANK_TRANSFER = "bank_transfer"

    @property
    def is_cash(self) -> bool:
        return self is PaymentMethod.CASH


class PaymentRecordStatus(StrEnum):
    PENDING = "pending"
    COMPLETED = "completed"
    VOIDED = "voided"


class PaymentOrigin(StrEnum):
    ONLINE = "online"
    OFFLINE = "offline"


class CashRoundingMode(StrEnum):
    NEAREST = "nearest"
    DOWN = "down"
    UP = "up"


_ROUNDING = {
    CashRoundingMode.NEAREST: ROUND_HALF_UP,  # ties go up, consistent with the half-up policy
    CashRoundingMode.DOWN: ROUND_DOWN,
    CashRoundingMode.UP: ROUND_UP,
}

REFERENCE_MIN_LENGTH = 4
REFERENCE_MAX_LENGTH = 40


@dataclass(frozen=True, slots=True)
class CashRoundingPolicy:
    """Business-level cash rounding (``payments.cash_rounding``). Increment and mode are
    configuration, not facts; no default values are assumed (Q-SET-4, ⚖ VR-5)."""

    enabled: bool
    increment: Decimal | None = None
    mode: CashRoundingMode | None = None

    def __post_init__(self) -> None:
        if self.increment is not None:
            object.__setattr__(self, "increment", to_decimal(self.increment, "increment"))
        if self.enabled:
            if self.increment is None or self.increment <= 0 or self.increment != self.increment.quantize(CENT):
                raise ValidationError("enabled cash rounding needs a positive increment with ≤ 2 decimals")
            if self.mode is None:
                raise ValidationError("enabled cash rounding needs a mode")

    def round(self, amount: Money) -> Money:
        if not self.enabled:
            return amount
        assert self.increment is not None and self.mode is not None
        steps = (amount.amount / self.increment).quantize(Decimal("1"), rounding=_ROUNDING[self.mode])
        return Money(steps * self.increment, amount.currency)


@dataclass(frozen=True, slots=True)
class MethodOptions:
    """Per-method rules from Settings → Payments."""

    require_cash_received: bool = False  # cash only
    require_reference: bool = False      # non-cash only
    require_confirmation: bool = False   # non-cash only (meaning ⚠ OPEN Q-PAY-3)


@dataclass(frozen=True, slots=True)
class PaymentSettings:
    enabled_methods: frozenset[PaymentMethod]
    options: Mapping[PaymentMethod, MethodOptions]
    cash_rounding: CashRoundingPolicy

    def __post_init__(self) -> None:
        if not self.enabled_methods:
            raise ValidationError("at least one payment method must be enabled")
        object.__setattr__(self, "options", MappingProxyType(dict(self.options)))

    def options_for(self, method: PaymentMethod) -> MethodOptions:
        return self.options.get(method, MethodOptions())


@dataclass(frozen=True, slots=True)
class Payment:
    """One immutable payment record; several may exist per order (split payments)."""

    id: str
    order_id: str
    method: PaymentMethod
    amount: Money
    status: PaymentRecordStatus
    idempotency_key: str
    terminal_id: str
    user_id: str
    created_at: datetime
    origin: PaymentOrigin = PaymentOrigin.ONLINE
    tendered: Money | None = None
    change_given: Money | None = None
    rounding_adjustment: Money | None = None
    reference: str | None = None
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None

    def __post_init__(self) -> None:
        self.amount.require_positive("payment amount")
        if not self.idempotency_key:
            raise InvalidPayment("idempotency key is required")
        if self.rounding_adjustment is None:
            object.__setattr__(self, "rounding_adjustment", Money.zero(self.amount.currency))
        if not self.method.is_cash and (self.tendered or self.change_given or not self.rounding_adjustment.is_zero):
            raise InvalidPayment("non-cash payments are exact: no tendered, change or rounding")
        if self.change_given is not None:
            self.change_given.require_non_negative("change")

    @property
    def settlement_value(self) -> Money:
        """What this payment settles of the order total: amount + rounding_adjustment."""
        assert self.rounding_adjustment is not None
        return self.amount + self.rounding_adjustment

    def confirm(self, by: str, at: datetime) -> Payment:
        if self.status is not PaymentRecordStatus.PENDING:
            raise ImmutableRecordError("only pending payments can be confirmed")
        return replace(self, status=PaymentRecordStatus.COMPLETED, confirmed_by=by, confirmed_at=at)

    def void(self) -> Payment:
        if self.status is not PaymentRecordStatus.PENDING:
            raise ImmutableRecordError("completed payments are never voided; use a refund")
        return replace(self, status=PaymentRecordStatus.VOIDED)


@dataclass(frozen=True, slots=True)
class PaymentRequest:
    """Client-entered values; requests only, validated against server balances (SR-8)."""

    method: PaymentMethod
    amount: Money
    tendered: Money | None = None
    reference: str | None = None
    offline: bool = False


def build_payment(request: PaymentRequest, *, remaining_balance: Money, settings: PaymentSettings,
                  payment_id: str, order_id: str, idempotency_key: str, terminal_id: str,
                  user_id: str, at: datetime) -> Payment:
    """Validate a payment request and compute the authoritative payment record."""
    method = request.method
    if request.offline and not method.is_cash:
        raise PaymentMethodNotEnabled(f"{method} is unavailable offline (cash only, Q-TRM-4)")
    if method not in settings.enabled_methods:
        raise PaymentMethodNotEnabled(f"{method} is not enabled")
    requested = request.amount.require_positive("payment amount")
    options = settings.options_for(method)
    origin = PaymentOrigin.OFFLINE if request.offline else PaymentOrigin.ONLINE

    if method.is_cash:
        amount, adjustment = requested, Money.zero(requested.currency)
        if settings.cash_rounding.enabled and requested == remaining_balance:
            amount = settings.cash_rounding.round(remaining_balance)
            adjustment = remaining_balance - amount
            if not amount.is_positive:
                raise InvalidPayment("cash rounding produced a non-positive amount")
        if amount + adjustment > remaining_balance:
            raise Overpayment(f"payment {amount} exceeds remaining balance {remaining_balance}")
        tendered, change = request.tendered, None
        if tendered is None and options.require_cash_received:
            raise InvalidPayment("cash received (tendered) is required")
        if tendered is not None:
            if tendered < amount:
                raise InsufficientTender(f"tendered {tendered} is below {amount}")
            change = tendered - amount
        return Payment(id=payment_id, order_id=order_id, method=method, amount=amount,
                       status=PaymentRecordStatus.COMPLETED, idempotency_key=idempotency_key,
                       terminal_id=terminal_id, user_id=user_id, created_at=at, origin=origin,
                       tendered=tendered, change_given=change, rounding_adjustment=adjustment)

    if request.tendered is not None:
        raise InvalidPayment("non-cash payments do not take tendered cash")
    if requested > remaining_balance:
        raise Overpayment(f"payment {requested} exceeds remaining balance {remaining_balance}")
    reference = (request.reference or "").strip() or None
    if reference is not None and not (REFERENCE_MIN_LENGTH <= len(reference) <= REFERENCE_MAX_LENGTH):
        raise ReferenceRequired(f"reference must be {REFERENCE_MIN_LENGTH}–{REFERENCE_MAX_LENGTH} characters")
    if options.require_reference and reference is None:
        raise ReferenceRequired(f"{method} requires a payment reference")
    status = PaymentRecordStatus.PENDING if options.require_confirmation else PaymentRecordStatus.COMPLETED
    return Payment(id=payment_id, order_id=order_id, method=method, amount=requested, status=status,
                   idempotency_key=idempotency_key, terminal_id=terminal_id, user_id=user_id,
                   created_at=at, origin=origin, reference=reference)
