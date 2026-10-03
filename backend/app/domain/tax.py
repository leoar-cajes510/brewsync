"""Tax settings and taxability (Q-TAX-1, Q-TAX-2, BUSINESS-RULES §6).

No tax rate is hard-coded: the rate is configuration only (⚖ VR-4). Statutory
Senior Citizen/PWD treatment is not part of this ordinary model (see compliance.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from .errors import ValidationError
from .money import Money, to_decimal


class TaxClass(StrEnum):
    """Per-product taxability (baseline classes; further classes are compliance config ⚖ VR-4)."""

    TAXABLE = "taxable"
    NON_TAXABLE = "non_taxable"


class TaxMode(StrEnum):
    INCLUDED = "included"  # listed prices contain tax
    EXCLUDED = "excluded"  # tax is added on top


_HUNDRED = Decimal("100")


@dataclass(frozen=True, slots=True)
class TaxSettings:
    """Business-wide ordinary tax configuration (Settings → Tax)."""

    enabled: bool
    mode: TaxMode
    name: str = ""
    rate: Decimal | None = None  # percent, e.g. Decimal("5") means 5 %
    registration_number: str = ""

    def __post_init__(self) -> None:
        if self.rate is not None:
            object.__setattr__(self, "rate", to_decimal(self.rate, "rate"))
        if self.enabled:
            if not self.name.strip():
                raise ValidationError("enabled tax requires a name")
            if self.rate is None or not (Decimal("0") < self.rate <= _HUNDRED):
                raise ValidationError("enabled tax requires 0 < rate ≤ 100")
        elif self.rate is not None and not (Decimal("0") <= self.rate <= _HUNDRED):
            raise ValidationError("rate must be between 0 and 100")

    @property
    def rate_fraction(self) -> Decimal:
        return (self.rate or Decimal("0")) / _HUNDRED

    def applies_to(self, tax_class: TaxClass) -> bool:
        return self.enabled and tax_class is TaxClass.TAXABLE

    def tax_on(self, taxable_amount: Money) -> Money:
        """Tax for one tax class on the discounted taxable amount T (rounded once, R6.3)."""
        taxable_amount.require_non_negative("taxable amount")
        if not self.enabled or taxable_amount.is_zero:
            return Money.zero(taxable_amount.currency)
        r = self.rate_fraction
        t = taxable_amount.amount
        if self.mode is TaxMode.INCLUDED:
            return Money.rounded(t - t / (1 + r), taxable_amount.currency)
        return Money.rounded(t * r, taxable_amount.currency)
