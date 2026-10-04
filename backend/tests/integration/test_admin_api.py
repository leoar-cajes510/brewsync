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
        # A product in an inactive category is hidden on the POS, and the server refuses to sell it.
        refused = self.call("POST", "/orders", env["admin"], {"order_type": "takeout",
                            "lines": [{"product_id": ids["latte"], "quantity": 1}]}, key="inactive-cat", expect=422)
        self.assertIn("category is inactive", refused.json()["error"]["message"])
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.orders"), 0)

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

    def test_max_admins_applies_to_promotion_and_reactivation(self):
        env = self.bootstrap()
        admin = env["admin"]
        # SETUP allows 2 Admins: owner + one more.
        extra = self.call("POST", "/staff", admin, {"username": "second", "full_name": "Second Admin", "role": "admin",
                                                   "auth_method": "password", "credential": "second-pass-1"},
                          expect=201).json()
        clerk = self.call("POST", "/staff", admin, {"username": "clerk", "full_name": "Clerk", "role": "cashier",
                                                   "auth_method": "password", "credential": "clerk-pass-12"},
                          expect=201).json()
        r = self.call("PATCH", f"/staff/{clerk['id']}", admin, {"role": "admin"}, expect=409)
        self.assertEqual(self.error_code(r), "LIMIT_REACHED")
        self.assertEqual(self.scalar("SELECT r.key FROM {s}.users u JOIN {s}.roles r ON r.id = u.role_id "
                                     "WHERE u.id = :id", id=clerk["id"]), "cashier")
        self.call("POST", f"/staff/{extra['id']}/deactivate", admin, expect=200)
        self.call("PATCH", f"/staff/{clerk['id']}", admin, {"role": "admin"}, expect=200)
        r = self.call("POST", f"/staff/{extra['id']}/activate", admin, expect=409)
        self.assertEqual(self.error_code(r), "LIMIT_REACHED")
        self.assertEqual(self.scalar("SELECT status FROM {s}.users WHERE id = :id", id=extra["id"]), "inactive")

    def test_ingredient_rename_is_audited_and_booleans_are_strict(self):
        env = self.bootstrap()
        admin = env["admin"]
        ing = self.call("POST", "/ingredients", admin, {"code": "ING-01", "name": "Beans", "unit": "g", "unit_cost": "1.75",
                        "initial_stock": "100", "low_stock_threshold": "10"}, expect=201).json()
        r = self.call("POST", "/ingredients", admin, {"name": "Milk", "unit": "ml", "initial_stock": "1",
                      "low_stock_threshold": "1"}, expect=422)  # a code is required, never stored empty
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        count = "SELECT count(*) FROM {s}.audit_logs WHERE action = 'ingredient.updated' AND entity_id = :id"
        self.call("PATCH", f"/ingredients/{ing['id']}", admin, {"name": "Espresso Beans"}, expect=200)
        self.assertEqual(self.scalar("SELECT name FROM {s}.ingredients WHERE id = :id", id=ing["id"]), "Espresso Beans")
        self.assertEqual(self.scalar("SELECT before->>'name' || '>' || (after->>'name') FROM {s}.audit_logs "
                                     "WHERE action = 'ingredient.updated' AND entity_id = :id", id=ing["id"]),
                         "Beans>Espresso Beans")
        self.call("PATCH", f"/ingredients/{ing['id']}", admin, {"name": "Espresso Beans", "unit_cost": "1.7500"}, expect=200)
        self.assertEqual(self.scalar(count, id=ing["id"]), 1)  # no-op edit is not audited
        # JSON booleans only: "false" is refused, never read as true.
        for value in ("false", "true", "yes", 0):
            r = self.call("PATCH", f"/ingredients/{ing['id']}", admin, {"active": value}, expect=422)
            self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        self.assertTrue(self.scalar("SELECT active FROM {s}.ingredients WHERE id = :id", id=ing["id"]))
        self.call("PATCH", f"/ingredients/{ing['id']}", admin, {"active": None}, expect=200)  # null = unchanged
        self.assertTrue(self.scalar("SELECT active FROM {s}.ingredients WHERE id = :id", id=ing["id"]))
        self.call("PATCH", f"/ingredients/{ing['id']}", admin, {"active": False}, expect=200)
        self.assertFalse(self.scalar("SELECT active FROM {s}.ingredients WHERE id = :id", id=ing["id"]))
        g = self.call("POST", "/choice-groups", admin, {"name": "Size", "selection_type": "single", "required": "false",
                      "min_select": 0, "max_select": 1, "options": [{"name": "Small"}]}, expect=422)
        self.assertEqual(self.error_code(g), "VALIDATION_ERROR")
        g = self.call("POST", "/choice-groups", admin, {"name": "Size", "selection_type": "single", "required": False,
                      "min_select": 0, "max_select": 1, "options": [{"name": "Small"}]}, expect=201).json()
        self.assertFalse(g["required"])
        self.call("PATCH", f"/choice-groups/{g['id']}", admin, {"active": "false"}, expect=422)
        self.assertTrue(self.scalar("SELECT active FROM {s}.choice_groups WHERE id = :id", id=g["id"]))
        d = self.call("POST", "/discounts", admin, {"name": "Promo", "type": "percentage", "value": "10"}, expect=201).json()
        self.call("PATCH", f"/discounts/{d['id']}", admin, {"active": "false"}, expect=422)
        self.call("PATCH", f"/discounts/{d['id']}", admin, {"active": False}, expect=200)
        self.assertFalse(self.scalar("SELECT active FROM {s}.discounts WHERE id = :id", id=d["id"]))

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
