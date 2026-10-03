"""Money value object and the single rounding policy (Q-TAX-3, BUSINESS-RULES §0).

- Always ``decimal.Decimal``; floats are rejected everywhere.
- Money holds exactly 2 decimal places.
- One rounding policy: half-up to 0.01, applied only at the defined rounding points
  (line total, discount + allocation, tax, total, change, refund). If a prescribed
  method is verified (⚖ VR-4) it replaces ``round_money`` in this one place.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal, InvalidOperation
from functools import total_ordering
from typing import Union

from .errors import CurrencyMismatch, InvalidMoney, ValidationError

CENT = Decimal("0.01")
MONEY_PLACES = 2
INGREDIENT_QUANTITY_PLACES = 3
UNIT_COST_PLACES = 4
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

DecimalLike = Union[Decimal, int, str]


def to_decimal(value: object, field: str = "value") -> Decimal:
    """Convert an exact input to Decimal. Floats and bools are rejected."""
    if isinstance(value, bool) or isinstance(value, float):
        raise InvalidMoney(f"{field}: float/bool not allowed, use Decimal, int or str")
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, (int, str)):
        try:
            result = Decimal(value)
        except InvalidOperation as exc:
            raise InvalidMoney(f"{field}: not a number: {value!r}") from exc
    else:
        raise InvalidMoney(f"{field}: unsupported type {type(value).__name__}")
    if not result.is_finite():
        raise InvalidMoney(f"{field}: must be finite")
    return result


def has_max_places(value: Decimal, places: int) -> bool:
    return value == value.quantize(Decimal(1).scaleb(-places))


def round_money(value: Decimal) -> Decimal:
    """The one rounding policy: half-up to 0.01 (BUSINESS-RULES R0.2)."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def to_quantity(value: object, places: int = INGREDIENT_QUANTITY_PLACES, field: str = "quantity") -> Decimal:
    """Exact non-float decimal quantity with at most ``places`` decimals."""
    try:
        result = to_decimal(value, field)
    except InvalidMoney as exc:
        raise ValidationError(str(exc)) from exc
    if not has_max_places(result, places):
        raise ValidationError(f"{field}: at most {places} decimal places")
    return result


@total_ordering
@dataclass(frozen=True, slots=True)
class Money:
    """An exact amount with 2 decimal places in one currency (e.g. ``PHP``)."""

    amount: Decimal
    currency: str

    def __post_init__(self) -> None:
        if not isinstance(self.currency, str) or not _CURRENCY_RE.match(self.currency):
            raise InvalidMoney(f"currency must be a 3-letter uppercase code, got {self.currency!r}")
        amount = to_decimal(self.amount, "amount")
        if not has_max_places(amount, MONEY_PLACES):
            raise InvalidMoney(f"amount {amount} has more than 2 decimal places; use Money.rounded()")
        object.__setattr__(self, "amount", amount.quantize(CENT))

    # --- constructors ---------------------------------------------------------
    @classmethod
    def of(cls, value: DecimalLike, currency: str) -> Money:
        """Exact constructor: rejects values with more than 2 decimals."""
        return cls(to_decimal(value), currency)

    @classmethod
    def rounded(cls, value: DecimalLike, currency: str) -> Money:
        """Apply the rounding policy (half-up to 0.01) — use only at a rounding point."""
        return cls(round_money(to_decimal(value)), currency)

    @classmethod
    def zero(cls, currency: str) -> Money:
        return cls(Decimal("0"), currency)

    # --- helpers ----------------------------------------------------------------
    def _check(self, other: object) -> Money:
        if not isinstance(other, Money):
            raise InvalidMoney(f"expected Money, got {type(other).__name__}")
        if other.currency != self.currency:
            raise CurrencyMismatch(f"{self.currency} vs {other.currency}")
        return other

    @property
    def is_zero(self) -> bool:
        return self.amount == 0

    @property
    def is_positive(self) -> bool:
        return self.amount > 0

    @property
    def is_negative(self) -> bool:
        return self.amount < 0

    def require_non_negative(self, field: str) -> Money:
        if self.is_negative:
            raise InvalidMoney(f"{field} must be ≥ 0")
        return self

    def require_positive(self, field: str) -> Money:
        if not self.is_positive:
            raise InvalidMoney(f"{field} must be > 0")
        return self

    # --- arithmetic ---------------------------------------------------------------
    def __add__(self, other: Money) -> Money:
        return Money(self.amount + self._check(other).amount, self.currency)

    def __sub__(self, other: Money) -> Money:
        return Money(self.amount - self._check(other).amount, self.currency)

    def __neg__(self) -> Money:
        return Money(-self.amount, self.currency)

    def __mul__(self, factor: object) -> Money:
        """Multiply by an int or Decimal; the result is rounded half-up (rounding point)."""
        if isinstance(factor, Money):
            raise InvalidMoney("cannot multiply Money by Money")
        return Money.rounded(self.amount * to_decimal(factor, "factor"), self.currency)

    __rmul__ = __mul__

    def __truediv__(self, other: object) -> Decimal:
        """Money / Money → Decimal ratio (never Money, to avoid silent rounding)."""
        return self.amount / self._check(other).amount

    # --- comparison --------------------------------------------------------------------
    def __lt__(self, other: Money) -> bool:
        return self.amount < self._check(other).amount

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Money):
            return NotImplemented
        return self.amount == other.amount and self.currency == other.currency

    def __hash__(self) -> int:
        return hash((self.amount, self.currency))

    def __str__(self) -> str:
        return f"{self.currency} {self.amount}"

    # --- allocation ------------------------------------------------------------------
    def allocate_pro_rata(self, weights: list[Money]) -> list[Money]:
        """Split this amount across ``weights`` pro-rata (BUSINESS-RULES R6.3).

        Each share is truncated to 0.01; the remaining cents go one each to the
        largest remainders (ties by position) so the parts sum exactly.
        """
        if self.is_negative:
            raise InvalidMoney("cannot allocate a negative amount")
        for weight in weights:
            self._check(weight).require_non_negative("allocation weight")
        base = sum((w.amount for w in weights), Decimal("0"))
        if not weights:
            if self.is_zero:
                return []
            raise ValidationError("cannot allocate a non-zero amount over no weights")
        if base == 0:
            if self.is_zero:
                return [Money.zero(self.currency) for _ in weights]
            raise ValidationError("cannot allocate a non-zero amount over zero weights")
        exact = [self.amount * w.amount / base for w in weights]
        truncated = [e.quantize(CENT, rounding=ROUND_DOWN) for e in exact]
        leftover_cents = int((self.amount - sum(truncated, Decimal("0"))) / CENT)
        order = sorted(range(len(weights)), key=lambda i: (-(exact[i] - truncated[i]), i))
        for i in order[:leftover_cents]:
            truncated[i] += CENT
        return [Money(t, self.currency) for t in truncated]


def sum_money(items: list[Money], currency: str) -> Money:
    total = Money.zero(currency)
    for item in items:
        total = total + item
    return total
