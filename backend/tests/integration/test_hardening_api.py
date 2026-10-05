"""Hardening release through the real API and PostgreSQL: ingredient availability, stale carts,
concurrency, idempotency, terminal revocation, stock ledger, cost snapshots, audit."""

import threading
import unittest
import uuid
from decimal import Decimal

from db_support import SCHEMA, DbTestCase


class _Latte(DbTestCase):
    """Representative Café Latte: 18 g beans + 180 ml milk; Large 1.5×; Oat replaces milk;
    Extra Espresso +9 g beans; Caramel +15 ml syrup."""

    def _ingredient(self, admin: str, code: str, name: str, unit: str, stock: str, cost: str,
                    threshold: str = "0") -> str:
        return self.call("POST", "/ingredients", admin, {"code": code, "name": name, "unit": unit, "unit_cost": cost,
                                                         "initial_stock": stock, "low_stock_threshold": threshold},
                         expect=201).json()["id"]

    def setup_latte(self, beans: str = "5000", oat: str = "5000", beans_threshold: str = "0") -> dict:
        env = self.bootstrap()
        admin = env["admin"]
        ing = {"beans": self._ingredient(admin, "BEANS", "Coffee Beans", "g", beans, "0.9000", beans_threshold),
               "milk": self._ingredient(admin, "MILK", "Fresh Milk", "ml", "20000", "0.0800"),
               "oat": self._ingredient(admin, "OAT", "Oat Milk", "ml", oat, "0.1500"),
               "caramel": self._ingredient(admin, "CARAMEL", "Caramel Syrup", "ml", "3000", "0.2000")}
        size = self.call("POST", "/choice-groups", admin, {
            "code": "SIZE", "name": "Size", "display_name": "Size", "selection_type": "single", "required": True,
            "min_select": 1, "max_select": 1, "options": [
                {"name": "Regular", "price_delta": "0", "is_default": True},
                {"name": "Large", "price_delta": "35", "effects": [{"mode": "scale", "quantity": "1.5"}]}]},
            expect=201).json()
        milk = self.call("POST", "/choice-groups", admin, {
            "code": "MILK", "name": "Milk Type", "display_name": "Milk Type", "selection_type": "single",
            "required": False, "min_select": 0, "max_select": 1, "options": [
                {"name": "Oat Milk", "price_delta": "30", "effects": [
                    {"mode": "replace", "replaces_ingredient_id": ing["milk"], "ingredient_id": ing["oat"],
                     "quantity": "180"}]}]}, expect=201).json()
        addons = self.call("POST", "/choice-groups", admin, {
            "code": "ADDONS", "name": "Add-ons", "display_name": "Add-ons", "selection_type": "multi",
            "required": False, "min_select": 0, "max_select": 2, "options": [
                {"name": "Extra Espresso", "price_delta": "25",
                 "effects": [{"mode": "add", "ingredient_id": ing["beans"], "quantity": "9"}]},
                {"name": "Caramel", "price_delta": "15",
                 "effects": [{"mode": "add", "ingredient_id": ing["caramel"], "quantity": "15"}]}]}, expect=201).json()
        cat = self.call("POST", "/categories", admin, {"name": "Coffee", "code_prefix": "COF"}, expect=201).json()["id"]
        latte = self.call("POST", "/products", admin, {
            "name": "Café Latte", "category_id": cat, "price": "130.00", "tax_class": "taxable",
            "choice_group_ids": [size["id"], milk["id"], addons["id"]]}, expect=201).json()["id"]
        self.call("PUT", f"/products/{latte}/recipe", admin, {"track_ingredients": True, "lines": [
            {"ingredient_id": ing["beans"], "quantity": "18"}, {"ingredient_id": ing["milk"], "quantity": "180"}]},
            expect=200)
        cookie = self.call("POST", "/products", admin, {"name": "Cookie", "category_id": cat, "price": "60.00",
                                                        "tax_class": "non_taxable"}, expect=201).json()["id"]
        opt = {o["name"]: o["id"] for g in (size, milk, addons) for o in g["options"]}
        return {**env, "ing": ing, "latte": latte, "cookie": cookie, "opt": opt, "cat": cat,
                "groups": {"size": size["id"], "milk": milk["id"], "addons": addons["id"]}}

    def big_line(self, env: dict, qty: int = 1) -> dict:
        return {"product_id": env["latte"], "quantity": qty, "selections": {
            env["groups"]["size"]: [env["opt"]["Large"]], env["groups"]["milk"]: [env["opt"]["Oat Milk"]],
            env["groups"]["addons"]: [env["opt"]["Extra Espresso"], env["opt"]["Caramel"]]}}

    def regular_line(self, env: dict, qty: int = 1) -> dict:
        return {"product_id": env["latte"], "quantity": qty, "selections": {env["groups"]["size"]: [env["opt"]["Regular"]]}}

    def quote(self, token: str, lines: list[dict], expect: int = 200) -> dict:
        return self.call("POST", "/orders/quote", token, {"order_type": "takeout", "lines": lines}, expect=expect).json()

    def level(self, code: str) -> tuple[Decimal, Decimal]:
        from sqlalchemy import text
        with self.engine.connect() as c:
            row = c.execute(text(f'select l.on_hand, l.reserved from "{SCHEMA}".stock_levels l join "{SCHEMA}".ingredients i '
                                 'on i.id = l.subject_id where i.code = :c'), {"c": code}).one()
        return row[0], row[1]


class AvailabilityTests(_Latte):
    def test_final_configuration_requirements(self):
        env = self.setup_latte()
        q = self.quote(env["admin"], [self.big_line(env)])
        req = {r["name"]: r["required"] for r in q["availability"]["requirements"]}
        self.assertEqual(req, {"Coffee Beans": "36", "Oat Milk": "270", "Caramel Syrup": "15"})  # no Fresh Milk
        self.assertTrue(q["availability"]["ok"])

    def test_insufficient_ingredient_blocks_only_dependent_products(self):
        env = self.setup_latte(beans="10")
        menu = self.call("GET", "/pos/menu", env["admin"], expect=200).json()
        latte = menu["availability"][env["latte"]]
        self.assertFalse(latte["sellable"])
        self.assertIn("Coffee Beans: 18 g needed, 10 g available", latte["reasons"])
        self.assertNotIn(env["cookie"], menu["availability"])  # untracked: always sellable
        q = self.quote(env["admin"], [self.regular_line(env), {"product_id": env["cookie"], "quantity": 1}])
        self.assertFalse(q["availability"]["ok"])
        self.assertEqual([l["available"] for l in q["availability"]["lines"]], [False, True])
        r = self.order(env["admin"], [self.regular_line(env)], expect=409)
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")
        self.assertIn("Coffee Beans: 18 g needed, 10 g available", r.json()["error"]["message"])
        self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}])  # unrelated product still sells
        self.assertEqual(self.level("BEANS"), (Decimal("10.000"), Decimal("0.000")))

    def test_low_stock_is_not_unsellable(self):
        env = self.setup_latte(beans="25", beans_threshold="500")
        latte = self.call("GET", "/pos/menu", env["admin"], expect=200).json()["availability"][env["latte"]]
        self.assertTrue(latte["sellable"])
        self.assertEqual(latte["low_stock"], ["Coffee Beans"])
        ing = {i["code"]: i for i in self.call("GET", "/ingredients", env["admin"], expect=200).json()}
        self.assertEqual(ing["BEANS"]["stock"]["status"], "low")
        self.assertEqual(ing["BEANS"]["used_by"], ["Café Latte"])
        self.order(env["admin"], [self.regular_line(env)])  # 18 ≤ 25
        r = self.order(env["admin"], [self.regular_line(env)], expect=409)  # 7 left
        self.assertIn("18 g needed, 7 g available", r.json()["error"]["message"])

    def test_choice_aware_large_blocked_regular_allowed(self):
        env = self.setup_latte(beans="30")
        self.assertTrue(self.quote(env["admin"], [self.regular_line(env)])["availability"]["ok"])
        q = self.quote(env["admin"], [self.big_line(env)])
        self.assertFalse(q["availability"]["ok"])
        self.assertIn("Coffee Beans: 36 g needed, 30 g available", q["availability"]["lines"][0]["reasons"])

    def test_cart_aggregates_lines_sharing_an_ingredient(self):
        env = self.setup_latte(beans="40")
        q = self.quote(env["admin"], [self.regular_line(env), self.regular_line(env, 2)])  # merged: 3 × 18 = 54
        self.assertFalse(q["availability"]["ok"])
        self.assertEqual(q["availability"]["shortfalls"][0]["required"], "54")

    def test_inactive_ingredient_gives_clear_reason(self):
        env = self.setup_latte()
        r = self.call("PATCH", f"/ingredients/{env['ing']['milk']}", env["admin"], {"active": False}, expect=200).json()
        self.assertEqual(r["affected_products"], ["Café Latte"])
        self.assertTrue(r["warnings"])
        r = self.order(env["admin"], [self.regular_line(env)], expect=409)
        self.assertEqual(self.error_code(r), "RECIPE_INVALID")
        self.assertIn("Fresh Milk, which is inactive", r.json()["error"]["message"])
        self.order(env["admin"], [self.big_line(env)])  # oat replaces the inactive milk → still sellable
        health = self.call("GET", "/ingredients/health", env["admin"], expect=200).json()
        self.assertGreaterEqual(health["errors"], 1)
        self.assertIn("INGREDIENT_INACTIVE", {i["code"] for i in health["issues"]})

    def test_dependencies_endpoint(self):
        env = self.setup_latte(beans="0")
        deps = self.call("GET", f"/ingredients/{env['ing']['caramel']}/dependencies", env["admin"], expect=200).json()
        self.assertEqual([p["name"] for p in deps["products"]], ["Café Latte"])
        self.assertEqual(deps["products"][0]["via"], "choice")
        deps = self.call("GET", f"/ingredients/{env['ing']['beans']}/dependencies", env["admin"], expect=200).json()
        self.assertEqual((deps["status"], deps["active_count"]), ("out", 1))


class StaleCartAndIdempotencyTests(_Latte):
    def test_stale_total_is_refused(self):
        env = self.setup_latte()
        q = self.quote(env["admin"], [self.regular_line(env)])
        self.call("PATCH", f"/products/{env['latte']}", env["admin"], {"price": "140.00"}, expect=200)
        r = self.order(env["admin"], [self.regular_line(env)], expected_total=q["total"], expect=409)
        self.assertEqual(self.error_code(r), "CART_STALE")
        self.assertEqual(r.json()["error"]["details"]["totals"]["total"], "140.00")
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 0)
        self.assertEqual(self.level("BEANS")[1], 0)

    def test_concurrent_same_key_creates_one_order(self):
        env = self.setup_latte()
        body = {"order_type": "takeout", "lines": [self.regular_line(env)]}
        results: list[int] = []
        tokens = [self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                            device=env["device"], expect=200).json()["token"] for _ in range(5)]  # separate sessions

        def submit(token: str) -> None:
            r = self.call("POST", "/orders", token, body, key="dup-key-1")
            results.append(r.status_code)

        threads = [threading.Thread(target=submit, args=(t,)) for t in tokens]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results, [201] * 5)
        self.assertEqual(self.scalar("select count(*) from {s}.orders"), 1)
        self.assertEqual(self.level("BEANS")[1], Decimal("18.000"))
        status = self.call("GET", "/orders/submissions/dup-key-1", env["admin"], expect=200).json()
        self.assertEqual(status["status"], "created")
        self.assertEqual(self.call("GET", "/orders/submissions/never-sent", env["admin"], expect=200).json()["status"],
                         "not_created")

    def test_two_terminals_race_for_last_ingredient(self):
        env = self.setup_latte(beans="20")  # one regular latte only
        results: list[int] = []

        def submit() -> None:
            r = self.call("POST", "/orders", env["admin"], {"order_type": "takeout", "lines": [self.regular_line(env)]},
                          key=str(uuid.uuid4()))
            results.append(r.status_code)

        threads = [threading.Thread(target=submit) for _ in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(results), [201] + [409] * 5)
        on_hand, reserved = self.level("BEANS")
        self.assertEqual((on_hand, reserved), (Decimal("20.000"), Decimal("18.000")))

    def test_concurrent_payments_same_key_and_numbering(self):
        env = self.setup_latte()
        orders = [self.order(env["admin"], [{"product_id": env["cookie"], "quantity": 1}]).json() for _ in range(4)]
        codes: list[int] = []

        def pay(order_id: str, key: str) -> None:
            r = self.call("POST", f"/orders/{order_id}/payments", env["admin"],
                          {"method": "cash", "amount": "60.00", "tendered": "60.00"}, key=key)
            codes.append(r.status_code)

        threads = [threading.Thread(target=pay, args=(orders[0]["id"], "same-pay")) for _ in range(4)]
        threads += [threading.Thread(target=pay, args=(o["id"], f"p-{o['id']}")) for o in orders[1:]]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(self.scalar("select count(*) from {s}.payments"), 4)  # one per order
        self.assertEqual(self.scalar("select count(distinct number) from {s}.documents"), 4)
        self.assertEqual(self.scalar("select count(distinct number) from {s}.orders"), 4)


class LedgerTests(_Latte):
    def test_waste_receive_count_and_audit(self):
        env = self.setup_latte()
        admin, beans = env["admin"], env["ing"]["beans"]
        url = f"/ingredients/{beans}"
        r = self.call("POST", f"{url}/waste", admin, {"quantity": "100", "reason": "nonsense"}, key="w0", expect=422)
        r = self.call("POST", f"{url}/waste", admin, {"quantity": "100", "reason": "spilled"}, key="w1", expect=200)
        self.assertEqual(r.json()["on_hand"], "4900.000")
        self.call("POST", f"{url}/waste", admin, {"quantity": "99999", "reason": "expired"}, key="w2", expect=409)
        self.call("POST", f"{url}/restock", admin, {"quantity": "1000", "unit_cost": "1.1000", "supplier": "Bean Co",
                                                    "update_unit_cost": True}, key="r1", expect=200)
        ing = {i["code"]: i for i in self.call("GET", "/ingredients", admin, expect=200).json()}
        self.assertEqual(ing["BEANS"]["unit_cost"], "1.1000")
        self.order(admin, [self.regular_line(env)])  # reserves 18
        r = self.call("POST", f"{url}/count", admin, {"counted_quantity": "10", "reason": "count"}, key="c0", expect=409)
        self.assertIn("reserved", r.json()["error"]["message"])
        r = self.call("POST", f"{url}/count", admin, {"counted_quantity": "5850", "reason": "Monthly count"},
                      key="c1", expect=200).json()
        self.assertEqual(r["on_hand"], "5850.000")
        moves = self.call("GET", f"{url}/movements", admin, expect=200).json()
        count = next(m for m in moves if m["counted_quantity"])
        self.assertEqual((count["system_quantity"], count["delta_on_hand"]), ("5900.000", "-50.000"))
        waste = next(m for m in moves if m["type"] == "waste")
        self.assertEqual(waste["reason"], "spilled")
        self.assertEqual(next(m for m in moves if m["type"] == "restock")["supplier"], "Bean Co")
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where type='sale'"), 0)  # waste ≠ sale
        actions = {r[0] for r in self._rows("select action from {s}.audit_logs")}
        self.assertTrue({"stock.waste", "stock.restock", "stock.count", "ingredient.cost_changed"} <= actions)

    def test_cost_snapshot_survives_cost_change(self):
        env = self.setup_latte()
        admin = env["admin"]
        o = self.order(admin, [self.big_line(env)]).json()
        self.pay(admin, o["id"], {"method": "cash", "amount": o["totals"]["total"], "tendered": o["totals"]["total"]})
        self.status(admin, o["id"], "completed")
        # 36 g × 0.90 + 270 ml × 0.15 + 15 ml × 0.20 = 32.4 + 40.5 + 3 = 75.9
        feed = self._feed(admin)
        self.assertEqual(feed["sales"][0]["lines"][0]["cost"], 75.9)
        self.assertEqual(feed["sales"][0]["lines"][0]["cost_source"], "snapshot")
        self.call("PATCH", f"/ingredients/{env['ing']['beans']}", admin, {"unit_cost": "1.1000"}, expect=200)
        self.call("PATCH", f"/products/{env['latte']}", admin, {"name": "Latte Renamed", "price": "999.00"}, expect=200)
        feed = self._feed(admin)
        self.assertEqual(feed["sales"][0]["lines"][0]["cost"], 75.9)  # January cost kept
        self.assertEqual(feed["sales"][0]["lines"][0]["product"], "Café Latte")
        self.assertTrue(feed["data_quality"]["complete"])
        # legacy order without snapshot → marked estimated
        self.execute("update {s}.order_items set cost_snapshot = null")
        feed = self._feed(admin)
        self.assertEqual(feed["sales"][0]["lines"][0]["cost_source"], "estimated")
        self.assertFalse(feed["data_quality"]["complete"])

    def _feed(self, token: str) -> dict:
        from datetime import date, timedelta
        start, end = (date.today() - timedelta(days=1)).isoformat(), (date.today() + timedelta(days=1)).isoformat()
        return self.call("GET", f"/analytics/sales?start={start}&end={end}", token, expect=200).json()

    def _rows(self, sql: str):  # type: ignore[no-untyped-def]
        from sqlalchemy import text
        with self.engine.connect() as conn:
            return list(conn.execute(text(sql.replace("{s}", f'"{SCHEMA}"'))))


class SecurityTests(_Latte):
    def test_revoked_terminal_cannot_operate_or_reactivate(self):
        env = self.bootstrap()
        admin = env["admin"]
        device = self.register_and_activate(admin, "LOST-1")
        token = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                          device=device, expect=200).json()["token"]
        tid = next(t["id"] for t in self.call("GET", "/terminals", admin, expect=200).json() if t["code"] == "LOST-1")
        self.call("POST", f"/terminals/{tid}/revoke", admin, {}, expect=422)  # reason required
        r = self.call("POST", f"/terminals/{tid}/revoke", admin, {"reason": "Stolen tablet"}, expect=200).json()
        self.assertEqual(r["status"], "revoked")
        self.call("GET", "/orders", token, expect=401)
        self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"}, device=device,
                  expect=403)
        r = self.call("POST", f"/terminals/{tid}/reset-activation", admin, {"activation_code_minutes": 10}, expect=409)
        self.assertEqual(self.scalar("select count(*) from {s}.audit_logs where action='terminal.revoked'"), 1)

    def test_terminal_status_checked_on_every_request(self):
        env = self.bootstrap()
        device = self.register_and_activate(env["admin"], "T-2")
        token = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                          device=device, expect=200).json()["token"]
        # simulate a session row that was not ended (defence in depth)
        self.execute("update {s}.terminals set status='inactive' where code='T-2'")
        self.call("GET", "/orders", token, expect=401)

    def test_deactivated_staff_and_removed_permission_rejected_immediately(self):
        env = self.setup_latte()
        cashier = self.make_cashier(env["admin"], env["device"])
        self.order(cashier, [{"product_id": env["cookie"], "quantity": 1}])
        self.call("PUT", "/settings/permissions", env["admin"], {"roles": {"cashier": {"pos.createOrders": False}}},
                  expect=200)
        r = self.order(cashier, [{"product_id": env["cookie"], "quantity": 1}], expect=403)
        self.assertEqual(self.error_code(r), "PERMISSION_DENIED")
        uid = next(u["id"] for u in self.call("GET", "/staff", env["admin"], expect=200).json() if u["username"] == "maria")
        self.call("POST", f"/staff/{uid}/deactivate", env["admin"], expect=200)
        self.call("GET", "/orders", cashier, expect=401)

    def test_state_transition_abuse(self):
        env = self.setup_latte()
        admin = env["admin"]
        o = self.order(admin, [{"product_id": env["cookie"], "quantity": 1}]).json()
        self.call("POST", f"/orders/{o['id']}/cancel", admin, {"reason": "test"}, key=str(uuid.uuid4()), expect=200)
        for target in ("preparing", "ready", "completed", "pending"):
            r = self.status(admin, o["id"], target, expect=None)
            self.assertIn(r.status_code, (409, 422), (target, r.text))
        o = self.order(admin, [{"product_id": env["cookie"], "quantity": 1}]).json()
        self.pay(admin, o["id"], {"method": "cash", "amount": "60.00", "tendered": "60.00"})
        self.status(admin, o["id"], "completed")
        for target in ("preparing", "pending", "ready"):
            r = self.status(admin, o["id"], target, expect=None)
            self.assertIn(r.status_code, (409, 422), (target, r.text))
        r = self.call("POST", f"/orders/{o['id']}/cancel", admin, {"reason": "x"}, key=str(uuid.uuid4()), expect=None)
        self.assertEqual(r.status_code, 409)
        r = self.pay(admin, o["id"], {"method": "cash", "amount": "1.00", "tendered": "1.00"}, expect=None)
        self.assertIn(r.status_code, (409, 422))


if __name__ == "__main__":
    unittest.main()
