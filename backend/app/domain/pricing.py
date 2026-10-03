"""Order pricing pipeline (BUSINESS-RULES R2.9, §5, §6; Q-TAX-2, Q-TAX-3).

line totals → subtotal → the one discount (on listed prices) → pro-rata allocation →
tax once per order per tax class on the discounted taxable amount → total.
This is the single authoritative formula; the UI demo formulas are not reused.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal

from .compliance import StatutoryRule, ensure_no_statutory_rule
from .discount import Discount
from .errors import EmptyOrder, ValidationError
from .money import Money, sum_money
from .tax import TaxClass, TaxMode, TaxSettings


@dataclass(frozen=True, slots=True)
class PricingLine:
    line_total: Money
    tax_class: TaxClass


@dataclass(frozen=True, slots=True)
class TaxBreakdownEntry:
    tax_class: TaxClass
    taxable_amount: Money  # discounted amount of the lines in this class
    tax_amount: Money


@dataclass(frozen=True, slots=True)
class PricingResult:
    subtotal: Money
    discount_total: Money
    line_discounts: tuple[Money, ...]
    tax_breakdown: tuple[TaxBreakdownEntry, ...]
    tax_amount: Money
    net_amount: Money
    total: Money
    tax_name: str
    tax_rate: Decimal | None
    tax_mode: TaxMode | None


class PriceCalculator:
    """Ordinary pricing policy. Statutory treatment is a separate, verification-gated
    policy that is not implemented (⚖ VR-1): an enabled statutory rule makes pricing
    of an affected discount raise ``UndecidedPolicy``."""

    def __init__(self, tax: TaxSettings, currency: str,
                 statutory_rules: tuple[StatutoryRule, ...] = ()) -> None:
        self.tax = tax
        self.currency = currency
        self.statutory_rules = statutory_rules

    def price(self, lines: Sequence[PricingLine], discount: Discount | None = None) -> PricingResult:
        if not lines:
            raise EmptyOrder("an order needs at least one line")
        for line in lines:
            if line.line_total.currency != self.currency:
                raise ValidationError("line currency differs from business currency")
            line.line_total.require_non_negative("line total")
        subtotal = sum_money([line.line_total for line in lines], self.currency)

        if discount is not None:
            ensure_no_statutory_rule(discount.eligibility, self.statutory_rules)
            discount_total = discount.compute_amount(subtotal)
        else:
            discount_total = Money.zero(self.currency)
        line_discounts = discount_total.allocate_pro_rata([line.line_total for line in lines])

        breakdown: list[TaxBreakdownEntry] = []
        tax_amount = Money.zero(self.currency)
        for tax_class in TaxClass:
            members = [i for i, line in enumerate(lines) if line.tax_class is tax_class]
            if not members:
                continue
            taxable = sum_money([lines[i].line_total - line_discounts[i] for i in members], self.currency)
            tax = self.tax.tax_on(taxable) if self.tax.applies_to(tax_class) else Money.zero(self.currency)
            breakdown.append(TaxBreakdownEntry(tax_class, taxable, tax))
            tax_amount = tax_amount + tax

        after_discount = subtotal - discount_total
        if self.tax.enabled and self.tax.mode is TaxMode.EXCLUDED:
            total = after_discount + tax_amount
            net_amount = after_discount
        else:
            total = after_discount
            net_amount = total - tax_amount

        return PricingResult(
            subtotal=subtotal, discount_total=discount_total, line_discounts=tuple(line_discounts),
            tax_breakdown=tuple(breakdown), tax_amount=tax_amount, net_amount=net_amount, total=total,
            tax_name=self.tax.name if self.tax.enabled else "",
            tax_rate=self.tax.rate if self.tax.enabled else None,
            tax_mode=self.tax.mode if self.tax.enabled else None,
        )
