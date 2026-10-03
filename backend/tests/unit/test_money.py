import unittest
from decimal import Decimal

from domain_support import CUR, m
from app.domain.errors import CurrencyMismatch, InvalidMoney
from app.domain.money import Money, round_money


class MoneyTests(unittest.TestCase):
    def test_exact_decimal_arithmetic(self):
        self.assertEqual(m("0.10") + m("0.20"), m("0.30"))  # no float drift
        self.assertEqual(m("500.00") - m("300.00"), m("200.00"))
        self.assertEqual(m("45.50") * 3, m("136.50"))
        self.assertEqual(m("10.00") * Decimal("0.125"), m("1.25"))

    def test_multiplication_rounds_half_up_to_two_decimals(self):
        self.assertEqual(m("0.05") * Decimal("0.5"), m("0.03"))  # 0.025 → 0.03
        self.assertEqual(m("1.00") * Decimal("0.3333"), m("0.33"))
        self.assertEqual(round_money(Decimal("2.345")), Decimal("2.35"))
        self.assertEqual(Money.rounded("2.344", CUR), m("2.34"))

    def test_floats_and_bad_values_rejected(self):
        with self.assertRaises(InvalidMoney):
            Money(0.1, CUR)  # type: ignore[arg-type]
        with self.assertRaises(InvalidMoney):
            m("1.005")  # more than 2 decimals must go through Money.rounded
        with self.assertRaises(InvalidMoney):
            Money.of("NaN", CUR)
        with self.assertRaises(InvalidMoney):
            Money.of("1.00", "peso")
        with self.assertRaises(InvalidMoney):
            m("1.00") * 1.5  # type: ignore[operator]

    def test_comparison_zero_and_sign(self):
        self.assertTrue(m("1.00") > m("0.99"))
        self.assertTrue(Money.zero(CUR).is_zero)
        with self.assertRaises(InvalidMoney):
            m("-1.00").require_non_negative("amount")
        self.assertTrue((m("1.00") - m("2.00")).is_negative)

    def test_currency_mismatch(self):
        with self.assertRaises(CurrencyMismatch):
            m("1.00") + Money.of("1.00", "USD")
        with self.assertRaises(CurrencyMismatch):
            m("1.00") < Money.of("1.00", "USD")

    def test_pro_rata_allocation_sums_exactly(self):
        parts = m("0.10").allocate_pro_rata([m("1.00"), m("1.00"), m("1.00")])
        self.assertEqual(parts, [m("0.04"), m("0.03"), m("0.03")])  # tie → first line
        self.assertEqual(m("40.00").allocate_pro_rata([m("300.00"), m("100.00")]), [m("30.00"), m("10.00")])


if __name__ == "__main__":
    unittest.main()
