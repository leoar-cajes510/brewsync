"""Failure injection: database errors, unexpected exceptions, malformed input. Every failure must
roll back completely and answer with a safe JSON envelope (no SQL, no stack trace)."""

import unittest
import uuid
from unittest import mock

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, OperationalError

from test_hardening_api import _Latte


class FailureInjectionTests(_Latte):
    def safe_client(self) -> TestClient:
        from app.main import app
        return TestClient(app, raise_server_exceptions=False)

    def _post_order(self, client: TestClient, env: dict, key: str):  # type: ignore[no-untyped-def]
        return client.post("/api/v1/orders", json={"order_type": "takeout", "lines": [self.regular_line(env)]},
                           headers={"Authorization": f"Bearer {env['admin']}", "Idempotency-Key": key})

    def test_database_failure_mid_order_rolls_back_everything(self):
        env = self.setup_latte()
        client = self.safe_client()
        boom = OperationalError("insert", {}, Exception("connection dropped"))
        with mock.patch("app.repositories.order_repository.OrderRepository.insert", side_effect=boom):
            r = self._post_order(client, env, "fail-1")
        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.json()["error"]["code"], "SERVICE_BUSY")
        self.assertNotIn("insert", r.text.lower())
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        self.assertEqual(self.level("BEANS")[1], 0)  # the reservation was rolled back too
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='reservation'"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.idempotency_records"), 0)
        r = self._post_order(client, env, "fail-1")  # same key after the failure: now succeeds once
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 1)

    def test_integrity_error_is_a_clean_conflict(self):
        env = self.setup_latte()
        client = self.safe_client()
        boom = IntegrityError("insert", {}, Exception("duplicate key value violates unique constraint uq_secret"))
        with mock.patch("app.repositories.order_repository.OrderRepository.insert", side_effect=boom):
            r = self._post_order(client, env, "fail-2")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "CONFLICT"))
        self.assertNotIn("uq_secret", r.text)

    def test_unexpected_exception_is_generic_500_and_rolled_back(self):
        env = self.setup_latte()
        client = self.safe_client()
        with mock.patch("app.services.order_service.emit", side_effect=RuntimeError("secret internals /srv/app.py")):
            r = self._post_order(client, env, "fail-3")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (500, "INTERNAL_ERROR"))
        self.assertNotIn("secret", r.text)
        self.assertNotIn("Traceback", r.text)
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        self.assertEqual(self.level("BEANS")[1], 0)

    def test_payment_failure_leaves_no_payment_or_document(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}]).json()
        client = self.safe_client()
        boom = OperationalError("x", {}, Exception("timeout"))
        with mock.patch("app.services.payment_service.issue_sales_document", side_effect=boom):
            r = client.post(f"/api/v1/orders/{o['id']}/payments", json={"method": "card", "amount": "60.00"},
                            headers={"Authorization": f"Bearer {env['admin']}", "Idempotency-Key": "pay-x"})
        self.assertEqual(r.status_code, 503)
        self.assertEqual(self.scalar("select count(*) from {s}.payments"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.documents"), 0)
        self.assertEqual(self.scalar("select payment_status from {s}.orders"), "unpaid")

    def test_malformed_and_hostile_payloads(self):
        env = self.setup_latte()
        admin = env["admin"]
        h = {"Authorization": f"Bearer {admin}", "Idempotency-Key": str(uuid.uuid4()), "Content-Type": "application/json"}
        client = self.safe_client()
        self.assertEqual(client.post("/api/v1/orders", content=b"{not json", headers=h).status_code, 422)
        cookie = env["cookie"]
        cases = [
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": 0}]},
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": -3}]},
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": 1.5}]},
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": True}]},
            {"order_type": "takeout", "lines": [{"product_id": "not-a-uuid", "quantity": 1}]},
            {"order_type": "spaceship", "lines": [{"product_id": cookie, "quantity": 1}]},
            {"order_type": "takeout", "lines": []},
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": 1}], "expected_total": "1e999"},
            {"order_type": "takeout", "lines": [{"product_id": cookie, "quantity": 1, "price": "0.01"}]},
        ]
        for body in cases:
            r = self.call("POST", "/orders", admin, body, key=str(uuid.uuid4()))
            self.assertIn(r.status_code, (400, 404, 409, 422), (body, r.text))
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        o = self.order(admin, [{"product_id": cookie, "quantity": 1}]).json()
        for amount in ["-1", "0", "abc", "1.001", "NaN", "Infinity", "99999999999999"]:
            r = self.call("POST", f"/orders/{o['id']}/payments", admin, {"method": "card", "amount": amount},
                          key=str(uuid.uuid4()))
            self.assertEqual(r.status_code, 422, (amount, r.text))
        self.assertEqual(self.scalar("select count(*) from {s}.payments"), 0)
        for qty in ["-5", "0", "abc", "1.0001", "NaN"]:
            r = self.call("POST", f"/ingredients/{env['ing']['beans']}/waste", admin, {"quantity": qty, "reason": "spilled"},
                          key=str(uuid.uuid4()))
            self.assertIn(r.status_code, (409, 422), (qty, r.text))
        for cost in ["-1", "abc"]:
            r = self.call("POST", "/ingredients", admin, {"code": f"X{cost}", "name": f"Bad {cost}", "unit": "g",
                                                          "unit_cost": cost, "initial_stock": "1", "low_stock_threshold": "0"})
            self.assertEqual(r.status_code, 422, (cost, r.text))
        self.assertEqual(self.call("PATCH", f"/products/{cookie}", admin, {"price": "-5"}).status_code, 422)
        self.assertEqual(self.call("PATCH", f"/products/{cookie}", admin, {"name": "bad\u0000name"}).status_code, 422)

    def test_expired_session_mid_cart_and_stale_version(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}]).json()
        r = self.call("POST", f"/orders/{o['id']}/status", env["admin"], {"target": "preparing", "expected_version": 99},
                      key=str(uuid.uuid4()))
        self.assertEqual((r.status_code, self.error_code(r)), (409, "VERSION_CONFLICT"))
        self.execute("update {s}.sessions set last_activity_at = now() - interval '2 hours'")
        r = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}], expect=401)
        self.assertEqual(self.error_code(r), "SESSION_EXPIRED")
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 1)

    def test_background_requests_do_not_extend_the_session(self):
        env = self.setup_latte()
        sql = "select last_activity_at from {s}.sessions where ended_at is null order by started_at desc limit 1"
        before = self.scalar(sql)
        r = self.client.get("/api/v1/orders", headers={"Authorization": f"Bearer {env['admin']}",
                                                       "X-BrewSync-Background": "1"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(before, self.scalar(sql))


if __name__ == "__main__":
    unittest.main()
