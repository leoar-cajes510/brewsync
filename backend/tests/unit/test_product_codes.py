import unittest

from domain_support import m
from app.domain.errors import ValidationError
from app.domain.product import Category, Product, generate_product_code, normalize_code_prefix
from app.domain.tax import TaxClass


class CategoryPrefixTests(unittest.TestCase):
    def test_prefix_is_stored_uppercase(self):
        self.assertEqual(Category(id="c", name="Coffee", code_prefix=" cof ").code_prefix, "COF")

    def test_prefix_rules(self):
        for bad in ("", "C", "TOOLONG", "1AB", "CO-F", "C F"):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                normalize_code_prefix(bad)
        for good in ("CO", "BRK", "LGT", "TEA2", "ABCDE"):
            self.assertEqual(normalize_code_prefix(good), good)


class GeneratedCodeTests(unittest.TestCase):
    def test_zero_padded_to_three_digits_minimum(self):
        self.assertEqual([generate_product_code("COF", n) for n in (1, 2, 10, 999, 1000)],
                         ["COF-001", "COF-002", "COF-010", "COF-999", "COF-1000"])

    def test_number_must_be_positive(self):
        with self.assertRaises(ValidationError):
            generate_product_code("COF", 0)


class ProductCodeTests(unittest.TestCase):
    def make(self, code):
        return Product(id="p", code=code, name="X", category_id="c", price=m("1.00"), tax_class=TaxClass.TAXABLE)

    def test_code_normalized_to_uppercase(self):
        self.assertEqual(self.make(" cof-001 ").code, "COF-001")

    def test_legacy_code_still_valid(self):
        self.assertEqual(self.make("AMERICANO").code, "AMERICANO")

    def test_invalid_codes_rejected(self):
        for bad in ("", "COF 001", "-COF", "COF-", "CAFÉ", "X" * 41):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                self.make(bad)


if __name__ == "__main__":
    unittest.main()
