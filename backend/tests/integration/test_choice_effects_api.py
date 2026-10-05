"""Choice-option ingredient effects through the real API and database (R4a.3a)."""

import threading
import unittest
import uuid
from decimal import Decimal

from db_support import DbTestCase


class ChoiceEffectsApiTests(DbTestCase):
    def _ingredient(self, admin: str, code: str, name: str, unit: str, stock: str, cost: str = "0.1000") -> str:
        return self.call("POST", "/ingredients", admin, {"code": code, "name": name, "unit": unit, "unit_cost": cost,
                                                         "initial_stock": stock, "low_stock_threshold": "0"},
                         expect=201).json()["id"]

    def _setup(self, *, caramel_stock: str = "3000") -> dict:
        env = self.bootstrap()
        admin = env["admin"]
        ing = {"beans": self._ingredient(admin, "BEANS", "Espresso Beans", "g", "5000", "0.9000"),
               "milk": self._ingredient(admin, "MILK", "Fresh Milk", "ml", "20000", "0.0800"),
               "oat": self._ingredient(admin, "OAT", "Oat Milk", "ml", "5000", "0.1500"),
               "caramel": self._ingredient(admin, "CARAMEL", "Caramel Syrup", "ml", caramel_stock, "0.2000")}
        size = self.call("POST", "/choice-groups", admin, {
            "code": "SIZE", "name": "Size", "display_name": "Size", "selection_type": "single", "required": True,
            "min_select": 1, "max_select": 1, "options": [{"name": "Small", "price_delta": "0"},
                                                          {"name": "Medium", "price_delta": "20"},
                                                          {"name": "Large", "price_delta": "35"}]}, expect=201).json()
        milk = self.call("POST", "/choice-groups", admin, {
            "code": "MILK", "name": "Milk Type", "display_name": "Milk Type", "selection_type": "single",
            "required": False, "min_select": 0, "max_select": 1, "options": [
                {"name": "Fresh Milk", "price_delta": "0"},
                {"name": "Oat Milk", "price_delta": "30", "effects": [
                    {"mode": "replace", "replaces_ingredient_id": ing["milk"], "ingredient_id": ing["oat"],
                     "quantity": "180"}]}]}, expect=201).json()
        addons = self.call("POST", "/choice-groups", admin, {
            "code": "ADDONS", "name": "Add-ons", "display_name": "Add-ons", "selection_type": "multi",
            "required": False, "min_select": 0, "max_select": 2, "options": [
                {"name": "Extra Espresso", "price_delta": "25",
                 "effects": [{"mode": "add", "ingredient_id": ing["beans"], "quantity": "9"}]},
                {"name": "Caramel Syrup", "price_delta": "15",
                 "effects": [{"mode": "add", "ingredient_id": ing["caramel"], "quantity": "15"}]}]}, expect=201).json()
        cat = self.call("POST", "/categories", admin, {"name": "Coffee", "code_prefix": "COF"}, expect=201).json()["id"]
        latte = self.call("POST", "/products", admin, {
            "name": "Café Latte", "category_id": cat, "price": "130.00", "tax_class": "taxable",
            "choice_group_ids": [size["id"], milk["id"], addons["id"]]}, expect=201).json()["id"]
        self.call("PUT", f"/products/{latte}/recipe", admin, {"track_ingredients": True, "lines": [
            {"ingredient_id": ing["beans"], "quantity": "18"}, {"ingredient_id": ing["milk"], "quantity": "180"}]},
            expect=200)
        opt = {o["name"]: o["id"] for g in (size, milk, addons) for o in g["options"]}
        return {**env, "ing": ing, "latte": latte, "opt": opt,
                "groups": {"size": size["id"], "milk": milk["id"], "addons": addons["id"]}}

    def _line(self, env: dict, qty: int = 1, size: str = "Medium", milk: str | None = "Oat Milk",
              addons: tuple[str, ...] = ("Extra Espresso", "Caramel Syrup")) -> dict:
        sel = {env["groups"]["size"]: [env["opt"][size]], env["groups"]["addons"]: [env["opt"][a] for a in addons]}
        if milk:
            sel[env["groups"]["milk"]] = [env["opt"][milk]]
        return {"product_id": env["latte"], "quantity": qty, "selections": sel}

    def _levels(self) -> dict[str, tuple[Decimal, Decimal]]:
        with self.engine.connect() as c:
            from sqlalchemy import text
            rows = c.execute(text(f'select i.code, l.on_hand, l.reserved from "{self.schema}".stock_levels l join '
                                  f'"{self.schema}".ingredients i on i.id = l.subject_id')).all()
        return {r[0]: (r[1], r[2]) for r in rows}

    @property
    def schema(self) -> str:
        from db_support import SCHEMA
        return SCHEMA

    def _complete(self, env: dict, order: dict) -> None:
        self.pay(env["admin"], order["id"], {"method": "cash", "amount": order["totals"]["total"],
                                             "tendered": order["totals"]["total"]})
        self.status(env["admin"], order["id"], "completed")

    def test_full_example_price_reservation_completion_and_history(self):
        env = self._setup()
        quote = self.call("POST", "/orders/quote", env["admin"], {"order_type": "takeout", "lines": [self._line(env)]},
                          expect=200).json()
        self.assertEqual(quote["subtotal"], "220.00")  # 130 + 20 + 30 + 25 + 15
        order = self.order(env["admin"], [self._line(env)]).json()
        self.assertEqual(order["totals"]["subtotal"], "220.00")
        lv = self._levels()
        self.assertEqual({k: v[1] for k, v in lv.items()}, {"BEANS": 27, "MILK": 0, "OAT": 180, "CARAMEL": 15})

        self._complete(env, order)
        self._complete_again_is_refused(env, order)
        lv = self._levels()
        self.assertEqual({k: v[0] for k, v in lv.items()}, {"BEANS": 4973, "MILK": 20000, "OAT": 4820, "CARAMEL": 2985})
        self.assertEqual({k: v[1] for k, v in lv.items()}, {"BEANS": 0, "MILK": 0, "OAT": 0, "CARAMEL": 0})
        counts = self.scalar("select count(*) from {s}.stock_movements where reference_id = :o and type = 'sale'",
                             o=order["id"])
        self.assertEqual(counts, 3)  # one sale per consumed ingredient, Fresh Milk untouched
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where reference_id = :o "
                                     "and type = 'reservation'", o=order["id"]), 3)

        # history keeps the selected names/prices; later effect/recipe edits do not touch the frozen order
        self.call("PUT", f"/products/{env['latte']}/recipe", env["admin"], {"track_ingredients": True, "lines": [
            {"ingredient_id": env["ing"]["beans"], "quantity": "36"}]}, expect=200)
        detail = self.call("GET", f"/history/{order['id']}", env["admin"], expect=200).json()
        names = [(c["option"], c["price_delta"]) for c in detail["items"][0]["choices"]]
        self.assertEqual(names, [("Medium", "20.00"), ("Oat Milk", "30.00"), ("Extra Espresso", "25.00"),
                                 ("Caramel Syrup", "15.00")])
        frozen = self.scalar("select reservation from {s}.orders where id = :o", o=order["id"])
        self.assertEqual(sorted(Decimal(v) for v in frozen.values()), [15, 27, 180])  # frozen at creation

    def _complete_again_is_refused(self, env: dict, order: dict) -> None:
        r = self.status(env["admin"], order["id"], "completed", expect=409)
        self.assertIn(self.error_code(r), ("INVALID_TRANSITION", "CONFLICT"))

    def test_cancel_restores_exact_reservation(self):
        env = self._setup()
        order = self.order(env["admin"], [self._line(env, qty=2)]).json()
        self.assertEqual(self._levels()["BEANS"][1], 54)
        self.call("POST", f"/orders/{order['id']}/cancel", env["admin"], {"reason": "Customer left"},
                  key=str(uuid.uuid4()), expect=200)
        lv = self._levels()
        self.assertEqual(lv, {"BEANS": (5000, 0), "MILK": (20000, 0), "OAT": (5000, 0), "CARAMEL": (3000, 0)})
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where reference_id = :o and "
                                     "type = 'reservation_release'", o=order["id"]), 3)

    def test_fresh_milk_default_path_and_no_addons(self):
        env = self._setup()
        order = self.order(env["admin"], [self._line(env, size="Small", milk="Fresh Milk", addons=())]).json()
        self.assertEqual(order["totals"]["subtotal"], "130.00")
        self.assertEqual({k: v[1] for k, v in self._levels().items()}, {"BEANS": 18, "MILK": 180, "OAT": 0, "CARAMEL": 0})

    def test_insufficient_effect_stock_refuses_order(self):
        env = self._setup(caramel_stock="10")
        r = self.order(env["admin"], [self._line(env)], expect=409)
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")
        self.assertEqual(sum(v[1] for v in self._levels().values()), 0)

    def test_concurrent_orders_cannot_both_take_the_last_stock(self):
        env = self._setup(caramel_stock="15")  # enough for exactly one caramel latte
        codes: list[int] = []

        def place() -> None:
            codes.append(self.order(env["admin"], [self._line(env)], expect=None).status_code)

        threads = [threading.Thread(target=place) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sorted(codes), [201, 409])
        self.assertEqual(self._levels()["CARAMEL"], (15, 15))

    def test_effects_listed_and_missing_key_keeps_effects(self):
        env = self._setup()
        groups = {g["code"]: g for g in self.call("GET", "/choice-groups", env["admin"], expect=200).json()}
        oat = next(o for o in groups["MILK"]["options"] if o["name"] == "Oat Milk")
        self.assertEqual(oat["effects"], [{"mode": "replace", "ingredient_id": env["ing"]["oat"],
                                           "replaces_ingredient_id": env["ing"]["milk"], "quantity": "180.000"}])
        self.assertEqual(oat["effect_warnings"], [])
        # PATCH without "effects" (e.g. a rename) must not wipe them; [] clears
        opts = [{"id": o["id"], "name": o["name"], "price_delta": o["price_delta"]} for o in groups["MILK"]["options"]]
        self.call("PATCH", f"/choice-groups/{env['groups']['milk']}", env["admin"], {"options": opts}, expect=200)
        self.assertEqual(self.scalar("select count(*) from {s}.choice_option_effects"), 3)
        opts[1]["effects"] = []
        self.call("PATCH", f"/choice-groups/{env['groups']['milk']}", env["admin"], {"options": opts}, expect=200)
        self.assertEqual(self.scalar("select count(*) from {s}.choice_option_effects"), 2)

    def test_replace_without_base_ingredient_is_ignored_and_warned(self):
        env = self._setup()
        cat = self.scalar("select id from {s}.categories")
        americano = self.call("POST", "/products", env["admin"], {
            "name": "Americano", "category_id": str(cat), "price": "110.00", "tax_class": "taxable",
            "choice_group_ids": [env["groups"]["milk"]]}, expect=201).json()["id"]
        self.call("PUT", f"/products/{americano}/recipe", env["admin"], {"track_ingredients": True, "lines": [
            {"ingredient_id": env["ing"]["beans"], "quantity": "18"}]}, expect=200)
        self.order(env["admin"], [{"product_id": americano, "quantity": 1,
                                   "selections": {env["groups"]["milk"]: [env["opt"]["Oat Milk"]]}}])
        self.assertEqual({k: v[1] for k, v in self._levels().items()}, {"BEANS": 18, "MILK": 0, "OAT": 0, "CARAMEL": 0})
        groups = {g["code"]: g for g in self.call("GET", "/choice-groups", env["admin"], expect=200).json()}
        oat = next(o for o in groups["MILK"]["options"] if o["name"] == "Oat Milk")
        self.assertEqual(oat["effect_warnings"], ["Americano"])

    def test_validation_rules(self):
        env = self._setup()
        gid, ing = env["groups"]["addons"], env["ing"]
        base = [{"id": env["opt"]["Extra Espresso"], "name": "Extra Espresso", "price_delta": "25"}]
        for bad, code in (
            ({"mode": "add", "ingredient_id": ing["beans"], "quantity": "0"}, 422),
            ({"mode": "add", "ingredient_id": ing["beans"], "quantity": "9", "replaces_ingredient_id": ing["milk"]}, 422),
            ({"mode": "replace", "ingredient_id": ing["oat"], "quantity": "9"}, 422),
            ({"mode": "replace", "ingredient_id": ing["oat"], "replaces_ingredient_id": ing["oat"], "quantity": "9"}, 422),
            ({"mode": "swap", "ingredient_id": ing["beans"], "quantity": "9"}, 422),
            ({"mode": "add", "ingredient_id": str(uuid.uuid4()), "quantity": "9"}, 404),
        ):
            with self.subTest(bad=bad):
                r = self.call("PATCH", f"/choice-groups/{gid}", env["admin"],
                              {"options": [{**base[0], "effects": [bad]}]})
                self.assertEqual(r.status_code, code, r.text)
        dup = [{"mode": "add", "ingredient_id": ing["beans"], "quantity": "9"},
               {"mode": "add", "ingredient_id": ing["beans"], "quantity": "5"}]
        r = self.call("PATCH", f"/choice-groups/{gid}", env["admin"], {"options": [{**base[0], "effects": dup}]})
        self.assertEqual(r.status_code, 422, r.text)
        self.assertEqual(self.scalar("select count(*) from {s}.choice_option_effects"), 3)  # nothing changed

    def test_two_selected_options_replacing_the_same_ingredient_are_refused(self):
        env = self._setup()
        soy = self._ingredient(env["admin"], "SOY", "Soy Milk", "ml", "1000")
        self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", env["admin"], {"options": [
            {"id": env["opt"]["Extra Espresso"], "name": "Extra Espresso", "price_delta": "25", "effects": [
                {"mode": "replace", "replaces_ingredient_id": env["ing"]["milk"], "ingredient_id": soy, "quantity": "180"}]},
            {"id": env["opt"]["Caramel Syrup"], "name": "Caramel Syrup", "price_delta": "15"}]}, expect=200)
        r = self.call("POST", "/orders/quote", env["admin"], {"order_type": "takeout", "lines": [self._line(env)]})
        self.assertEqual(r.status_code, 422, r.text)
        self.order(env["admin"], [self._line(env)], expect=r.status_code)

    def test_wrong_business_ingredient_rejected(self):
        env = self._setup()
        other_biz, other_ing = uuid.uuid4(), uuid.uuid4()
        self.execute("insert into {s}.businesses (id, name, business_type, address, phone, email, currency_code, "
                     "timezone, created_at) values (:b, 'Other', 'Café', '', '', '', 'PHP', 'Asia/Manila', now())",
                     b=other_biz)
        self.execute("insert into {s}.ingredients (id, business_id, code, name, category, unit, unit_cost, notes, "
                     "active) values (:i, :b, 'X', 'Foreign Milk', '', 'ml', 0, '', true)", i=other_ing, b=other_biz)
        for effect in ({"mode": "add", "ingredient_id": str(other_ing), "quantity": "9"},
                       {"mode": "replace", "ingredient_id": env["ing"]["oat"], "replaces_ingredient_id": str(other_ing),
                        "quantity": "9"}):
            r = self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", env["admin"], {"options": [
                {"id": env["opt"]["Extra Espresso"], "name": "Extra Espresso", "price_delta": "25",
                 "effects": [effect]}]}, expect=404)
            self.assertEqual(self.error_code(r), "NOT_FOUND")
        other_group = uuid.uuid4()
        self.execute("insert into {s}.choice_groups (id, business_id, code, name, display_name, description, "
                     "selection_type, required, min_select, max_select, active) values "
                     "(:g, :b, 'OG', 'OG', 'OG', '', 'multi', false, 0, 1, true)", g=other_group, b=other_biz)
        self.call("PATCH", f"/choice-groups/{other_group}", env["admin"], {"name": "Mine"}, expect=404)

    def test_deactivated_ingredient_does_not_block_group_edits(self):
        env = self._setup()
        self.call("PATCH", f"/ingredients/{env['ing']['caramel']}", env["admin"], {"active": False}, expect=200)
        groups = {g["code"]: g for g in self.call("GET", "/choice-groups", env["admin"], expect=200).json()}
        opts = [{"id": o["id"], "name": o["name"], "price_delta": o["price_delta"], "effects": o["effects"]}
                for o in groups["ADDONS"]["options"]]
        self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", env["admin"],
                  {"name": "Extras", "options": opts}, expect=200)  # unchanged stored effect: accepted
        opts[1]["effects"] = [{**opts[1]["effects"][0], "quantity": "20"}]
        r = self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", env["admin"], {"options": opts}, expect=422)
        self.assertIn("inactive", r.text)  # a new/changed reference to an inactive ingredient is refused

    def test_duplicate_code_with_effects_is_a_conflict(self):
        env = self._setup()
        r = self.call("POST", "/choice-groups", env["admin"], {
            "code": "ADDONS", "name": "Dup", "display_name": "Dup", "selection_type": "multi", "required": False,
            "min_select": 0, "max_select": 1, "options": [{"name": "X", "price_delta": "0", "effects": [
                {"mode": "add", "ingredient_id": env["ing"]["beans"], "quantity": "1"}]}]}, expect=409)
        self.assertEqual(self.error_code(r), "CONFLICT")

    def test_effects_need_the_recipe_permission(self):
        env = self._setup()
        cashier = self.make_cashier(env["admin"], env["device"])
        self.call("PUT", "/settings/permissions", env["admin"], {"roles": {"cashier": {"choices.manage": True}}},
                  expect=200)
        cashier = self.call("POST", "/auth/login", json={"username": "maria", "credential": "5678"},
                            device=env["device"], expect=200).json()["token"]
        opt = {"id": env["opt"]["Extra Espresso"], "name": "Extra Espresso", "price_delta": "25"}
        r = self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", cashier, {"options": [
            {**opt, "effects": []}, {"id": env["opt"]["Caramel Syrup"], "name": "Caramel Syrup", "price_delta": "15"}]},
            expect=403)
        self.assertIn("ingredients.recipes", r.text)
        self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", cashier, {"options": [
            opt, {"id": env["opt"]["Caramel Syrup"], "name": "Caramel Syrup", "price_delta": "15"}]}, expect=200)
        self.assertEqual(self.scalar("select count(*) from {s}.choice_option_effects"), 3)  # untouched

    # --- SCALE (size-based recipe scaling) --------------------------------------------------------------
    def _with_sizes(self, small: str = "1.0", medium: str = "1.25", large: str = "1.5", **kw) -> dict:
        env = self._setup(**kw)
        self.call("PATCH", f"/choice-groups/{env['groups']['size']}", env["admin"], {"options": [
            {"id": env["opt"][name], "name": name, "price_delta": price,
             "effects": [{"mode": "scale", "quantity": factor}]}
            for name, price, factor in (("Small", "0", small), ("Medium", "20", medium), ("Large", "35", large))]},
            expect=200)
        return env

    def test_scale_replace_add_price_reservation_completion_and_costing(self):
        env = self._with_sizes()
        line = self._line(env, qty=2, size="Large", addons=("Extra Espresso",))
        quote = self.call("POST", "/orders/quote", env["admin"], {"order_type": "takeout", "lines": [line]},
                          expect=200).json()
        self.assertEqual(quote["subtotal"], "440.00")  # (130 + 35 + 30 + 25) × 2 — prices independent of scale
        order = self.order(env["admin"], [line]).json()
        # per unit: beans 18×1.5 + 9 = 36, oat 180×1.5 = 270; × 2
        self.assertEqual({k: v[1] for k, v in self._levels().items()}, {"BEANS": 72, "MILK": 0, "OAT": 540, "CARAMEL": 0})
        self._complete(env, order)
        self.assertEqual({k: v[0] for k, v in self._levels().items()},
                         {"BEANS": 4928, "MILK": 20000, "OAT": 4460, "CARAMEL": 3000})
        self.assertEqual(self.scalar("select count(*) from {s}.stock_movements where reference_id = :o and type = 'sale'",
                                     o=order["id"]), 2)
        from datetime import datetime, timedelta, timezone
        today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
        sales = self.call("GET", f"/analytics/sales?start={today}&end={today}", env["admin"], expect=200).json()["sales"]
        # unit cost = 36 g × 0.90 + 270 ml × 0.15 = 32.40 + 40.50
        self.assertAlmostEqual(sales[0]["lines"][0]["cost"], 72.90, places=2)

    def test_medium_and_small_and_cancel_restores(self):
        env = self._with_sizes()
        order = self.order(env["admin"], [self._line(env, size="Medium", milk="Fresh Milk", addons=())]).json()
        self.assertEqual(order["totals"]["subtotal"], "150.00")
        self.assertEqual({k: v[1] for k, v in self._levels().items()},
                         {"BEANS": Decimal("22.5"), "MILK": 225, "OAT": 0, "CARAMEL": 0})
        self.call("POST", f"/orders/{order['id']}/cancel", env["admin"], {"reason": "x"}, key=str(uuid.uuid4()), expect=200)
        self.assertEqual(self._levels(), {"BEANS": (5000, 0), "MILK": (20000, 0), "OAT": (5000, 0), "CARAMEL": (3000, 0)})
        self.order(env["admin"], [self._line(env, size="Small", milk="Fresh Milk", addons=())])
        self.assertEqual({k: v[1] for k, v in self._levels().items()}, {"BEANS": 18, "MILK": 180, "OAT": 0, "CARAMEL": 0})

    def test_scaled_reservation_is_frozen_against_later_edits(self):
        env = self._with_sizes()
        order = self.order(env["admin"], [self._line(env, size="Large", milk="Fresh Milk", addons=())]).json()
        self.call("PATCH", f"/choice-groups/{env['groups']['size']}", env["admin"], {"options": [
            {"id": env["opt"]["Large"], "name": "Large", "price_delta": "35", "effects": [{"mode": "scale", "quantity": "3"}]},
            {"id": env["opt"]["Small"], "name": "Small", "price_delta": "0"},
            {"id": env["opt"]["Medium"], "name": "Medium", "price_delta": "20"}]}, expect=200)
        self._complete(env, order)
        self.assertEqual({k: v[0] for k, v in self._levels().items()},
                         {"BEANS": 4973, "MILK": 19730, "OAT": 5000, "CARAMEL": 3000})  # 1.5× as reserved, not 3×

    def test_insufficient_stock_after_scaling(self):
        env = self._with_sizes()
        small = self.order(env["admin"], [self._line(env, qty=27, size="Small", addons=())]).json()  # 27 × 180 = 4860 oat
        r = self.order(env["admin"], [self._line(env, qty=1, size="Large", addons=())], expect=409)  # 270 > 140 left
        self.assertEqual(self.error_code(r), "INSUFFICIENT_STOCK")
        self.order(env["admin"], [self._line(env, qty=1, size="Small", addons=())], expect=409)  # 180 > 140 too
        self.call("POST", f"/orders/{small['id']}/cancel", env["admin"], {"reason": "x"}, key=str(uuid.uuid4()), expect=200)
        self.order(env["admin"], [self._line(env, qty=1, size="Large", addons=())])  # fits again after release

    def test_conflicting_scale_configuration_and_selection(self):
        env = self._with_sizes()
        size = env["groups"]["size"]
        two = [{"mode": "scale", "quantity": "1.5"}, {"mode": "scale", "quantity": "2"}]
        for effects in (two, [{"mode": "scale", "quantity": "1.5", "ingredient_id": env["ing"]["beans"]}],
                        [{"mode": "scale", "quantity": "0"}], [{"mode": "scale", "quantity": "11"}]):
            with self.subTest(effects=effects):
                self.call("PATCH", f"/choice-groups/{size}", env["admin"], {"options": [
                    {"id": env["opt"]["Large"], "name": "Large", "price_delta": "35", "effects": effects},
                    {"id": env["opt"]["Small"], "name": "Small", "price_delta": "0"},
                    {"id": env["opt"]["Medium"], "name": "Medium", "price_delta": "20"}]}, expect=422)
        # A second group whose option also scales: selecting both is ambiguous → refused at quote and creation
        cup = self.call("POST", "/choice-groups", env["admin"], {
            "code": "CUP", "name": "Cup", "display_name": "Cup", "selection_type": "single", "required": False,
            "min_select": 0, "max_select": 1, "options": [
                {"name": "Jumbo Cup", "price_delta": "10", "effects": [{"mode": "scale", "quantity": "2"}]}]},
            expect=201).json()
        self.call("PATCH", f"/products/{env['latte']}", env["admin"],
                  {"choice_group_ids": [*env["groups"].values(), cup["id"]]}, expect=200)
        line = self._line(env, size="Large")
        line["selections"][cup["id"]] = [cup["options"][0]["id"]]
        r = self.call("POST", "/orders/quote", env["admin"], {"order_type": "takeout", "lines": [line]}, expect=422)
        self.assertIn("scale", r.text)
        self.order(env["admin"], [line], expect=422)
        self.assertEqual(sum(v[1] for v in self._levels().values()), 0)

    def test_permissions_and_feature_gate(self):
        env = self._setup()
        cashier = self.make_cashier(env["admin"], env["device"])
        effect = {"mode": "add", "ingredient_id": env["ing"]["beans"], "quantity": "9"}
        body = {"options": [{"id": env["opt"]["Extra Espresso"], "name": "Extra Espresso", "price_delta": "25",
                             "effects": [effect]}]}
        self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", cashier, body, expect=403)
        version = self.call("GET", "/settings/features", env["admin"], expect=200).json()["version"]
        data = {**self.SETUP["settings"]["features"], "ingredients": False}
        self.call("PUT", "/settings/features", env["admin"], {"version": version, "data": data}, expect=200)
        r = self.call("PATCH", f"/choice-groups/{env['groups']['addons']}", env["admin"], body, expect=403)
        self.assertEqual(self.error_code(r), "FEATURE_DISABLED")


if __name__ == "__main__":
    unittest.main()
