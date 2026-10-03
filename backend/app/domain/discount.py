"""Configurable discounts and the applied-discount snapshot (BUSINESS-RULES §5).

- One discount per order (Q-DSC-1) — enforced by ``Order``.
- Senior Citizen / PWD are ordinary definitions with eligibility ``senior``/``pwd``
  (Q-DSC-2). Statutory treatment is separate and verification-gated (compliance.py, ⚖ VR-1).
- Identification capture when configured (Q-DSC-3). No field is claimed to be legally
  mandatory (⚖ VR-2, VR-7).
- There is no ``tax_handling`` attribute: ordinary discounts are applied before tax (Q-TAX-2).
- Admin approval (Q-DSC-4) is ⚠ OPEN: ``approved_by`` is only recorded when supplied.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum

from .errors import DiscountMinOrderNotMet, IdentificationRequired, ValidationError
from .money import Money, has_max_places, round_money, to_decimal

_HUNDRED = Decimal("100")


class DiscountType(StrEnum):
    PERCENTAGE = "percentage"
    FIXED = "fixed"


class Eligibility(StrEnum):
    ALL = "all"
    SENIOR = "senior"
    PWD = "pwd"
    STUDENT = "student"
    CUSTOM = "custom"


class IdentificationField(StrEnum):
    CUSTOMER_NAME = "customer_name"
    ID_TYPE = "id_type"
    ID_NUMBER = "id_number"


@dataclass(frozen=True, slots=True)
class Discount:
    """A discount definition from Settings → Discounts (R5.9)."""

    id: str
    name: str
    type: DiscountType
    value: Decimal  # percent for PERCENTAGE, amount for FIXED
    eligibility: Eligibility
    currency: str
    custom_eligibility: str = ""
    min_order: Money | None = None
    max_discount: Money | None = None
    active: bool = True
    requires_identification: bool = False
    identification_fields: frozenset[IdentificationField] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValidationError("discount name is required")
        value = to_decimal(self.value, "value")
        object.__setattr__(self, "value", value)
        if self.type is DiscountType.PERCENTAGE:
            if not (Decimal("0") < value <= _HUNDRED):
                raise ValidationError("percentage must be 0 < x ≤ 100")
        else:
            if value <= 0 or not has_max_places(value, 2):
                raise ValidationError("fixed amount must be > 0 with at most 2 decimals")
        if self.max_discount is not None:
            self.max_discount.require_positive("max_discount")
            if self.type is DiscountType.FIXED and self.max_discount.amount < value:
                raise ValidationError("for fixed discounts max_discount must be ≥ amount")
        if self.min_order is not None:
            self.min_order.require_non_negative("min_order")
        if self.eligibility is Eligibility.CUSTOM and not self.custom_eligibility.strip():
            raise ValidationError("custom eligibility requires a label")
        if self.requires_identification and not self.identification_fields:
            raise ValidationError("requires_identification needs at least one identification field")
        if not self.requires_identification and self.identification_fields:
            raise ValidationError("identification_fields are only used when requires_identification is set")

    @property
    def eligibility_label(self) -> str:
        if self.eligibility is Eligibility.CUSTOM:
            return self.custom_eligibility.strip()
        return self.eligibility.value

    def compute_amount(self, subtotal: Money) -> Money:
        """Discount on the subtotal at listed prices (R5.3, R5.4)."""
        if subtotal.currency != self.currency:
            raise ValidationError("discount currency differs from order currency")
        if self.min_order is not None and subtotal < self.min_order:
            raise DiscountMinOrderNotMet(f"subtotal {subtotal} below min_order {self.min_order}")
        if self.type is DiscountType.PERCENTAGE:
            amount = Money(round_money(subtotal.amount * self.value / _HUNDRED), subtotal.currency)
        else:
            amount = Money.of(self.value, subtotal.currency)
        if self.max_discount is not None and amount > self.max_discount:
            amount = self.max_discount
        return min(amount, subtotal)


@dataclass(frozen=True, slots=True)
class IdentificationDetails:
    """Customer identification captured for a discount. Personal data (⚖ VR-7):
    ``repr`` masks the ID number; never put these values in events or audit logs."""

    customer_name: str | None = None
    id_type: str | None = None
    id_number: str | None = field(default=None, repr=False)

    def value_of(self, field_name: IdentificationField) -> str | None:
        return getattr(self, field_name.value)

    @property
    def masked_id_number(self) -> str | None:
        if not self.id_number:
            return None
        visible = self.id_number[-4:] if len(self.id_number) > 4 else ""
        return "•" * (len(self.id_number) - len(visible)) + visible


@dataclass(frozen=True, slots=True)
class OrderDiscount:
    """Frozen snapshot of the one discount applied to an order (R5.8)."""

    discount_id: str
    name: str
    type: DiscountType
    value: Decimal
    eligibility: Eligibility
    eligibility_label: str
    min_order: Money | None
    max_discount: Money | None
    amount: Money
    requires_identification: bool
    identification: IdentificationDetails | None = None
    approved_by: str | None = None

    @classmethod
    def snapshot(cls, discount: Discount, amount: Money,
                 identification: IdentificationDetails | None = None,
                 approved_by: str | None = None) -> OrderDiscount:
        if not discount.active:
            raise ValidationError(f"discount {discount.name} is inactive")
        amount.require_non_negative("discount amount")
        stored: IdentificationDetails | None = None
        if discount.requires_identification:
            missing = [
                f.value for f in sorted(discount.identification_fields)
                if identification is None or not (identification.value_of(f) or "").strip()
            ]
            if missing:
                raise IdentificationRequired(missing)
            assert identification is not None
            # Store only the configured fields (personal data minimisation).
            stored = IdentificationDetails(**{
                f.value: identification.value_of(f).strip()  # type: ignore[union-attr]
                for f in discount.identification_fields
            })
        return cls(
            discount_id=discount.id, name=discount.name, type=discount.type, value=discount.value,
            eligibility=discount.eligibility, eligibility_label=discount.eligibility_label,
            min_order=discount.min_order, max_discount=discount.max_discount, amount=amount,
            requires_identification=discount.requires_identification, identification=stored,
            approved_by=approved_by,
        )
