"""Discounts, tax, expenses and duplicate-creation protection through the real API."""

import unittest
import uuid
from datetime import date, timedelta
from decimal import Decimal

from db_support import DbTestCase


class DiscountTaxTests(DbTestCase):
    def setup_shop(self) -> dict:
        env = self.bootstrap()
        admin = env["admin"]
        ids = self.catalog(admin, stock=50)
        self.call("PUT", "/settings/tax", admin, {"version": 1, "data": {
            "enabled": True, "mode": "excluded", "name": "VAT", "rate": "10"}}, expect=200)
        pct = self.call("POST", "/discounts", admin, {"name": "Promo 20", "type": "percentage", "value": "20",
                                                     "eligibility": "all", "max_discount": "40.00"}, expect=201).json()
        fixed = self.call("POST", "/discounts", admin, {"name": "Less 15", "type": "fixed", "value": "15",
                                                       "eligibility": "all", "min_order": "200.00"}, expect=201).json()
        senior = self.call("POST", "/discounts", admin, {
            "name": "Senior Citizen", "type": "percentage", "value": "20", "eligibility": "senior",
            "requires_identification": True, "identification_fields": ["customer_name", "id_number"]}, expect=201).json()
        return {**env, **ids, "pct": pct["id"], "fixed": fixed["id"], "senior": senior["id"]}

    def lines(self, env: dict) -> list[dict]:
        return [{"product_id": env["latte"], "quantity": 1}, {"product_id": env["cookie"], "quantity": 1}]

    def test_quote_and_order_agree_and_discount_applies_before_tax(self):
        env = self.setup_shop()
        body = {"order_type": "takeout", "lines": self.lines(env), "discount": {"discount_id": env["pct"]}}
        q = self.call("POST", "/orders/quote", env["admin"], body, expect=200).json()
        o = self.order(env["admin"], body["lines"], discount=body["discount"], expected_total=q["total"]).json()
        t = o["totals"]
        self.assertEqual(q["total"], t["total"])
        self.assertEqual(t["discount_total"], "40.00")  # 20 % of 350 = 70, capped at 40
        taxable = next(e for e in t["tax_breakdown"] if e["tax_class"] == "taxable")
        self.assertEqual(Decimal(taxable["tax_amount"]), (Decimal(taxable["taxable_amount"]) * Decimal("0.10")).quantize(Decimal("0.01")))
        self.assertLess(Decimal(taxable["taxable_amount"]), Decimal("250.00"))  # discount reduced the taxable base
        self.assertEqual(Decimal(t["total"]), Decimal(t["net_amount"]) + Decimal(t["tax_amount"]))
        self.assertEqual(Decimal(t["net_amount"]), Decimal("310.00"))
        alloc = sum(Decimal(i["discount_allocation"]) for i in o["items"])
        self.assertEqual(alloc, Decimal("40.00"))
        # history / receipt show the same totals after payment
        self.pay(env["admin"], o["id"], {"method": "card", "amount": t["total"]})
        self.status(env["admin"], o["id"], "completed")
        h = self.call("GET", f"/history/{o['id']}", env["admin"], expect=200).json()
        self.assertEqual(h["totals"], t)
        doc = self.call("GET", f"/documents/{h['document']['id']}", env["admin"], expect=200).json()
        self.assertIn(t["total"], str(doc))

    def test_min_order_identification_and_one_discount(self):
        env = self.setup_shop()
        r = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}], discount={"discount_id": env["fixed"]},
                       expect=422)
        self.assertEqual(self.error_code(r), "DISCOUNT_MIN_ORDER")
        r = self.order(env["admin"], self.lines(env), discount={"discount_id": env["senior"]}, expect=422)
        self.assertEqual(self.error_code(r), "IDENTIFICATION_REQUIRED")
        o = self.order(env["admin"], self.lines(env), discount={"discount_id": env["senior"], "identification": {
            "customer_name": "Lola Cruz", "id_number": "SC-123456"}}).json()
        self.assertTrue(o["discount"]["identification_captured"])
        self.assertNotIn("SC-123456", str(o))  # masked in API payloads
        self.assertNotIn("SC-123456", str(self.call("GET", "/audit", env["admin"]).json()))
        r = self.call("POST", "/orders", env["admin"], {"order_type": "takeout", "lines": self.lines(env),
                                                        "discount": [{"discount_id": env["pct"]}, {"discount_id": env["fixed"]}]},
                      key=str(uuid.uuid4()))
        self.assertEqual(r.status_code, 422)  # stacking is not even expressible

    def test_discount_permission_feature_and_inactive(self):
        env = self.setup_shop()
        cashier = self.make_cashier(env["admin"], env["device"])
        self.call("PUT", "/settings/permissions", env["admin"], {"roles": {"cashier": {"pos.applyDiscounts": False}}},
                  expect=200)
        r = self.order(cashier, self.lines(env), discount={"discount_id": env["pct"]}, expect=403)
        self.assertEqual(self.error_code(r), "PERMISSION_DENIED")
        self.call("POST", f"/discounts/{env['pct']}/deactivate", env["admin"], expect=200)
        r = self.order(env["admin"], self.lines(env), discount={"discount_id": env["pct"]}, expect=None)
        self.assertIn(r.status_code, (404, 409, 422))
        features = {**self.SETUP["settings"]["features"], "discounts": False}
        self.call("PUT", "/settings/features", env["admin"], {"version": 1, "data": features}, expect=200)
        r = self.order(env["admin"], self.lines(env), discount={"discount_id": env["fixed"]}, expect=403)
        self.assertEqual(self.error_code(r), "FEATURE_DISABLED")
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)

    def test_invalid_discount_definitions_rejected(self):
        env = self.setup_shop()
        for body in ({"name": "Neg", "type": "fixed", "value": "-5", "eligibility": "all"},
                     {"name": "Zero", "type": "percentage", "value": "0", "eligibility": "all"},
                     {"name": "Over", "type": "percentage", "value": "150", "eligibility": "all"},
                     {"name": "Bad", "type": "bogus", "value": "5", "eligibility": "all"}):
            r = self.call("POST", "/discounts", env["admin"], body)
            self.assertEqual(r.status_code, 422, (body, r.text))

    def test_non_taxable_only_order_has_no_tax_and_mixed_quantities_round(self):
        env = self.setup_shop()
        o = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 3}]).json()
        self.assertEqual((o["totals"]["tax_amount"], o["totals"]["total"]), ("0.00", "300.00"))
        o = self.order(env["admin"], [{"product_id": env["latte"], "quantity": 3}]).json()
        self.assertEqual((o["totals"]["tax_amount"], o["totals"]["total"]), ("75.00", "825.00"))


class ExpenseAndDuplicateTests(DbTestCase):
    def test_expense_validation_idempotency_and_no_inventory_effect(self):
        env = self.bootstrap()
        admin = env["admin"]
        good = {"category": "Supplies", "description": "Cups", "amount": "120.50",
                "expense_date": date.today().isoformat(), "payment_method": "Cash"}
        for bad in ({**good, "amount": "0"}, {**good, "amount": "-5"}, {**good, "amount": "1.234"},
                    {**good, "amount": "abc"}, {**good, "category": "Bribes"},
                    {**good, "expense_date": (date.today() + timedelta(days=3)).isoformat()}):
            self.assertEqual(self.call("POST", "/expenses", admin, bad).status_code, 422, bad)
        first = self.call("POST", "/expenses", admin, good, key="exp-1", expect=201).json()
        again = self.call("POST", "/expenses", admin, good, key="exp-1", expect=201).json()
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(self.scalar("select count(*) from {s}.expenses"), 1)
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        self.assertGreaterEqual(self.scalar("select count(*) from {s}.audit_logs where action='expense.recorded'"), 1)
        cashier = self.make_cashier(admin, env["device"])
        self.call("PUT", "/settings/permissions", admin, {"roles": {"cashier": {"expenses.record": False}}}, expect=200)
        self.call("POST", "/expenses", cashier, good, expect=403)

    def test_product_creation_is_idempotent_with_a_key(self):
        env = self.bootstrap()
        cat = self.call("POST", "/categories", env["admin"], {"name": "Tea", "code_prefix": "TEA"}, expect=201).json()["id"]
        body = {"name": "Matcha", "category_id": cat, "price": "150.00", "tax_class": "taxable"}
        a = self.call("POST", "/products", env["admin"], body, key="prod-1", expect=201).json()
        b = self.call("POST", "/products", env["admin"], body, key="prod-1", expect=201).json()
        self.assertEqual(a["id"], b["id"])
        self.assertEqual(self.scalar("select count(*) from {s}.products"), 1)


if __name__ == "__main__":
    unittest.main()
