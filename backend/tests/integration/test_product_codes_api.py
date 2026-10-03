import json
import unittest
from concurrent.futures import ThreadPoolExecutor

from db_support import DbTestCase


class ProductCodeTests(DbTestCase):
    def setUp(self):
        super().setUp()
        self.env = self.bootstrap()
        self.admin = self.env["admin"]

    def category(self, name, prefix, expect=201):
        return self.call("POST", "/categories", self.admin, {"name": name, "code_prefix": prefix}, expect=expect)

    def product(self, category_id, name="Item", expect=201, **extra):
        body = {"name": name, "category_id": category_id, "price": "100.00", "tax_class": "taxable", **extra}
        return self.call("POST", "/products", self.admin, body, expect=expect)

    # --- categories -----------------------------------------------------------------------------------------
    def test_category_prefix_is_stored_uppercase_and_listed(self):
        cat = self.category("Coffee", "cof").json()
        self.assertEqual(cat["code_prefix"], "COF")
        listed = self.call("GET", "/categories", self.admin, expect=200).json()
        self.assertEqual([(c["name"], c["code_prefix"]) for c in listed], [("Coffee", "COF")])

    def test_prefix_required_valid_and_unique(self):
        self.assertEqual(self.error_code(self.call("POST", "/categories", self.admin, {"name": "Coffee"},
                                                   expect=422)), "VALIDATION_ERROR")
        self.category("Coffee", "C0-F", expect=422)
        self.category("Coffee", "COF")
        dup = self.category("Cold Brew", "cof", expect=409)
        self.assertEqual(self.error_code(dup), "CONFLICT")

    def test_prefix_cannot_be_changed(self):
        cat = self.category("Coffee", "COF").json()
        r = self.call("PATCH", f"/categories/{cat['id']}", self.admin, {"code_prefix": "CAF"}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        self.call("PATCH", f"/categories/{cat['id']}", self.admin, {"code_prefix": "cof"}, expect=200)

    # --- generation -----------------------------------------------------------------------------------------
    def test_codes_are_generated_per_category_in_sequence(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        tea = self.category("Tea", "TEA").json()["id"]
        self.assertEqual(self.product(coffee, "Latte").json()["code"], "COF-001")
        self.assertEqual(self.product(coffee, "Mocha").json()["code"], "COF-002")
        self.assertEqual(self.product(tea, "Green Tea").json()["code"], "TEA-001")
        self.assertEqual(self.product(coffee, "Flat White").json()["code"], "COF-003")

    def test_concurrent_creation_gets_distinct_codes(self):
        coffee = self.category("Coffee", "COF").json()["id"]

        def create(i):
            return self.call("POST", "/products", self.admin, {
                "name": f"Drink {i}", "category_id": coffee, "price": "100.00", "tax_class": "taxable"})

        with ThreadPoolExecutor(max_workers=5) as pool:
            responses = list(pool.map(create, range(5)))
        self.assertEqual([r.status_code for r in responses], [201] * 5)
        self.assertEqual(sorted(r.json()["code"] for r in responses), [f"COF-00{n}" for n in range(1, 6)])

    def test_generator_skips_a_code_already_taken(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        self.product(coffee, "Manual", code="COF-001")
        self.assertEqual(self.product(coffee, "Auto").json()["code"], "COF-002")

    def test_duplicate_gets_next_generated_code(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        original = self.product(coffee, "Latte").json()
        copy = self.product(coffee, "Latte (Copy)").json()  # the UI's Duplicate sends no code
        self.assertEqual((original["code"], copy["code"]), ("COF-001", "COF-002"))

    # --- explicit codes (backward-compatible API) --------------------------------------------------------------
    def test_explicit_code_is_uppercased_and_unique(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        self.assertEqual(self.product(coffee, "Latte", code="latte").json()["code"], "LATTE")
        dup = self.product(coffee, "Latte 2", code="LATTE", expect=409)
        self.assertEqual(self.error_code(dup), "CONFLICT")
        self.product(coffee, "Latte 3", code="Latte", expect=409)

    # --- immutability ---------------------------------------------------------------------------------------
    def test_code_cannot_be_changed_after_creation(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        p = self.product(coffee).json()
        r = self.call("PATCH", f"/products/{p['id']}", self.admin, {"code": "COF-999"}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        self.call("PATCH", f"/products/{p['id']}", self.admin, {"code": "cof-001", "name": "Renamed"}, expect=200)
        self.assertEqual(self.scalar("select code from {s}.products where id = :i", i=p["id"]), "COF-001")

    def test_category_rename_and_product_move_keep_codes(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        tea = self.category("Tea", "TEA").json()["id"]
        p = self.product(coffee).json()
        self.call("PATCH", f"/categories/{coffee}", self.admin, {"name": "Hot Coffee"}, expect=200)
        moved = self.call("PATCH", f"/products/{p['id']}", self.admin, {"category_id": tea}, expect=200).json()
        self.assertEqual((moved["code"], moved["category_id"]), ("COF-001", tea))
        self.assertEqual(self.product(tea, "Chai").json()["code"], "TEA-001")  # Tea counter unaffected

    # --- legacy data and history ----------------------------------------------------------------------------
    def test_legacy_code_and_historical_snapshots_are_untouched(self):
        coffee = self.category("Coffee", "COF").json()["id"]
        legacy = self.product(coffee, "Americano", code="AMERICANO", price="120.00").json()
        order = self.order(self.admin, [{"product_id": legacy["id"], "quantity": 1}]).json()
        paid = self.pay(self.admin, order["id"], {"method": "cash", "amount": "120.00", "tendered": "120.00"}).json()
        self.assertEqual(paid["payment_status"], "paid")

        self.assertEqual(self.product(coffee, "Latte").json()["code"], "COF-001")  # counter starts at 001
        self.call("PATCH", f"/categories/{coffee}", self.admin, {"name": "Coffee Bar"}, expect=200)

        self.assertEqual(self.scalar("select code from {s}.products where id = :i", i=legacy["id"]), "AMERICANO")
        self.assertEqual(self.scalar("select product_code from {s}.order_items where order_id = :o",
                                     o=order["id"]), "AMERICANO")
        snapshot = self.scalar("select snapshot from {s}.documents where order_id = :o", o=order["id"])
        snapshot = snapshot if isinstance(snapshot, dict) else json.loads(snapshot)
        self.assertEqual([i["code"] for i in snapshot["items"]], ["AMERICANO"])


if __name__ == "__main__":
    unittest.main()
