"""Phase 5 back-office endpoints: category/choice-group/ingredient/expense edits, stock movements,
thresholds, recipes and staff management — against the real database through the API."""

import unittest
import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from db_support import DbTestCase


class AdminCatalogTests(DbTestCase):
    def test_category_edit_and_deactivate_persist(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        r = self.call("PATCH", f"/categories/{ids['category']}", env["admin"], {"name": "Hot Coffee", "active": False},
                      expect=200).json()
        self.assertEqual((r["name"], r["active"]), ("Hot Coffee", False))
        listed = self.call("GET", "/categories", env["admin"], expect=200).json()
        self.assertEqual([(c["name"], c["active"]) for c in listed], [("Hot Coffee", False)])
        self.call("POST", "/categories", env["admin"], {"name": "Tea", "code_prefix": "TEA"}, expect=201)
        dup = self.call("PATCH", f"/categories/{ids['category']}", env["admin"], {"name": "Tea"}, expect=409)
        self.assertEqual(self.error_code(dup), "CONFLICT")
        blank = self.call("PATCH", f"/categories/{ids['category']}", env["admin"], {"name": " "}, expect=422)
        self.assertEqual(self.error_code(blank), "VALIDATION_ERROR")

    def test_choice_group_edit_adds_updates_and_deactivates_options(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        g = self.call("POST", "/choice-groups", env["admin"], {
            "code": "SIZE", "name": "Size", "selection_type": "single", "required": True, "min_select": 1,
            "max_select": 1, "options": [{"name": "Small", "price_delta": "0"}, {"name": "Large", "price_delta": "20"}]},
            expect=201).json()
        small, large = g["options"]
        r = self.call("PATCH", f"/choice-groups/{g['id']}", env["admin"], {
            "name": "Cup Size", "options": [{"id": small["id"], "name": "Small", "price_delta": "0"},
                                            {"name": "Medium", "price_delta": "10"}]}, expect=200).json()
        self.assertEqual(r["name"], "Cup Size")
        by_name = {o["name"]: o for o in r["options"]}
        self.assertEqual(set(by_name), {"Small", "Large", "Medium"})
        self.assertFalse(by_name["Large"]["active"])  # left out → deactivated, never deleted
        self.assertEqual(by_name["Medium"]["price_delta"], "10.00")
        bad = self.call("PATCH", f"/choice-groups/{g['id']}", env["admin"], {"max_select": 2}, expect=422)
        self.assertEqual(self.error_code(bad), "VALIDATION_ERROR")  # single-select allows one option
        # Deactivated option can no longer be ordered; the group still works with active options.
        self.call("PATCH", f"/products/{ids['cookie']}", env["admin"], {"choice_group_ids": [g["id"]]}, expect=200)
        self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1,
                                   "selections": {g["id"]: [large["id"]]}}], expect=422)
        self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1,
                                   "selections": {g["id"]: [by_name["Medium"]["id"]]}}], expect=201)

    def test_stock_movements_threshold_and_ingredients(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        self.call("POST", f"/inventory/{ids['latte']}/restock", env["admin"], {"quantity": "5"}, key=str(uuid.uuid4()),
                  expect=200)
        moves = self.call("GET", f"/inventory/{ids['latte']}/movements", env["admin"], expect=200).json()
        self.assertEqual([m["type"] for m in moves], ["restock", "initial"])
        self.assertEqual(moves[0]["on_hand_after"], "15.000")
        level = self.call("PATCH", f"/inventory/{ids['latte']}", env["admin"], {"low_stock_threshold": "20"},
                          expect=200).json()
        self.assertEqual(level["status"], "low")
        self.call("PATCH", f"/inventory/{ids['latte']}", env["admin"], {"low_stock_threshold": "1.5"}, expect=422)

        ing = self.call("POST", "/ingredients", env["admin"], {
            "code": "MILK", "name": "Fresh Milk", "unit": "ml", "unit_cost": "0.08", "initial_stock": "1000",
            "low_stock_threshold": "200"}, expect=201).json()
        listed = self.call("GET", "/ingredients", env["admin"], expect=200).json()
        self.assertEqual(listed[0]["name"], "Fresh Milk")
        self.assertEqual(listed[0]["stock"]["on_hand"], "1000.000")
        upd = self.call("PATCH", f"/ingredients/{ing['id']}", env["admin"], {"unit_cost": "0.09", "active": False},
                        expect=200).json()
        self.assertEqual((Decimal(upd["unit_cost"]), upd["active"]), (Decimal("0.09"), False))
        self.call("PATCH", f"/ingredients/{ing['id']}", env["admin"], {"unit": "L"}, expect=422)
        self.call("PATCH", f"/ingredients/{ing['id']}", env["admin"], {"active": True}, expect=200)
        self.call("PUT", f"/products/{ids['latte']}/recipe", env["admin"],
                  {"lines": [{"ingredient_id": ing["id"], "quantity": "150"}]}, expect=200)
        recipe = self.call("GET", f"/products/{ids['latte']}/recipe", env["admin"], expect=200).json()
        self.assertEqual(recipe["lines"], [{"ingredient_id": ing["id"], "quantity": "150.000"}])
        moves = self.call("GET", f"/ingredients/{ing['id']}/movements", env["admin"], expect=200).json()
        self.assertEqual(moves[0]["type"], "initial")


class AdminStaffAndExpenseTests(DbTestCase):
    def test_staff_edit_status_and_credential_reset(self):
        env = self.bootstrap()
        self.make_cashier(env["admin"], env["device"])
        staff = {s["username"]: s for s in self.call("GET", "/staff", env["admin"], expect=200).json()}
        maria, owner = staff["maria"], staff["owner"]
        r = self.call("PATCH", f"/staff/{maria['id']}", env["admin"], {"full_name": "Maria C. Cruz"}, expect=200).json()
        self.assertEqual(r["full_name"], "Maria C. Cruz")
        pending = self.call("PATCH", f"/staff/{maria['id']}", env["admin"], {"username": "mcruz"}, expect=409)
        self.assertEqual(self.error_code(pending), "DECISION_PENDING")
        # PIN account cannot become Admin (Admin → password only).
        self.assertEqual(self.error_code(self.call("PATCH", f"/staff/{maria['id']}", env["admin"], {"role": "admin"},
                                                   expect=422)), "AUTH_METHOD_NOT_ALLOWED")
        # Last active Admin is protected; no self-escalation/demotion.
        self.call("POST", f"/staff/{owner['id']}/deactivate", env["admin"], expect=403)
        self.call("PATCH", f"/staff/{owner['id']}", env["admin"], {"role": "cashier"}, expect=403)
        # Deactivation ends the cashier's sessions; activation restores sign-in.
        token = self.call("POST", "/auth/login", json={"username": "maria", "credential": "5678"},
                          device=env["device"], expect=200).json()["token"]
        self.assertEqual(self.call("POST", f"/staff/{maria['id']}/deactivate", env["admin"], expect=200).json()["status"],
                         "inactive")
        self.call("GET", "/auth/me", token, expect=401)
        self.call("POST", "/auth/login", json={"username": "maria", "credential": "5678"}, device=env["device"],
                  expect=401)
        self.call("POST", f"/staff/{maria['id']}/activate", env["admin"], expect=200)
        reset = self.call("POST", f"/staff/{maria['id']}/reset-credential", env["admin"], {"credential": "4321"},
                          expect=200).json()
        self.assertTrue(reset["must_change_credential"])
        self.assertNotIn("4321", str(reset))
        self.call("POST", "/auth/login", json={"username": "maria", "credential": "4321"}, device=env["device"],
                  expect=200)

    def test_expense_edit_persists(self):
        env = self.bootstrap()
        today = datetime.now(ZoneInfo("Asia/Manila")).date().isoformat()  # the test business timezone
        e = self.call("POST", "/expenses", env["admin"], {"category": "Supplies", "description": "Cups",
                                                           "amount": "120.00", "expense_date": today,
                                                           "payment_method": "Cash"}, expect=201).json()
        r = self.call("PATCH", f"/expenses/{e['id']}", env["admin"], {"amount": "150.50", "category": "Other"},
                      expect=200).json()
        self.assertEqual((r["amount"], r["category"], r["code"]), ("150.50", "Other", e["code"]))
        listed = self.call("GET", "/expenses", env["admin"], expect=200).json()
        self.assertEqual(listed[0]["amount"], "150.50")
        self.call("PATCH", f"/expenses/{e['id']}", env["admin"], {"payment_method": "Cheque"}, expect=422)



class AccountAndBusinessSettingsTests(DbTestCase):
    def test_business_settings_update_the_business_record(self):
        env = self.bootstrap()
        got = self.call("GET", "/settings/business", env["admin"], expect=200).json()
        self.assertEqual((got["configured"], got["data"]["name"], got["data"]["currency_code"]), (False, "Test Café", "PHP"))
        data = {**got["data"], "name": "Test Café Makati", "address": "1 Ayala Ave", "tagline": "Fresh daily"}
        saved = self.call("PUT", "/settings/business", env["admin"], {"version": 0, "data": data}, expect=200).json()
        self.assertEqual(saved["version"], 1)
        again = self.call("GET", "/settings/business", env["admin"], expect=200).json()["data"]
        self.assertEqual((again["name"], again["address"], again["tagline"]), ("Test Café Makati", "1 Ayala Ave", "Fresh daily"))
        self.assertEqual(self.scalar("select name from {s}.businesses"), "Test Café Makati")
        changed = self.call("PUT", "/settings/business", env["admin"],
                            {"version": 1, "data": {**data, "currency_code": "USD"}}, expect=409)
        self.assertEqual(self.error_code(changed), "CONFLICT")
        self.call("PUT", "/settings/business", env["admin"], {"version": 1, "data": {**data, "name": ""}}, expect=422)

    def test_me_details_and_own_name_change(self):
        env = self.bootstrap()
        me = self.call("GET", "/auth/me", env["admin"], expect=200).json()
        self.assertEqual((me["username"], me["auth_method"], me["terminal_code"]), ("owner", "password", "REG-01"))
        self.assertNotIn("password_hash", me)
        r = self.call("PATCH", "/auth/me", env["admin"], {"full_name": "Owner A. Admin"}, expect=200).json()
        self.assertEqual(r["full_name"], "Owner A. Admin")
        self.call("PATCH", "/auth/me", env["admin"], {"full_name": " "}, expect=422)


if __name__ == "__main__":
    unittest.main()
