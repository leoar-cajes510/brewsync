import unittest
from decimal import Decimal

from domain_support import CUR, m, percent_discount, tax_settings
from app.domain.discount import Discount, DiscountType, Eligibility
from app.domain.errors import EmptyOrder, ValidationError
from app.domain.pricing import PriceCalculator, PricingLine
from app.domain.tax import TaxClass, TaxMode, TaxSettings

TAXABLE, NON = TaxClass.TAXABLE, TaxClass.NON_TAXABLE


class TaxSettingsTests(unittest.TestCase):
    def test_rate_is_configuration_not_hard_coded(self):
        with self.assertRaises(ValidationError):
            TaxSettings(enabled=True, mode=TaxMode.INCLUDED, name="VAT")  # no rate → invalid
        with self.assertRaises(ValidationError):
            TaxSettings(enabled=True, mode=TaxMode.INCLUDED, name="", rate=Decimal("5"))
        with self.assertRaises(ValidationError):
            TaxSettings(enabled=True, mode=TaxMode.INCLUDED, name="Tax", rate=Decimal("150"))
        self.assertFalse(TaxSettings(enabled=False, mode=TaxMode.INCLUDED).applies_to(TAXABLE))

    def test_included_and_excluded_formulas(self):
        self.assertEqual(tax_settings("10", TaxMode.INCLUDED).tax_on(m("110.00")), m("10.00"))
        self.assertEqual(tax_settings("10", TaxMode.EXCLUDED).tax_on(m("100.00")), m("10.00"))
        self.assertEqual(tax_settings("7", TaxMode.EXCLUDED).tax_on(m("0.50")), m("0.04"))  # 0.035 → 0.04


class PricingTests(unittest.TestCase):
    def test_ordinary_discount_applies_before_tax_excluded_mode(self):
        calc = PriceCalculator(tax_settings("10", TaxMode.EXCLUDED), CUR)
        r = calc.price([PricingLine(m("500.00"), TAXABLE)], percent_discount("20"))
        self.assertEqual((r.subtotal, r.discount_total, r.tax_amount, r.net_amount, r.total),
                         (m("500.00"), m("100.00"), m("40.00"), m("400.00"), m("440.00")))

    def test_included_mode_total_is_discounted_price(self):
        calc = PriceCalculator(tax_settings("10", TaxMode.INCLUDED), CUR)
        r = calc.price([PricingLine(m("220.00"), TAXABLE)], percent_discount("50"))
        self.assertEqual((r.total, r.tax_amount, r.net_amount), (m("110.00"), m("10.00"), m("100.00")))

    def test_per_product_taxability_with_pro_rata_discount(self):
        fixed = Discount(id="d", name="Fixed 40", type=DiscountType.FIXED, value=Decimal("40"),
                         eligibility=Eligibility.ALL, currency=CUR)
        calc = PriceCalculator(tax_settings("10", TaxMode.EXCLUDED), CUR)
        r = calc.price([PricingLine(m("300.00"), TAXABLE), PricingLine(m("100.00"), NON)], fixed)
        self.assertEqual(r.line_discounts, (m("30.00"), m("10.00")))
        breakdown = {e.tax_class: (e.taxable_amount, e.tax_amount) for e in r.tax_breakdown}
        self.assertEqual(breakdown[TAXABLE], (m("270.00"), m("27.00")))
        self.assertEqual(breakdown[NON], (m("90.00"), m("0.00")))
        self.assertEqual(r.total, m("387.00"))

    def test_tax_disabled_and_empty_order(self):
        calc = PriceCalculator(TaxSettings(enabled=False, mode=TaxMode.INCLUDED), CUR)
        r = calc.price([PricingLine(m("99.99"), TAXABLE)])
        self.assertEqual((r.total, r.tax_amount, r.tax_rate), (m("99.99"), m("0.00"), None))
        with self.assertRaises(EmptyOrder):
            calc.price([])

    def test_tax_computed_once_per_class_not_per_line(self):
        calc = PriceCalculator(tax_settings("7", TaxMode.EXCLUDED), CUR)
        r = calc.price([PricingLine(m("0.50"), TAXABLE)] * 3)  # per-line would be 3 × 0.04 = 0.12
        self.assertEqual(r.tax_amount, m("0.11"))  # 1.50 × 7 % = 0.105 → 0.11


if __name__ == "__main__":
    unittest.main()
