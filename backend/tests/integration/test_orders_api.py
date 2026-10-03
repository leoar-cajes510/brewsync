import unittest
import uuid

from db_support import DbTestCase


class CoreFlowTests(DbTestCase):
    def test_end_to_end_order_first_pay_later(self):
        env = self.bootstrap()
        admin = env["admin"]
        ids = self.catalog(admin, stock=10)
        self.call("PATCH", f"/products/{ids['latte']}", admin, {"price": "250.00", "tax_class": "taxable"}, expect=200)
        self.call("PUT", "/settings/tax", admin, {"version": 1, "data": {
            "enabled": True, "mode": "excluded", "name": "Sales Tax", "rate": "10"}}, expect=200)
        cashier = self.make_cashier(admin, env["device"])

        order = self.order(cashier, [{"product_id": ids["latte"], "quantity": 2},
                                     {"product_id": ids["cookie"], "quantity": 1}]).json()
        self.assertEqual((order["status"], order["payment_status"], order["number"]), ("pending", "unpaid", "1"))
        # 500 taxable + 100 non-taxable; tax 10 % on 500 only
        self.assertEqual((order["totals"]["tax_amount"], order["totals"]["total"]), ("50.00", "650.00"))
        stock = self.call("GET", "/inventory", admin, expect=200).json()[0]
        self.assertEqual((stock["on_hand"], stock["reserved"], stock["available"]), ("10.000", "2.000", "8.000"))

        self.status(cashier, order["id"], "preparing")
        self.status(cashier, order["id"], "ready")
        r = self.status(cashier, order["id"], "completed", expect=409)
        self.assertEqual(self.error_code(r), "ORDER_NOT_SETTLED")

        # split payment: cash 300 (tendered 500) + GCash 350
        paid = self.pay(cashier, order["id"], {"method": "cash", "amount": "300.00", "tendered": "500.00"}).json()
        self.assertEqual((paid["payment_status"], paid["payment"]["change_given"], paid["amount_due"]),
                         ("partially_paid", "200.00", "350.00"))
        self.assertNotIn("document", paid)
        r = self.pay(cashier, order["id"], {"method": "gcash", "amount": "350.00"}, expect=422)
        self.assertEqual(self.error_code(r), "REFERENCE_REQUIRED")
        paid = self.pay(cashier, order["id"], {"method": "gcash", "amount": "350.00", "reference": "GC-778812"}).json()
        self.assertEqual(paid["payment_status"], "paid")
        document = paid["document"]
        self.assertEqual(document["number"], "1")  # neutral default series, separate from order number

        done = self.status(cashier, order["id"], "completed").json()
        self.assertEqual(done["status"], "completed")
        stock = self.call("GET", "/inventory", admin, expect=200).json()[0]
        self.assertEqual((stock["on_hand"], stock["reserved"]), ("8.000", "0.000"))
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='sale'"), 1)

        history = self.call("GET", "/history", cashier, expect=200).json()
        self.assertEqual([h["id"] for h in history], [order["id"]])
        self.assertEqual(history[0]["document"]["number"], "1")
        detail = self.call("GET", f"/history/{order['id']}", cashier, expect=200).json()
        self.assertEqual(len(detail["payments"]), 2)

        first = self.call("POST", f"/documents/{document['id']}/reprint", cashier, expect=200).json()
        second = self.call("POST", f"/documents/{document['id']}/reprint", cashier, expect=200).json()
        self.assertEqual((first["number"], second["number"], second["print_count"]), ("1", "1", 2))
        self.assertEqual([p["is_reprint"] for p in second["prints"]], [False, True])
        self.assertEqual(self.scalar("select count(*) from {s}.documents"), 1)
        self.assertGreater(self.scalar("select count(*) from {s}.domain_events"), 5)

    def test_document_numbers_are_sequential_and_separate_from_order_numbers(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        numbers = []
        for _ in range(3):
            o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
            numbers.append(o["number"])
        # pay the third order first → it gets document number 1
        docs = [self.pay(env["admin"], oid, {"method": "cash", "amount": "100.00", "tendered": "100.00"}).json()
                ["document"]["number"] for oid in [self._order_id(n) for n in reversed(numbers)]]
        self.assertEqual(numbers, ["1", "2", "3"])
        self.assertEqual(docs, ["1", "2", "3"])
        self.assertEqual(self.scalar("select d.number from {s}.documents d join {s}.orders o on o.id=d.order_id "
                                     "where o.number='3'"), "1")

    def _order_id(self, number: str) -> str:
        return str(self.scalar("select id from {s}.orders where number=:n", n=number))


class InventoryTests(DbTestCase):
    def test_no_negative_stock_and_all_or_nothing_reservation(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"], stock=3)
        r = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1},
                                      {"product_id": ids["latte"], "quantity": 4}], expect=409)
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")
        # rollback: nothing persisted
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        self.assertEqual(self.scalar("select reserved from {s}.stock_levels"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='reservation'"), 0)
        self.order(env["admin"], [{"product_id": ids["latte"], "quantity": 3}])
        self.order(env["admin"], [{"product_id": ids["latte"], "quantity": 1}], expect=409)

    def test_cancel_releases_reservation(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"], stock=5)
        o = self.order(env["admin"], [{"product_id": ids["latte"], "quantity": 2}]).json()
        r = self.call("POST", f"/orders/{o['id']}/cancel", env["admin"], {"reason": "Customer left"},
                      key=str(uuid.uuid4()), expect=200).json()
        self.assertEqual(r["status"], "cancelled")
        self.assertEqual(self.scalar("select reserved from {s}.stock_levels"), 0)
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='reservation_release'"), 1)
        self.assertEqual(self.error_code(self.status(env["admin"], o["id"], "preparing", expect=409)),
                         "INVALID_TRANSITION")

    def test_cancelling_a_paid_order_is_an_open_decision(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 2}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "50.00", "tendered": "50.00"})
        r = self.call("POST", f"/orders/{o['id']}/cancel", env["admin"], {"reason": "x"}, key="c1", expect=409)
        self.assertEqual((self.error_code(r), r.json()["error"]["details"]["question_id"]), ("DECISION_PENDING", "Q-CAN-1"))

    def test_ingredient_stock_is_reserved_via_recipe(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        milk = self.call("POST", "/ingredients", env["admin"], {"code": "MILK", "name": "Fresh Milk", "unit": "ml",
                                                                "unit_cost": "0.0900", "initial_stock": "1000",
                                                                "low_stock_threshold": "100"}, expect=201).json()
        drink = self.call("POST", "/products", env["admin"], {"code": "FLAT", "name": "Flat White",
                                                              "category_id": ids["category"], "price": "180.00",
                                                              "tax_class": "taxable", "track_ingredients": True},
                          expect=201).json()
        self.call("PUT", f"/products/{drink['id']}/recipe", env["admin"],
                  {"lines": [{"ingredient_id": milk["id"], "quantity": "180"}]}, expect=200)
        self.order(env["admin"], [{"product_id": drink["id"], "quantity": 5}])  # 900 ml
        r = self.order(env["admin"], [{"product_id": drink["id"], "quantity": 1}], expect=409)  # 180 > 100 left
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")

    def test_restock_and_adjust_with_idempotency(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"], stock=5)
        a = self.call("POST", f"/inventory/{ids['latte']}/restock", env["admin"], {"quantity": 5}, key="r1",
                      expect=200).json()
        b = self.call("POST", f"/inventory/{ids['latte']}/restock", env["admin"], {"quantity": 5}, key="r1",
                      expect=200).json()
        self.assertEqual((a["on_hand"], b["on_hand"]), ("10.000", "10.000"))  # replayed, not doubled
        r = self.call("POST", f"/inventory/{ids['latte']}/adjust", env["admin"], {"delta": "-11", "reason": "damaged"},
                      key="a1", expect=409)
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")


class PaymentAndIdempotencyTests(DbTestCase):
    def test_idempotent_order_creation_and_key_reuse(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        lines = [{"product_id": ids["cookie"], "quantity": 1}]
        first = self.order(env["admin"], lines, key="order-key-1").json()
        again = self.order(env["admin"], lines, key="order-key-1").json()
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 1)
        r = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 2}], key="order-key-1", expect=422)
        self.assertEqual(self.error_code(r), "IDEMPOTENCY_KEY_REUSED")
        r = self.call("POST", "/orders", env["admin"], {"order_type": "takeout", "lines": lines}, expect=422)
        self.assertEqual(self.error_code(r), "VALIDATION_ERROR")  # key required

    def test_payment_retry_does_not_duplicate_and_overpayment_rejected(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        body = {"method": "cash", "amount": "40.00", "tendered": "40.00"}
        self.pay(env["admin"], o["id"], body, key="pay-1")
        self.pay(env["admin"], o["id"], body, key="pay-1")
        self.assertEqual(self.scalar("select count(*) from {s}.payments"), 1)
        r = self.pay(env["admin"], o["id"], {"method": "card", "amount": "60.01"}, expect=422)
        self.assertEqual(self.error_code(r), "OVERPAYMENT")
        r = self.pay(env["admin"], o["id"], {"method": "cash", "amount": "60.00", "tendered": "50.00"}, expect=422)
        self.assertEqual(self.error_code(r), "INSUFFICIENT_TENDER")


class RefundTests(DbTestCase):
    def _completed(self, env: dict) -> dict:
        ids = self.catalog(env["admin"], stock=5)
        o = self.order(env["admin"], [{"product_id": ids["latte"], "quantity": 2}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "300.00", "tendered": "300.00"})
        self.pay(env["admin"], o["id"], {"method": "gcash", "amount": "200.00", "reference": "GC-1234"})
        return self.status(env["admin"], o["id"], "completed").json()

    def test_full_refund_is_a_separate_record(self):
        env = self.bootstrap()
        o = self._completed(env)
        r = self.call("POST", f"/orders/{o['id']}/refunds", env["admin"], {"kind": "full", "reason": "Wrong drink"},
                      key="rf1", expect=201).json()
        self.assertEqual((r["refund_status"], r["payment_status"]), ("refunded", "paid"))
        self.assertEqual(self.scalar("select count(*) from {s}.refund_allocations"), 2)
        self.assertEqual(self.scalar("select count(*) from {s}.payments where status='completed'"), 2)  # untouched
        self.assertEqual(self.scalar("select status from {s}.documents"), "refunded")
        self.assertIsNone(self.scalar("select method from {s}.refunds"))  # Q-REF-2 open
        r = self.call("POST", f"/orders/{o['id']}/refunds", env["admin"], {"kind": "full", "reason": "again"},
                      key="rf2", expect=422)

    def test_partial_refund_blocked_and_permissions_and_toggle(self):
        env = self.bootstrap()
        o = self._completed(env)
        r = self.call("POST", f"/orders/{o['id']}/refunds", env["admin"], {"kind": "partial", "reason": "x"},
                      key="p1", expect=409)
        self.assertEqual(r.json()["error"]["details"]["question_id"], "Q-REF-5")
        cashier = self.make_cashier(env["admin"], env["device"])
        r = self.call("POST", f"/orders/{o['id']}/refunds", cashier, {"kind": "full", "reason": "x"}, key="p2",
                      expect=403)
        self.assertEqual(self.error_code(r), "PERMISSION_DENIED")
        features = {**self.SETUP["settings"]["features"], "refunds": False}
        self.call("PUT", "/settings/features", env["admin"], {"version": 1, "data": features}, expect=200)
        r = self.call("POST", f"/orders/{o['id']}/refunds", env["admin"], {"kind": "full", "reason": "x"}, key="p3",
                      expect=403)
        self.assertEqual(self.error_code(r), "FEATURE_DISABLED")

    def test_refund_requires_completed_order(self):
        env = self.bootstrap()
        ids = self.catalog(env["admin"])
        o = self.order(env["admin"], [{"product_id": ids["cookie"], "quantity": 1}]).json()
        self.pay(env["admin"], o["id"], {"method": "cash", "amount": "100.00", "tendered": "100.00"})
        r = self.call("POST", f"/orders/{o['id']}/refunds", env["admin"], {"kind": "full", "reason": "x"}, key="k",
                      expect=409)
        self.assertEqual(self.error_code(r), "INVALID_TRANSITION")


if __name__ == "__main__":
    unittest.main()
