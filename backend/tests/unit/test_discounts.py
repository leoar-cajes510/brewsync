import unittest
from decimal import Decimal

from domain_support import CUR, m, make_order, percent_discount
from app.domain.compliance import StatutoryRule, Verification
from app.domain.discount import (
    Discount, DiscountType, Eligibility, IdentificationDetails, IdentificationField, OrderDiscount,
)
from app.domain.errors import (
    DiscountAlreadyApplied, DiscountMinOrderNotMet, IdentificationRequired, UndecidedPolicy, ValidationError,
)
from app.domain.pricing import PriceCalculator, PricingLine
from app.domain.tax import TaxClass, TaxMode, TaxSettings
from domain_support import T0


def senior_discount(**kw):
    return Discount(id="d-senior", name="Senior Citizen", type=DiscountType.PERCENTAGE, value=Decimal("20"),
                    eligibility=Eligibility.SENIOR, currency=CUR, requires_identification=True,
                    identification_fields=frozenset({IdentificationField.CUSTOMER_NAME, IdentificationField.ID_TYPE,
                                                     IdentificationField.ID_NUMBER}), **kw)


class DiscountCalculationTests(unittest.TestCase):
    def test_percentage_and_fixed(self):
        self.assertEqual(percent_discount("20").compute_amount(m("500.00")), m("100.00"))
        self.assertEqual(percent_discount("12.5").compute_amount(m("99.99")), m("12.50"))  # 12.49875 → 12.50
        fixed = Discount(id="d-f", name="₱50 off", type=DiscountType.FIXED, value=Decimal("50.00"),
                         eligibility=Eligibility.ALL, currency=CUR)
        self.assertEqual(fixed.compute_amount(m("30.00")), m("30.00"))  # never above the base

    def test_max_cap_and_min_order(self):
        capped = percent_discount("50", max_discount=m("80.00"), min_order=m("200.00"))
        self.assertEqual(capped.compute_amount(m("500.00")), m("80.00"))
        with self.assertRaises(DiscountMinOrderNotMet):
            capped.compute_amount(m("199.99"))

    def test_invalid_definitions(self):
        for bad in (dict(value=Decimal("0")), dict(value=Decimal("101"))):
            with self.assertRaises(ValidationError):
                Discount(id="d", name="x", type=DiscountType.PERCENTAGE, eligibility=Eligibility.ALL,
                         currency=CUR, **bad)
        with self.assertRaises(ValidationError):
            Discount(id="d", name="x", type=DiscountType.FIXED, value=Decimal("50"), eligibility=Eligibility.ALL,
                     currency=CUR, max_discount=m("40.00"))
        with self.assertRaises(ValidationError):
            percent_discount(eligibility=Eligibility.CUSTOM)  # custom needs a label
        with self.assertRaises(ValidationError):
            percent_discount(requires_identification=True)  # needs at least one field
        self.assertFalse(hasattr(percent_discount(), "tax_handling"))


class IdentificationTests(unittest.TestCase):
    def test_senior_pwd_are_ordinary_discounts_requiring_configured_ids(self):
        with self.assertRaises(IdentificationRequired) as ctx:
            OrderDiscount.snapshot(senior_discount(), m("100.00"), IdentificationDetails(customer_name="Juan"))
        self.assertEqual(set(ctx.exception.missing), {"id_type", "id_number"})
        snap = OrderDiscount.snapshot(senior_discount(), m("100.00"),
                                      IdentificationDetails(" Juan Dela Cruz ", "Senior ID", "123456789"))
        self.assertEqual(snap.identification.customer_name, "Juan Dela Cruz")
        self.assertNotIn("123456789", repr(snap.identification))  # masked in repr
        self.assertEqual(snap.identification.masked_id_number, "•••••6789")

    def test_ids_not_stored_when_not_required(self):
        snap = OrderDiscount.snapshot(percent_discount(), m("10.00"), IdentificationDetails("A", "B", "C"))
        self.assertIsNone(snap.identification)

    def test_inactive_discount_cannot_be_applied(self):
        with self.assertRaises(ValidationError):
            OrderDiscount.snapshot(percent_discount(active=False), m("1.00"))


class OneDiscountRuleTests(unittest.TestCase):
    def test_second_discount_rejected(self):
        order = make_order(discount=percent_discount("10"))
        with self.assertRaises(DiscountAlreadyApplied):
            order.apply_discount(OrderDiscount.snapshot(percent_discount("5"), m("25.00")))

    def test_adding_discount_after_placement_is_an_open_edit_question(self):
        order = make_order()
        with self.assertRaises(UndecidedPolicy) as ctx:
            order.apply_discount(OrderDiscount.snapshot(percent_discount("5"), m("25.00")))
        self.assertEqual(ctx.exception.question_id, "Q-ORD-2")


class StatutoryGateTests(unittest.TestCase):
    def test_enabled_statutory_rule_blocks_ordinary_pricing_and_needs_verification(self):
        with self.assertRaises(ValidationError):
            StatutoryRule("sc-pwd", frozenset({Eligibility.SENIOR}), enabled=True)
        rule = StatutoryRule("sc-pwd", frozenset({Eligibility.SENIOR}), enabled=True,
                             verification=Verification("u-owner", T0, "counsel memo #1"))
        calc = PriceCalculator(TaxSettings(enabled=False, mode=TaxMode.INCLUDED), CUR, (rule,))
        with self.assertRaises(UndecidedPolicy):
            calc.price([PricingLine(m("100.00"), TaxClass.TAXABLE)], senior_discount())
        # disabled rule → ordinary pricing
        calc = PriceCalculator(TaxSettings(enabled=False, mode=TaxMode.INCLUDED), CUR,
                               (StatutoryRule("sc-pwd", frozenset({Eligibility.SENIOR})),))
        self.assertEqual(calc.price([PricingLine(m("100.00"), TaxClass.TAXABLE)], senior_discount()).total,
                         m("80.00"))


if __name__ == "__main__":
    unittest.main()
