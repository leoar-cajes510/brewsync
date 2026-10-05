"""Choice-option ingredient effects (R4a.3a): ADD / REPLACE resolution and reservation plans."""

import unittest
from decimal import Decimal

from domain_support import T0, m, product
from app.domain.errors import InsufficientStock, ValidationError
from app.domain.inventory import ReservationPlan, StockKey, StockLevel, SubjectType, finalize_sale_all, release_all, reserve_all
from app.domain.order import OrderItem
from app.domain.product import ChoiceGroup, ChoiceOption, SelectionType
from app.domain.recipe import (
    ChoiceEffect, EffectMode, Recipe, RecipeLine, resolve_unit_consumption, validate_option_effects,
)

D = Decimal
LATTE = Recipe("p-latte", (RecipeLine("beans", D("18")), RecipeLine("milk", D("180"))))
OAT = ChoiceEffect("o-oat", EffectMode.REPLACE, "oat", D("180"), "milk")
SHOT = ChoiceEffect("o-shot", EffectMode.ADD, "beans", D("9"))
CARAMEL = ChoiceEffect("o-caramel", EffectMode.ADD, "caramel", D("15"))


def ing(key):
    return StockKey(SubjectType.INGREDIENT, key)


def level(key, on_hand):
    lv = StockLevel(key, D("0"))
    lv.set_initial(D(on_hand), actor_id="u", at=T0)
    return lv


class ResolveTests(unittest.TestCase):
    def test_base_recipe_with_multiple_lines(self):
        self.assertEqual(resolve_unit_consumption(LATTE), {"beans": 18, "milk": 180})

    def test_product_with_no_recipe(self):
        self.assertEqual(resolve_unit_consumption(None), {})
        self.assertEqual(resolve_unit_consumption(None, [OAT]), {})  # REPLACE without a base line is ignored

    def test_one_add_effect_sums_with_base_line(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [SHOT]), {"beans": 27, "milk": 180})

    def test_multiple_add_effects(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [SHOT, CARAMEL]), {"beans": 27, "milk": 180, "caramel": 15})

    def test_valid_replace(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [OAT]), {"beans": 18, "oat": 180})

    def test_replace_uses_declared_quantity(self):
        small = ChoiceEffect("o-oat", EffectMode.REPLACE, "oat", D("150"), "milk")
        self.assertEqual(resolve_unit_consumption(LATTE, [small])["oat"], 150)

    def test_replace_ignored_when_source_not_in_base_recipe(self):
        americano = Recipe("p-am", (RecipeLine("beans", D("18")),))
        self.assertEqual(resolve_unit_consumption(americano, [OAT]), {"beans": 18})  # no oat added

    def test_replace_checks_base_recipe_not_added_ingredients(self):
        add_milk = ChoiceEffect("o-x", EffectMode.ADD, "milk", D("30"))
        americano = Recipe("p-am", (RecipeLine("beans", D("18")),))
        self.assertEqual(resolve_unit_consumption(americano, [add_milk, OAT]), {"beans": 18, "milk": 30})

    def test_full_example(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [OAT, SHOT, CARAMEL]),
                         {"beans": 27, "oat": 180, "caramel": 15})

    def test_two_options_replacing_the_same_ingredient_are_refused(self):
        soy = ChoiceEffect("o-soy", EffectMode.REPLACE, "soy", D("180"), "milk")
        with self.assertRaises(ValidationError):
            resolve_unit_consumption(LATTE, [OAT, soy])

    def test_quantity_multiplied_by_units(self):
        self.assertEqual(LATTE.consumption(3, [OAT, SHOT]), {"beans": 81, "oat": 540})


class EffectValidationTests(unittest.TestCase):
    def test_rules(self):
        for bad in (dict(mode="add", ingredient_id="a", quantity=D("1"), replaces_ingredient_id="b"),
                    dict(mode="replace", ingredient_id="a", quantity=D("1")),
                    dict(mode="replace", ingredient_id="a", quantity=D("1"), replaces_ingredient_id="a"),
                    dict(mode="add", ingredient_id="a", quantity=D("0")),
                    dict(mode="add", ingredient_id="a", quantity=D("-1")),
                    dict(mode="remove", ingredient_id="a", quantity=D("1"))):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                ChoiceEffect("o", **bad)

    def test_duplicate_or_conflicting_effects_in_one_option(self):
        with self.assertRaises(ValidationError):
            validate_option_effects([SHOT, ChoiceEffect("o-shot", EffectMode.ADD, "beans", D("5"))])
        with self.assertRaises(ValidationError):
            validate_option_effects([OAT, ChoiceEffect("o-oat", EffectMode.REPLACE, "soy", D("1"), "milk")])
        self.assertEqual(len(validate_option_effects([SHOT, CARAMEL])), 2)


class PlanTests(unittest.TestCase):
    def test_plan_applies_effects_and_aggregates_lines(self):
        latte = product("p-latte", track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 2, (OAT, SHOT)), (latte, 1)], {"p-latte": LATTE})
        self.assertEqual(dict(plan.quantities), {ing("beans"): 72, ing("milk"): 180, ing("oat"): 360})  # 2×27 + 1×18

    def test_effects_ignored_when_product_does_not_track_ingredients(self):
        plan = ReservationPlan.for_lines([(product("p-latte", track_units=True), 1, (SHOT,))], {"p-latte": LATTE})
        self.assertEqual(dict(plan.quantities), {StockKey(SubjectType.PRODUCT, "p-latte"): 1})

    def test_unit_tracking_unchanged_alongside_effects(self):
        latte = product("p-latte", track_units=True, track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 2, (CARAMEL,))], {"p-latte": LATTE})
        self.assertEqual(plan.quantities[StockKey(SubjectType.PRODUCT, "p-latte")], 2)
        self.assertEqual(plan.quantities[ing("caramel")], 30)

    def test_reserve_complete_and_cancel_use_frozen_quantities(self):
        latte = product("p-latte", track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 1, (OAT, SHOT, CARAMEL))], {"p-latte": LATTE})
        levels = {ing("beans"): level(ing("beans"), "5000"), ing("oat"): level(ing("oat"), "5000"),
                  ing("caramel"): level(ing("caramel"), "3000")}
        reserve_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        sales = finalize_sale_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        self.assertEqual({mv.key.subject_id: mv.delta_on_hand for mv in sales}, {"beans": -27, "oat": -180, "caramel": -15})
        self.assertEqual(levels[ing("beans")].on_hand, 4973)
        self.assertEqual(sum(lv.reserved for lv in levels.values()), 0)

        plan2 = ReservationPlan.for_lines([(latte, 2, (OAT,))], {"p-latte": LATTE})
        levels2 = {ing("beans"): level(ing("beans"), "100"), ing("oat"): level(ing("oat"), "1000")}
        reserve_all(plan2, levels2, order_id="o-2", actor_id="u", at=T0)
        release_all(plan2, levels2, order_id="o-2", actor_id="u", at=T0)
        self.assertEqual([(lv.on_hand, lv.reserved) for lv in levels2.values()], [(100, 0), (1000, 0)])

    def test_insufficient_effect_ingredient_refuses_whole_order(self):
        latte = product("p-latte", track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 1, (CARAMEL,))], {"p-latte": LATTE})
        levels = {ing("beans"): level(ing("beans"), "100"), ing("milk"): level(ing("milk"), "1000"),
                  ing("caramel"): level(ing("caramel"), "10")}
        with self.assertRaises(InsufficientStock):
            reserve_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        self.assertEqual(sum(lv.reserved for lv in levels.values()), 0)


SMALL = ChoiceEffect("o-small", EffectMode.SCALE, None, D("1.0"))
MEDIUM = ChoiceEffect("o-medium", EffectMode.SCALE, None, D("1.25"))
LARGE = ChoiceEffect("o-large", EffectMode.SCALE, None, D("1.5"))


class ScaleTests(unittest.TestCase):
    def test_small_medium_large(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [SMALL]), {"beans": 18, "milk": 180})
        self.assertEqual(resolve_unit_consumption(LATTE, [MEDIUM]), {"beans": D("22.5"), "milk": 225})
        self.assertEqual(resolve_unit_consumption(LATTE, [LARGE]), {"beans": 27, "milk": 270})

    def test_scale_then_replace_scales_the_replacement(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [LARGE, OAT]), {"beans": 27, "oat": 270})

    def test_scale_then_add_keeps_add_fixed(self):
        self.assertEqual(resolve_unit_consumption(LATTE, [LARGE, SHOT]), {"beans": 36, "milk": 270})

    def test_scale_replace_add_full_example_order_independent(self):
        want = {"beans": 36, "oat": 270, "caramel": 15}
        self.assertEqual(resolve_unit_consumption(LATTE, [LARGE, OAT, SHOT, CARAMEL]), want)
        self.assertEqual(resolve_unit_consumption(LATTE, [CARAMEL, SHOT, OAT, LARGE]), want)

    def test_scale_never_adds_ingredients(self):
        self.assertEqual(resolve_unit_consumption(None, [LARGE]), {})
        self.assertEqual(set(resolve_unit_consumption(LATTE, [LARGE])), {"beans", "milk"})

    def test_multiple_units(self):
        self.assertEqual(LATTE.consumption(3, [LARGE, OAT, SHOT]), {"beans": 108, "oat": 810})

    def test_scaled_quantities_round_to_three_places(self):
        odd = Recipe("p", (RecipeLine("x", D("0.333")),))
        self.assertEqual(resolve_unit_consumption(odd, [MEDIUM]), {"x": D("0.416")})  # 0.41625 → 0.416

    def test_two_selected_scales_are_refused(self):
        with self.assertRaises(ValidationError):
            resolve_unit_consumption(LATTE, [MEDIUM, LARGE])

    def test_scale_validation(self):
        for bad in (dict(ingredient_id="beans", quantity=D("1.5")),
                    dict(ingredient_id=None, quantity=D("1.5"), replaces_ingredient_id="milk"),
                    dict(ingredient_id=None, quantity=D("0")),
                    dict(ingredient_id=None, quantity=D("11"))):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                ChoiceEffect("o", EffectMode.SCALE, **bad)
        with self.assertRaises(ValidationError):
            ChoiceEffect("o", EffectMode.ADD, None, D("1"))
        with self.assertRaises(ValidationError):
            validate_option_effects([LARGE, ChoiceEffect("o-large", EffectMode.SCALE, None, D("2"))])
        self.assertEqual(len(validate_option_effects([LARGE, SHOT])), 2)

    def test_plan_reserve_complete_and_cancel_with_scale(self):
        latte = product("p-latte", track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 2, (LARGE, OAT, SHOT))], {"p-latte": LATTE})
        self.assertEqual(dict(plan.quantities), {ing("beans"): 72, ing("oat"): 540})
        levels = {ing("beans"): level(ing("beans"), "5000"), ing("oat"): level(ing("oat"), "5000")}
        reserve_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        release_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        self.assertEqual([(lv.on_hand, lv.reserved) for lv in levels.values()], [(5000, 0), (5000, 0)])
        reserve_all(plan, levels, order_id="o-2", actor_id="u", at=T0)
        finalize_sale_all(plan, levels, order_id="o-2", actor_id="u", at=T0)
        self.assertEqual([lv.on_hand for lv in levels.values()], [4928, 4460])

    def test_insufficient_stock_after_scaling(self):
        latte = product("p-latte", track_ingredients=True)
        plan = ReservationPlan.for_lines([(latte, 1, (LARGE,))], {"p-latte": LATTE})
        levels = {ing("beans"): level(ing("beans"), "100"), ing("milk"): level(ing("milk"), "200")}  # 270 needed
        with self.assertRaises(InsufficientStock):
            reserve_all(plan, levels, order_id="o-1", actor_id="u", at=T0)


class PriceTests(unittest.TestCase):
    def test_combined_choice_price_deltas(self):
        size = ChoiceGroup("g-size", "SIZE", "Size", SelectionType.SINGLE, True, 1, 1,
                           (ChoiceOption("o-m", "g-size", "Medium", m("20.00")),))
        addons = ChoiceGroup("g-add", "ADD", "Add-ons", SelectionType.MULTI, False, 0, 2,
                             (ChoiceOption("o-shot", "g-add", "Extra Espresso", m("25.00")),
                              ChoiceOption("o-caramel", "g-add", "Caramel", m("15.00"))))
        latte = product("p-latte", "130.00", groups=("g-size", "g-add"))
        resolved = latte.resolve_selections({"g-size": size, "g-add": addons},
                                            {"g-size": ["o-m"], "g-add": ["o-shot", "o-caramel"]})
        item = OrderItem.from_product("i-1", latte, resolved, 2)
        self.assertEqual((item.unit_price, item.line_total), (m("190.00"), m("380.00")))
        self.assertEqual([(c.option_name, c.price_delta) for c in item.choices],
                         [("Medium", m("20.00")), ("Extra Espresso", m("25.00")), ("Caramel", m("15.00"))])


if __name__ == "__main__":
    unittest.main()
