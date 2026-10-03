import os
import unittest

from db_support import DbTestCase


class SetupTests(DbTestCase):
    def test_fresh_database_is_empty_and_requires_setup(self):
        self.assertEqual(self.call("GET", "/setup/status", expect=200).json()["setup_status"], "not_started")
        for table in ("businesses", "users", "products", "orders", "payments", "documents", "expenses"):
            self.assertEqual(self.scalar(f"select count(*) from {{s}}.{table}"), 0, table)
        r = self.call("POST", "/auth/login", json={"username": "x", "credential": "y"}, expect=409)
        self.assertEqual(self.error_code(r), "SETUP_REQUIRED")

    def test_setup_creates_only_system_data_and_first_admin(self):
        self.complete_setup()
        self.assertEqual(self.call("GET", "/setup/status", expect=200).json()["setup_status"], "completed")
        self.assertEqual(self.scalar("select count(*) from {s}.businesses"), 1)
        self.assertEqual(self.scalar("select count(*) from {s}.users"), 1)
        self.assertEqual(self.scalar("select count(*) from {s}.permissions"), 58)
        for table in ("products", "categories", "ingredients", "orders", "stock_levels", "expenses", "discounts"):
            self.assertEqual(self.scalar(f"select count(*) from {{s}}.{table}"), 0, table)
        pw = self.scalar("select password_hash from {s}.users")
        self.assertTrue(pw.startswith("$argon2") and "correct-horse-1" not in pw)
        self.assertEqual(self.scalar("select (data->>'enabled') from {s}.settings_documents where section='tax'"),
                         "false")
        r = self.client.post("/api/v1/setup/complete", json=self.SETUP, headers={"X-Setup-Token": os.environ["SETUP_TOKEN"]})
        self.assertEqual((r.status_code, self.error_code(r)), (409, "SETUP_ALREADY_COMPLETED"))
        # Q-TRM-8: setup registered the first terminal, awaiting its one-time activation code
        self.assertEqual(self.scalar("select status from {s}.terminals"), "pending_activation")

    def test_setup_is_atomic(self):
        bad = {**self.SETUP, "admin": {**self.SETUP["admin"], "password": "short"}}
        self.assertEqual(self.client.post("/api/v1/setup/complete", json=bad, headers={"X-Setup-Token": os.environ["SETUP_TOKEN"]}).status_code, 422)
        self.assertEqual(self.scalar("select count(*) from {s}.terminals"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.businesses"), 0)
        self.assertEqual(self.call("GET", "/setup/status", expect=200).json()["setup_status"], "not_started")


class AuthTests(DbTestCase):
    def test_login_requires_activated_terminal_for_cashier_and_pos(self):
        env = self.bootstrap()
        me = self.call("GET", "/auth/me", env["admin"], expect=200).json()
        self.assertIsNotNone(me["terminal_id"])
        cashier = self.make_cashier(env["admin"], env["device"])
        r = self.call("POST", "/auth/login", json={"username": "maria", "credential": "5678"}, expect=403)
        self.assertEqual(self.error_code(r), "TERMINAL_NOT_ACTIVATED")  # no device credential
        self.assertTrue(cashier)
        # back-office admin (no terminal) cannot create orders
        r = self.call("POST", "/orders", env["backoffice"], {"order_type": "takeout", "lines": []}, key="k1",
                      expect=403)
        self.assertEqual(self.error_code(r), "TERMINAL_NOT_ACTIVATED")

    def test_admin_cannot_use_pin_and_temporary_credential_must_change(self):
        env = self.bootstrap()
        r = self.call("POST", "/staff", env["admin"], {"full_name": "A2", "username": "admin2", "role": "admin",
                                                       "auth_method": "pin", "credential": "1234"}, expect=422)
        self.assertEqual(self.error_code(r), "AUTH_METHOD_NOT_ALLOWED")
        self.call("POST", "/staff", env["admin"], {"full_name": "Maria Cruz", "username": "maria", "role": "cashier",
                                                   "auth_method": "pin", "credential": "1234"}, expect=201)
        token = self.call("POST", "/auth/login", json={"username": "maria", "credential": "1234"},
                          device=env["device"], expect=200).json()["token"]
        r = self.call("GET", "/orders", token, expect=403)
        self.assertEqual(self.error_code(r), "CREDENTIAL_CHANGE_REQUIRED")
        self.assertIsNone(self.scalar("select password_hash from {s}.users where username='maria'"))
        self.assertTrue(self.scalar("select pin_hash from {s}.users where username='maria'").startswith("$argon2"))

    def test_failed_logins_lock_account_and_are_persisted(self):
        env = self.bootstrap()
        for _ in range(2):
            self.assertEqual(self.error_code(self.call("POST", "/auth/login", json={"username": "owner", "credential": "nope"},
                                                       device=env["device"], expect=401)), "UNAUTHENTICATED")
        r = self.call("POST", "/auth/login", json={"username": "owner", "credential": "nope"}, device=env["device"],
                      expect=423)
        self.assertEqual(self.error_code(r), "ACCOUNT_LOCKED")
        r = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                      device=env["device"], expect=423)  # still locked with the right password
        self.assertEqual(self.scalar("select count(*) from {s}.audit_logs where action='auth.lockout'"), 1)

    def test_idle_timeout_is_enforced_by_the_server(self):
        env = self.bootstrap()
        self.call("GET", "/auth/me", env["admin"], expect=200)
        self.execute("update {s}.sessions set last_activity_at = now() - interval '16 minutes' where ended_at is null")
        r = self.call("GET", "/auth/me", env["admin"], expect=401)
        self.assertEqual(self.error_code(r), "SESSION_EXPIRED")
        self.assertGreaterEqual(self.scalar("select count(*) from {s}.sessions where end_reason='idle_timeout'"), 1)

    def test_logout_ends_session_and_hashes_are_never_returned(self):
        env = self.bootstrap()
        staff = self.call("GET", "/staff", env["admin"], expect=200).text
        self.assertNotIn("argon2", staff)
        self.assertNotIn("hash", staff)
        self.call("POST", "/auth/logout", env["admin"], expect=200)
        self.assertEqual(self.error_code(self.call("GET", "/auth/me", env["admin"], expect=401)), "UNAUTHENTICATED")


class PermissionTests(DbTestCase):
    def test_cashier_is_denied_management_operations(self):
        env = self.bootstrap()
        cashier = self.make_cashier(env["admin"], env["device"])
        ids = self.catalog(env["admin"])
        for method, path, body in [
            ("POST", "/products", {"code": "X", "name": "X", "category_id": ids["category"], "price": "1.00",
                                   "tax_class": "taxable"}),
            ("PUT", "/settings/tax", {"version": 1, "data": {"enabled": False, "mode": "included"}}),
            ("POST", "/staff", {"full_name": "B", "username": "bob", "role": "cashier", "auth_method": "pin",
                                "credential": "1111"}),
            ("GET", "/audit", None),
            ("POST", "/terminals", {"code": "REG-09", "name": "x", "activation_code_minutes": 5}),
        ]:
            r = self.call(method, path, cashier, body)
            self.assertEqual(r.status_code, 403, path)
            self.assertEqual(self.error_code(r), "PERMISSION_DENIED", path)
        self.call("GET", "/products", cashier, expect=200)  # view is granted by default

    def test_unauthenticated_requests_rejected(self):
        self.complete_setup()
        self.assertEqual(self.error_code(self.call("GET", "/orders", expect=401)), "UNAUTHENTICATED")


if __name__ == "__main__":
    unittest.main()
