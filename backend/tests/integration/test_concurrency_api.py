"""Concurrency stress against real PostgreSQL with separate sessions per worker. After every run the
stock ledger must reconcile: Σ movement deltas == on_hand / reserved, and no invariant is broken."""

import threading
import unittest
import uuid
from decimal import Decimal

from db_support import SCHEMA, DbTestCase
from test_hardening_api import _Latte


def run_parallel(jobs):  # type: ignore[no-untyped-def]
    results: list = [None] * len(jobs)

    def wrap(i, fn):  # type: ignore[no-untyped-def]
        results[i] = fn()

    threads = [threading.Thread(target=wrap, args=(i, fn)) for i, fn in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


class LedgerConcurrencyTests(_Latte):
    def tokens(self, env: dict, n: int) -> list[str]:
        return [self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                          device=env["device"], expect=200).json()["token"] for _ in range(n)]

    def assert_ledger_reconciles(self) -> None:
        from sqlalchemy import text
        with self.engine.connect() as c:
            rows = c.execute(text(
                f'select l.subject_id, l.on_hand, l.reserved, coalesce(sum(m.delta_on_hand),0), coalesce(sum(m.delta_reserved),0) '
                f'from "{SCHEMA}".stock_levels l left join "{SCHEMA}".stock_movements m on m.subject_id = l.subject_id '
                f'group by l.subject_id, l.on_hand, l.reserved')).all()
        for sid, on_hand, reserved, d_on, d_res in rows:
            self.assertEqual((on_hand, reserved), (d_on, d_res), f"ledger mismatch for {sid}")
            self.assertGreaterEqual(on_hand - reserved, 0)
            self.assertGreaterEqual(on_hand, 0)

    def test_receive_waste_count_and_orders_race_on_one_ingredient(self):
        env = self.setup_latte(beans="200")
        beans = env["ing"]["beans"]
        toks = self.tokens(env, 12)

        def act(tok, action, body):  # type: ignore[no-untyped-def]
            return lambda: self.call("POST", f"/ingredients/{beans}/{action}", tok, body, key=str(uuid.uuid4())).status_code

        def order(tok):  # type: ignore[no-untyped-def]
            return lambda: self.call("POST", "/orders", tok, {"order_type": "takeout", "lines": [self.regular_line(env)]},
                                     key=str(uuid.uuid4())).status_code

        jobs = [act(toks[0], "restock", {"quantity": "100"}), act(toks[1], "restock", {"quantity": "50", "unit_cost": "1"}),
                act(toks[2], "waste", {"quantity": "30", "reason": "spilled"}),
                act(toks[3], "waste", {"quantity": "30", "reason": "expired"}),
                act(toks[4], "count", {"counted_quantity": "150", "reason": "count"}),
                *[order(t) for t in toks[5:12]]]
        codes = run_parallel(jobs)
        self.assertTrue(all(c in (200, 201, 409) for c in codes), codes)
        self.assert_ledger_reconciles()
        orders = self.scalar("select count(*) from {s}.orders")
        on_hand, reserved = self.level("BEANS")
        self.assertEqual(reserved, Decimal(18) * orders)

    def test_many_orders_never_oversell(self):
        env = self.setup_latte(beans="100")  # 5 regular lattes (90 g) fit, the 6th does not
        toks = self.tokens(env, 10)
        codes = run_parallel([lambda t=t: self.call("POST", "/orders", t, {"order_type": "takeout",
                                                    "lines": [self.regular_line(env)]}, key=str(uuid.uuid4())).status_code
                              for t in toks])
        self.assertEqual(codes.count(201), 5)
        self.assertEqual(codes.count(409), 5)
        self.assertEqual(self.level("BEANS"), (Decimal("100.000"), Decimal("90.000")))
        self.assert_ledger_reconciles()

    def test_concurrent_completion_and_cancel_of_same_order(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [self.regular_line(env)]).json()
        self.pay(env["admin"], o["id"], {"method": "card", "amount": o["totals"]["total"]})
        toks = self.tokens(env, 4)
        jobs = [lambda t=toks[0]: self.status(t, o["id"], "completed", expect=None).status_code,
                lambda t=toks[1]: self.status(t, o["id"], "completed", expect=None).status_code,
                lambda t=toks[2]: self.call("POST", f"/orders/{o['id']}/cancel", t, {"reason": "x"},
                                            key=str(uuid.uuid4())).status_code]
        codes = run_parallel(jobs)
        self.assertEqual(codes.count(200), 1, codes)
        self.assertEqual(self.scalar("select status from {s}.orders"), "completed")
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='sale'"), 2)  # beans + milk once
        self.assert_ledger_reconciles()

    def test_concurrent_cancels_release_once(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [self.regular_line(env)]).json()
        toks = self.tokens(env, 4)
        codes = run_parallel([lambda t=t: self.call("POST", f"/orders/{o['id']}/cancel", t, {"reason": "x"},
                                                    key=str(uuid.uuid4())).status_code for t in toks])
        self.assertEqual(codes.count(200), 1, codes)
        self.assertEqual(self.level("BEANS")[1], 0)
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='reservation_release'"), 2)
        self.assert_ledger_reconciles()

    def test_concurrent_split_payments_never_overpay(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}]).json()  # 60.00
        toks = self.tokens(env, 5)
        codes = run_parallel([lambda t=t: self.call("POST", f"/orders/{o['id']}/payments", t,
                                                    {"method": "card", "amount": "25.00"}, key=str(uuid.uuid4())).status_code
                              for t in toks])
        self.assertEqual(codes.count(201), 2, codes)  # 25 + 25 = 50 ≤ 60; a third would exceed
        self.assertEqual(self.scalar("select sum(amount) from {s}.payments"), Decimal("50.00"))

    def test_concurrent_refunds_never_exceed_payments(self):
        env = self.setup_latte()
        o = self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}]).json()
        self.pay(env["admin"], o["id"], {"method": "card", "amount": "60.00"})
        self.status(env["admin"], o["id"], "completed")
        toks = self.tokens(env, 5)
        codes = run_parallel([lambda t=t: self.call("POST", f"/orders/{o['id']}/refunds", t,
                                                    {"kind": "partial", "amount": "25.00", "reason": "x"},
                                                    key=str(uuid.uuid4())).status_code for t in toks])
        self.assertEqual(codes.count(201), 2, codes)
        self.assertEqual(self.scalar("select sum(amount) from {s}.refunds"), Decimal("50.00"))

    def test_concurrent_product_and_recipe_edits_stay_consistent(self):
        env = self.setup_latte()
        toks = self.tokens(env, 6)
        jobs = [lambda t=toks[i], p=f"{100 + i}.00": self.call("PATCH", f"/products/{env['latte']}", t,
                                                               {"price": p}).status_code for i in range(3)]
        jobs += [lambda t=toks[3 + i], q=str(10 + i): self.call("PUT", f"/products/{env['latte']}/recipe", t, {
            "track_ingredients": True, "lines": [{"ingredient_id": env["ing"]["beans"], "quantity": q}]}).status_code
            for i in range(3)]
        codes = run_parallel(jobs)
        self.assertTrue(all(c in (200, 409) for c in codes), codes)
        self.assertEqual(self.scalar("select count(*) from {s}.recipes where product_id=:p", p=env["latte"]), 1)
        self.assertEqual(self.scalar("select count(*) from {s}.recipe_lines l join {s}.recipes r on r.id=l.recipe_id "
                                     "where r.product_id=:p", p=env["latte"]), 1)

    def test_revoking_terminal_while_orders_are_submitted(self):
        env = self.setup_latte()
        device = self.register_and_activate(env["admin"], "RACE-1")
        tok = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                        device=device, expect=200).json()["token"]
        tid = self.scalar("select id from {s}.terminals where code='RACE-1'")
        jobs = [lambda: self.call("POST", "/orders", tok, {"order_type": "takeout",
                                  "lines": [{"product_id": env["cookie"], "quantity": 1}]}, key=str(uuid.uuid4())).status_code
                for _ in range(4)]
        jobs.append(lambda: self.call("POST", f"/terminals/{tid}/revoke", env["admin"], {"reason": "lost"}).status_code)
        codes = run_parallel(jobs)
        self.assertEqual(codes[-1], 200)
        self.assertEqual(self.call("GET", "/orders", tok).status_code, 401)  # after revoke: nothing runs
        made = self.scalar("select count(*) from {s}.orders where terminal_id=:t", t=tid)
        self.assertEqual(made, codes[:-1].count(201))  # every 201 is a real order; no partial writes


if __name__ == "__main__":
    unittest.main()
