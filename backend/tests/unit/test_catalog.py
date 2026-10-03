import unittest
from decimal import Decimal

from domain_support import m, milk_group, product
from app.domain.cart import Cart
from app.domain.errors import InvalidChoiceSelection, ValidationError
from app.domain.order import OrderItem
from app.domain.product import ChoiceGroup, ChoiceOption, SelectionType
from app.domain.recipe import Ingredient, IngredientUnit, Recipe, RecipeLine
from app.domain.tax import TaxClass


def extras_group(required=False, min_select=0, max_select=2):
    return ChoiceGroup(id="g-extra", code="EXTRA", name="Extras", selection_type=SelectionType.MULTI,
                       required=required, min_select=min_select, max_select=max_select,
                       options=(ChoiceOption("o-shot", "g-extra", "Extra Shot", m("30.00")),
                                ChoiceOption("o-syrup", "g-extra", "Vanilla Syrup", m("20.00")),
                                ChoiceOption("o-cream", "g-extra", "Whipped Cream", m("15.00"))))


class ChoiceValidationTests(unittest.TestCase):
    def setUp(self):
        self.groups = {"g-milk": milk_group(), "g-extra": extras_group()}
        self.latte = product(groups=("g-milk", "g-extra"))

    def test_valid_single_and_multi_selection(self):
        chosen = self.latte.resolve_selections(self.groups, {"g-milk": ["o-oat"], "g-extra": ["o-shot", "o-syrup"]})
        self.assertEqual([o.name for _, o in chosen], ["Oat Milk", "Extra Shot", "Vanilla Syrup"])

    def test_required_single_group_must_be_chosen(self):
        with self.assertRaises(InvalidChoiceSelection):
            self.latte.resolve_selections(self.groups, {"g-extra": []})

    def test_single_group_rejects_two_options(self):
        with self.assertRaises(InvalidChoiceSelection):
            self.latte.resolve_selections(self.groups, {"g-milk": ["o-oat", "o-regular"]})

    def test_multi_max_duplicates_and_inactive_rejected(self):
        with self.assertRaises(InvalidChoiceSelection):
            self.latte.resolve_selections(self.groups, {"g-milk": ["o-oat"], "g-extra": ["o-shot", "o-syrup", "o-cream"]})
        with self.assertRaises(InvalidChoiceSelection):
            self.latte.resolve_selections(self.groups, {"g-milk": ["o-oat"], "g-extra": ["o-shot", "o-shot"]})
        with self.assertRaises(InvalidChoiceSelection):
            self.latte.resolve_selections(self.groups, {"g-milk": ["o-old"]})

    def test_required_multi_needs_at_least_one(self):
        group = extras_group(required=True, min_select=0)
        with self.assertRaises(InvalidChoiceSelection):
            group.validate_selection([])
        self.assertEqual(len(group.validate_selection(["o-cream"])), 1)

    def test_group_not_linked_to_product_rejected(self):
        with self.assertRaises(InvalidChoiceSelection):
            product().resolve_selections(self.groups, {"g-milk": ["o-oat"]})

    def test_invalid_definitions(self):
        with self.assertRaises(ValidationError):
            extras_group(min_select=3, max_select=2)
        with self.assertRaises(Exception):
            ChoiceOption("o-x", "g", "Bad", m("-1.00"))


class SnapshotTests(unittest.TestCase):
    def test_order_item_freezes_sale_time_values(self):
        groups = {"g-milk": milk_group()}
        latte = product(price="120.00", groups=("g-milk",), tax_class=TaxClass.NON_TAXABLE)
        item = OrderItem.from_product("i-1", latte, latte.resolve_selections(groups, {"g-milk": ["o-oat"]}), 2)
        self.assertEqual(item.unit_price, m("145.00"))
        self.assertEqual(item.line_total, m("290.00"))
        self.assertEqual(item.tax_class, TaxClass.NON_TAXABLE)
        self.assertEqual((item.choices[0].group_name, item.choices[0].option_name), ("Milk", "Oat Milk"))
        latte.price = m("999.00")  # later catalog edits do not change history
        latte.name = "Renamed"
        self.assertEqual((item.product_name, item.unit_price), ("Item p-latte", m("145.00")))

    def test_unsellable_product_or_bad_quantity(self):
        p = product()
        p.available = False
        with self.assertRaises(ValidationError):
            OrderItem.from_product("i-1", p, (), 1)
        with self.assertRaises(ValidationError):
            OrderItem.from_product("i-1", product(), (), 0)

    def test_stock_flags_either_both_neither(self):
        self.assertFalse(product().tracks_stock)
        both = product(track_units=True, track_ingredients=True)
        self.assertTrue(both.track_units and both.track_ingredients)


class CartTests(unittest.TestCase):
    def setUp(self):
        self.groups = {"g-milk": milk_group()}
        self.latte = product(groups=("g-milk",))
        self.cart = Cart("PHP")

    def test_different_choices_stay_distinct_same_choices_merge(self):
        self.cart.add(self.latte, self.groups, {"g-milk": ["o-regular"]})
        self.cart.add(self.latte, self.groups, {"g-milk": ["o-oat"]})
        self.cart.add(self.latte, self.groups, {"g-milk": ["o-oat"]}, 2)
        self.assertEqual([line.quantity for line in self.cart.lines], [1, 3])
        self.assertEqual(self.cart.subtotal(), m("555.00"))  # 120 + 3 × 145

    def test_increase_decrease_remove_clear(self):
        self.cart.add(self.latte, self.groups, {"g-milk": ["o-regular"]}, 2)
        self.cart.increase(0)
        self.assertEqual(self.cart.lines[0].quantity, 3)
        self.cart.decrease(0, 2)
        self.assertEqual(self.cart.lines[0].quantity, 1)
        self.cart.decrease(0)
        self.assertTrue(self.cart.is_empty)
        self.cart.add(self.latte, self.groups, {"g-milk": ["o-regular"]})
        self.cart.clear()
        self.assertEqual(self.cart.subtotal(), m("0.00"))
        with self.assertRaises(ValidationError):
            self.cart.add(self.latte, self.groups, {"g-milk": ["o-regular"]}, 0)


class RecipeTests(unittest.TestCase):
    def test_consumption_and_validation(self):
        beans = Ingredient("ing-beans", "BEANS", "Espresso Beans", IngredientUnit.GRAM, Decimal("1.2500"))
        milk = Ingredient("ing-milk", "MILK", "Fresh Milk", IngredientUnit.MILLILITRE, Decimal("0.0900"))
        recipe = Recipe("p-latte")
        recipe.add_line(beans, Decimal("18"))
        recipe.add_line(milk, Decimal("180.5"))
        self.assertEqual(recipe.consumption(2), {"ing-beans": Decimal("36"), "ing-milk": Decimal("361.0")})
        with self.assertRaises(ValidationError):
            recipe.add_line(beans, Decimal("1"))
        with self.assertRaises(ValidationError):
            RecipeLine("ing-x", Decimal("-5"))
        with self.assertRaises(ValidationError):
            RecipeLine("ing-x", Decimal("0.0001"))
        beans.active = False
        with self.assertRaises(ValidationError):
            Recipe("p-2").add_line(beans, Decimal("1"))


if __name__ == "__main__":
    unittest.main()
