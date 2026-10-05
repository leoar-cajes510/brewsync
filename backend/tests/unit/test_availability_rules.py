"""Shared availability rule (shortfalls), choice-aware POS availability, waste reasons and counts."""

import unittest
from decimal import Decimal

from domain_support import T0, product
from app.domain.errors import InsufficientStock, StockReserved, ValidationError
from app.domain.inventory import (
    ReservationPlan, StockKey, StockLevel, SubjectType, WasteReason, pos_availability, reserve_all, shortfalls,
)
from app.domain.recipe import ChoiceEffect, Recipe, RecipeLine

BEANS = StockKey(SubjectType.INGREDIENT, "beans")
MILK = StockKey(SubjectType.INGREDIENT, "milk")
OAT = StockKey(SubjectType.INGREDIENT, "oat")


def level(key, on_hand, threshold="0"):
    lv = StockLevel(key, Decimal(threshold))
    lv.set_initial(Decimal(on_hand), actor_id="u", at=T0)
    return lv


LATTE = product("p-latte", track_ingredients=True)
RECIPE = {"p-latte": Recipe("p-latte", (RecipeLine("beans", Decimal("18")), RecipeLine("milk", Decimal("180"))))}
LARGE = ChoiceEffect("large", "scale", None, Decimal("1.5"))
OATMILK = ChoiceEffect("oat", "replace", "oat", Decimal("180"), "milk")
SHOT = ChoiceEffect("shot", "add", "beans", Decimal("9"))


class ShortfallTests(unittest.TestCase):
    def test_same_rule_for_check_and_reservation(self):
        plan = ReservationPlan.for_lines([(LATTE, 1, (LARGE, OATMILK, SHOT))], RECIPE)
        self.assertEqual(dict(plan.quantities), {BEANS: Decimal("36"), OAT: Decimal("270")})
        levels = {BEANS: level(BEANS, "30"), OAT: level(OAT, "500")}
        self.assertEqual(shortfalls(plan, levels), {BEANS: (Decimal("36"), Decimal("30"))})
        with self.assertRaises(InsufficientStock):
            reserve_all(plan, levels, order_id="o", actor_id="u", at=T0)
        self.assertEqual(levels[BEANS].reserved, 0)  # all-or-nothing

    def test_missing_level_counts_as_zero(self):
        plan = ReservationPlan.for_lines([(LATTE, 1, ())], RECIPE)
        self.assertEqual(shortfalls(plan, {BEANS: level(BEANS, "100")}), {MILK: (Decimal("180"), Decimal("0"))})

    def test_low_stock_is_still_available(self):
        lv = level(BEANS, "25", threshold="500")
        self.assertEqual(lv.status().value, "low")
        plan = ReservationPlan.for_lines([(LATTE, 1, (OATMILK,))], RECIPE)
        self.assertNotIn(BEANS, shortfalls(plan, {BEANS: lv, OAT: level(OAT, "1000")}))

    def test_pos_availability_is_choice_aware(self):
        levels = {BEANS: level(BEANS, "100"), MILK: level(MILK, "1000"), OAT: level(OAT, "300")}
        self.assertEqual(pos_availability(LATTE, levels, RECIPE["p-latte"]), 5)  # 100 // 18
        self.assertEqual(pos_availability(LATTE, levels, RECIPE["p-latte"], (LARGE, OATMILK, SHOT)), 1)  # oat 300//270
        self.assertIsNone(pos_availability(product("p-water"), levels, None))
        self.assertEqual(pos_availability(LATTE, levels, None), 0)  # tracks a recipe it does not have


class WasteAndCountTests(unittest.TestCase):
    def test_waste_reason_validated(self):
        lv = level(MILK, "1000")
        mv = lv.waste(Decimal("100"), actor_id="u", at=T0, reason=WasteReason.EXPIRED)
        self.assertEqual((mv.reason, mv.type.value, lv.on_hand), ("expired", "waste", 900))
        with self.assertRaises(ValidationError):
            lv.waste(Decimal("1"), actor_id="u", at=T0, reason="eaten")
        with self.assertRaises(ValidationError):
            lv.waste(Decimal("1"), actor_id="u", at=T0, reason="other")  # needs a note

    def test_count_sets_on_hand_through_correction(self):
        lv = level(MILK, "1000")
        lv.reserve(Decimal("200"), order_id="o", actor_id="u", at=T0)
        self.assertIsNone(lv.count(Decimal("1000"), "count", actor_id="u", at=T0))
        mv = lv.count(Decimal("950"), "count", actor_id="u", at=T0)
        self.assertEqual((mv.type.value, mv.delta_on_hand, lv.on_hand), ("correction", -50, 950))
        with self.assertRaises(StockReserved):
            lv.count(Decimal("150"), "count", actor_id="u", at=T0)


if __name__ == "__main__":
    unittest.main()
