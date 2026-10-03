import unittest
from decimal import Decimal

from domain_support import T0, product
from app.domain.errors import InsufficientStock, NegativeStockError, StockReserved, ValidationError
from app.domain.inventory import (
    AdjustmentReason, MovementType, ReservationPlan, StockKey, StockLevel, StockStatus, SubjectType,
    finalize_sale_all, pos_availability, release_all, reserve_all,
)
from app.domain.recipe import Recipe, RecipeLine

CROISSANT = StockKey(SubjectType.PRODUCT, "p-croissant")
BUNDLE = StockKey(SubjectType.PRODUCT, "p-bundle")
BEANS = StockKey(SubjectType.INGREDIENT, "ing-beans")


def level(key, on_hand, threshold="5"):
    lv = StockLevel(key, Decimal(threshold))
    lv.set_initial(Decimal(on_hand), actor_id="u-admin", at=T0)
    return lv


class StockLevelTests(unittest.TestCase):
    def test_reserve_release_sale_movements(self):
        lv = level(CROISSANT, "10")
        mv = lv.reserve(Decimal("3"), order_id="o-1", actor_id="u-1", at=T0)
        self.assertEqual((mv.type, mv.on_hand_after, mv.reserved_after), (MovementType.RESERVATION, 10, 3))
        self.assertEqual(lv.available, 7)
        lv.release(Decimal("1"), order_id="o-1", actor_id="u-1", at=T0)
        mv = lv.sell(Decimal("2"), order_id="o-1", actor_id="u-1", at=T0)
        self.assertEqual((mv.delta_on_hand, mv.delta_reserved), (-2, -2))
        self.assertEqual((lv.on_hand, lv.reserved, lv.available), (8, 0, 8))

    def test_movements_are_immutable(self):
        mv = level(CROISSANT, "5").restock(Decimal("5"), actor_id="u-admin", at=T0)
        with self.assertRaises(Exception):
            mv.delta_on_hand = Decimal("100")  # type: ignore[misc]

    def test_cannot_reserve_more_than_available(self):
        lv = level(CROISSANT, "2")
        lv.reserve(Decimal("2"), order_id="o-1", actor_id=None, at=T0)
        with self.assertRaises(InsufficientStock):
            lv.reserve(Decimal("1"), order_id="o-2", actor_id=None, at=T0)

    def test_negative_stock_prevented_and_never_clamped(self):
        lv = level(CROISSANT, "3")
        with self.assertRaises(NegativeStockError):
            lv.waste(Decimal("4"), actor_id="u-admin", at=T0)
        self.assertEqual(lv.on_hand, 3)
        with self.assertRaises(NegativeStockError):
            lv.release(Decimal("1"), order_id="o-x", actor_id=None, at=T0)

    def test_manual_decrease_below_reserved_rejected(self):
        lv = level(CROISSANT, "5")
        lv.reserve(Decimal("4"), order_id="o-1", actor_id=None, at=T0)
        with self.assertRaises(StockReserved):
            lv.adjust(Decimal("-2"), AdjustmentReason.DAMAGED, actor_id="u-admin", at=T0)
        lv.adjust(Decimal("-1"), AdjustmentReason.DAMAGED, actor_id="u-admin", at=T0)
        self.assertEqual((lv.on_hand, lv.reserved), (4, 4))
        with self.assertRaises(StockReserved):
            StockLevel(CROISSANT, Decimal("1"), on_hand=Decimal("1"), reserved=Decimal("2"))

    def test_units_are_whole_and_initial_is_set_once(self):
        lv = level(CROISSANT, "5")
        with self.assertRaises(ValidationError):
            lv.restock(Decimal("1.5"), actor_id="u", at=T0)
        with self.assertRaises(ValidationError):
            lv.set_initial(Decimal("1"), actor_id="u", at=T0)

    def test_status_is_computed_on_available(self):
        lv = level(CROISSANT, "8", threshold="5")
        self.assertEqual(lv.status(), StockStatus.IN)
        lv.reserve(Decimal("4"), order_id="o", actor_id=None, at=T0)
        self.assertEqual(lv.status(), StockStatus.LOW)
        lv.reserve(Decimal("4"), order_id="o", actor_id=None, at=T0)
        self.assertEqual(lv.status(), StockStatus.OUT)


class ReservationPlanTests(unittest.TestCase):
    def setUp(self):
        self.latte = product("p-latte", track_ingredients=True)
        self.croissant = product("p-croissant", track_units=True)
        self.bundle = product("p-bundle", track_units=True, track_ingredients=True)
        self.recipes = {"p-latte": Recipe("p-latte", (RecipeLine("ing-beans", Decimal("18")),)),
                        "p-bundle": Recipe("p-bundle", (RecipeLine("ing-beans", Decimal("9")),))}

    def test_plan_aggregates_units_and_ingredients(self):
        plan = ReservationPlan.for_lines([(self.latte, 2), (self.croissant, 3), (self.latte, 1)], self.recipes)
        self.assertEqual(dict(plan.quantities), {CROISSANT: Decimal("3"), BEANS: Decimal("54")})
        self.assertEqual(plan.keys, tuple(sorted(plan.keys)))  # deterministic lock order

    def test_all_or_nothing_reservation(self):
        levels = {CROISSANT: level(CROISSANT, "10"), BEANS: level(BEANS, "50")}
        plan = ReservationPlan.for_lines([(self.latte, 3), (self.croissant, 1)], self.recipes)  # needs 54 g
        with self.assertRaises(InsufficientStock) as ctx:
            reserve_all(plan, levels, order_id="o-1", actor_id="u-1", at=T0)
        self.assertIn(BEANS, ctx.exception.shortfalls)
        self.assertEqual((levels[CROISSANT].reserved, levels[BEANS].reserved), (0, 0))

    def test_cancel_restores_and_completion_finalizes(self):
        levels = {CROISSANT: level(CROISSANT, "10"), BEANS: level(BEANS, "100")}
        plan = ReservationPlan.for_lines([(self.latte, 2), (self.croissant, 2)], self.recipes)
        reserve_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        release_all(plan, levels, order_id="o-1", actor_id="u", at=T0)
        self.assertEqual((levels[CROISSANT].available, levels[BEANS].available), (10, 100))
        reserve_all(plan, levels, order_id="o-2", actor_id="u", at=T0)
        movements = finalize_sale_all(plan, levels, order_id="o-2", actor_id="u", at=T0)
        self.assertTrue(all(mv.type is MovementType.SALE for mv in movements))
        self.assertEqual((levels[CROISSANT].on_hand, levels[BEANS].on_hand), (8, 64))

    def test_pos_availability_uses_both_limits(self):
        levels = {BUNDLE: level(BUNDLE, "5"), BEANS: level(BEANS, "27")}
        self.assertEqual(pos_availability(self.bundle, levels, self.recipes["p-bundle"]), 3)  # 27 // 9
        self.assertIsNone(pos_availability(product("p-water"), levels, None))


if __name__ == "__main__":
    unittest.main()


class LossReasonDirectionTests(unittest.TestCase):
    """INV-08: Damaged / Lost adjustments can only decrease stock."""

    def level(self):
        return level(CROISSANT, "10")

    def test_damaged_increase_rejected(self):
        from app.domain.errors import ValidationError
        from app.domain.inventory import AdjustmentReason
        lvl = self.level()
        for reason in (AdjustmentReason.DAMAGED, AdjustmentReason.LOST):
            with self.assertRaises(ValidationError):
                lvl.adjust(Decimal("1"), reason, actor_id="u", at=T0)
        self.assertEqual(lvl.on_hand, Decimal("10"))

    def test_loss_decrease_and_other_increase_allowed(self):
        from app.domain.inventory import AdjustmentReason
        lvl = self.level()
        lvl.adjust(Decimal("-2"), AdjustmentReason.DAMAGED, actor_id="u", at=T0)
        lvl.adjust(Decimal("3"), AdjustmentReason.OTHER, actor_id="u", at=T0, note="found in back room")
        self.assertEqual(lvl.on_hand, Decimal("11"))
