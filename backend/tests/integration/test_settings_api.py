import unittest
import uuid

from db_support import DbTestCase


class SettingsTests(DbTestCase):
    def test_versioned_settings_and_validation(self):
        env = self.bootstrap()
        r = self.call("GET", "/settings/tax", env["admin"], expect=200).json()
        self.assertEqual(r["version"], 1)
        self.call("PUT", "/settings/tax", env["admin"], {"version": 1, "data": {"enabled": True, "mode": "included",
                                                                               "name": "VAT", "rate": "5"}}, expect=200)
        r = self.call("PUT", "/settings/tax", env["admin"], {"version": 1, "data": {"enabled": False, "mode": "included"}},
                      expect=409)
        self.assertEqual(self.error_code(r), "VERSION_CONFLICT")
        r = self.call("PUT", "/settings/tax", env["admin"], {"version": 2, "data": {"enabled": True, "mode": "included",
                                                                                   "name": "VAT"}}, expect=422)
        r = self.call("PUT", "/settings/security", env["admin"], {"version": 1, "data": {
            "idle_timeout_minutes": 7, "credential_policy": self.SETUP["security"]["credential_policy"]}}, expect=422)
        self.assertEqual(self.scalar("select count(*) from {s}.settings_history where section='tax'"), 2)

    def test_unconfigured_section_reports_settings_required(self):
        self.complete_setup()
        admin = self.admin_backoffice_token()
        self.execute("delete from {s}.settings_documents where section='staffing'")
        r = self.call("POST", "/terminals", admin, {"code": "REG-09", "name": "x", "activation_code_minutes": 5},
                      expect=201)
        r = self.call("POST", "/terminals/activate", json={"terminal_code": "REG-09",
                                                           "activation_code": r.json()["activation_code"]}, expect=409)
        self.assertEqual(self.error_code(r), "SETTINGS_REQUIRED")


    def test_operational_settings_share_only_the_waiting_threshold(self):
        env = self.bootstrap()
        cashier = self.make_cashier(env["admin"], env["device"])
        data = self.call("GET", "/settings/operational", cashier, expect=200).json()
        self.assertEqual(data["staffing"]["data"], {"order_waiting_minutes": 10})
        self.call("GET", "/settings/staffing", cashier, expect=403)


    def test_request_shape_errors_use_the_error_envelope(self):
        env = self.bootstrap()
        r = self.call("POST", "/orders/quote", env["admin"], {"order_type": "takeout",
                      "lines": [{"product_id": "x", "quantity": 1.5}]}, expect=422)
        body = r.json()
        self.assertEqual(body["error"]["code"], "VALIDATION_ERROR")
        self.assertIn("quantity", body["error"]["message"])
        self.assertNotIn("detail", body)
        r = self.call("POST", "/auth/login", json={"username": "owner"}, expect=422)
        self.assertNotIn("correct-horse", r.text)


    def test_malformed_values_are_validation_errors_not_500(self):
        env = self.bootstrap()
        tax = {"enabled": True, "mode": "weird", "name": "VAT", "rate": "12"}
        r = self.call("PUT", "/settings/tax", env["admin"], {"version": 1, "data": tax}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        r = self.call("POST", "/expenses", env["admin"], {"description": "Milk", "category": "Ingredients",
                      "amount": "100.005", "payment_method": "cash", "expense_date": "2026-01-02"}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.expenses"), 0)
        ids = self.catalog(env["admin"])
        for method, path, body in [("POST", "/discounts", {}), ("POST", "/choice-groups", {"name": "Size"}),
                                   ("POST", "/choice-groups", {"name": "Size", "selection_type": "single", "options": ["x"]}),
                                   ("PUT", f"/products/{ids['latte']}/recipe", {"lines": ["x"]})]:
            r = self.call(method, path, env["admin"], body, expect=422)
            self.assertEqual(self.error_code(r), "VALIDATION_ERROR", (path, r.text))
        r = self.call("POST", "/categories", env["admin"], {"name": "Te\u0000a", "code_prefix": "TEA"}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")
        self.call("GET", "/audit?entity_type=%00", env["admin"], expect=422)
        # Non-text values are refused, never stored as "None" / "{'a': 1}".
        for method, path, body in [("PATCH", "/auth/me", {"full_name": {"a": 1}}),
                                   ("PATCH", f"/categories/{ids['category']}", {"name": None}),
                                   ("POST", "/categories", {"name": ["Tea"], "code_prefix": "TEA"}),
                                   ("POST", "/staff", {"username": 5, "full_name": "X", "role": "cashier",
                                                       "auth_method": "pin", "credential": "1234"})]:
            r = self.call(method, path, env["admin"], body, expect=422)
            self.assertEqual(self.error_code(r), "VALIDATION_ERROR", (path, r.text))
        disc = self.call("POST", "/discounts", env["admin"], {"name": "Promo", "type": "percentage", "value": "10"},
                         expect=201).json()
        self.call("PATCH", f"/discounts/{disc['id']}", env["admin"], {"name": None}, expect=422)
        self.assertEqual(self.scalar("SELECT name FROM {s}.discounts WHERE id = :id", id=disc["id"]), "Promo")
        self.assertEqual(self.scalar("SELECT full_name FROM {s}.users WHERE username = 'owner'"), "Owner Admin")
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.categories WHERE name IN ('None', '')"), 0)
        # PUT /recipe without "lines" is refused instead of emptying the recipe.
        self.call("PUT", f"/products/{ids['latte']}/recipe", env["admin"], {"track_ingredients": False}, expect=422)


class ArchiveTests(DbTestCase):
    def test_manual_archive_restore_and_cancelled_review(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "100.00", "tendered": "100.00"})
        self.status(env["admin"], o["id"], "completed")
        c = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        self.call("POST", f"/orders/{c['id']}/cancel", env["admin"], {"reason": "Mistake"}, key=str(uuid.uuid4()),
                  expect=200)
        lists = self.call("GET", "/archive", env["admin"], expect=200).json()
        self.assertEqual([x["id"] for x in lists["cancelled_review"]], [c["id"]])
        self.call("POST", "/archive", env["admin"], {"order_ids": [o["id"], c["id"]], "reason": "Reviewed"}, expect=200)
        self.assertEqual(self.call("GET", "/history", env["admin"], expect=200).json(), [])
        restored = self.call("POST", f"/archive/{o['id']}/restore", env["admin"], expect=200).json()
        self.assertIsNone(restored["archived_at"])
        cashier = self.make_cashier(env["admin"], env["device"])
        self.assertEqual(self.error_code(self.call("POST", f"/archive/{c['id']}/restore", cashier, expect=403)),
                         "PERMISSION_DENIED")
        self.call("POST", "/archive", cashier, {"order_ids": [], "reason": "x"}, expect=403)
        self.call("POST", "/archive", env["admin"], {"order_ids": [], "reason": "x"}, expect=422)

    def test_auto_archive_only_completed_orders(self):
        from app.services.archive_service import run_auto_archive
        from app.database.session import unit_of_work
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "100.00", "tendered": "100.00"})
        self.status(env["admin"], o["id"], "completed")
        c = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        self.call("POST", f"/orders/{c['id']}/cancel", env["admin"], {"reason": "x"}, key="c", expect=200)
        self.execute("update {s}.orders set completed_at = now() - interval '25 hours', "
                     "cancelled_at = now() - interval '25 hours'")
        business_id = self.scalar("select id from {s}.businesses")
        with unit_of_work(self.factory) as session:
            self.assertEqual(run_auto_archive(session, business_id), 1)
        self.assertEqual(self.scalar("select archive_method from {s}.orders where status='completed'"), "auto")
        self.assertIsNone(self.scalar("select archived_at from {s}.orders where status='cancelled'"))


class ExpenseAndAuditTests(DbTestCase):
    def test_expense_and_audit(self):
        env = self.bootstrap()
        e = self.call("POST", "/expenses", env["admin"], {"category": "Supplies", "description": "Cups", "amount": "350.00",
                                                          "expense_date": "2026-01-15", "payment_method": "Cash"},
                      expect=201).json()
        self.assertEqual(e["code"], "EXP-2026-001")
        audit = self.call("GET", "/audit", env["admin"], expect=200).json()
        actions = {a["action"] for a in audit}
        self.assertTrue({"setup.completed", "terminal.activated", "expense.recorded"} <= actions)


if __name__ == "__main__":
    unittest.main()
