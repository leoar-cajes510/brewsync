"""Ingredients and recipes (BUSINESS-RULES §4a).

Not modelled because they are ⚠ OPEN: unit conversion (Q-ING-4 — recipe quantities
are in the ingredient's own unit), costing method (Q-ING-3), option ingredient
modifiers (Q-ING-2).
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum

from .errors import ValidationError
from .money import UNIT_COST_PLACES, to_quantity


class IngredientUnit(StrEnum):
    GRAM = "g"
    KILOGRAM = "kg"
    MILLILITRE = "ml"
    LITRE = "L"
    PIECE = "pcs"


@dataclass(slots=True)
class Ingredient:
    id: str
    code: str
    name: str
    unit: IngredientUnit
    unit_cost: Decimal
    category: str = ""
    notes: str = ""
    active: bool = True

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValidationError("ingredient name is required")
        self.unit_cost = to_quantity(self.unit_cost, UNIT_COST_PLACES, "unit_cost")
        if self.unit_cost < 0:
            raise ValidationError("unit_cost must be ≥ 0")


@dataclass(frozen=True, slots=True)
class RecipeLine:
    """Ingredient quantity consumed for ONE unit of the product, in the ingredient's unit."""

    ingredient_id: str
    quantity: Decimal

    def __post_init__(self) -> None:
        quantity = to_quantity(self.quantity)
        if quantity <= 0:
            raise ValidationError("recipe line quantity must be > 0")
        object.__setattr__(self, "quantity", quantity)


@dataclass(slots=True)
class Recipe:
    product_id: str
    lines: tuple[RecipeLine, ...] = ()

    def __post_init__(self) -> None:
        ids = [line.ingredient_id for line in self.lines]
        if len(ids) != len(set(ids)):
            raise ValidationError("an ingredient appears once per recipe")

    def add_line(self, ingredient: Ingredient, quantity: Decimal) -> None:
        if not ingredient.active:
            raise ValidationError(f"ingredient {ingredient.name} is inactive")
        if any(line.ingredient_id == ingredient.id for line in self.lines):
            raise ValidationError(f"ingredient {ingredient.name} is already in the recipe")
        self.lines = self.lines + (RecipeLine(ingredient.id, quantity),)

    def remove_line(self, ingredient_id: str) -> None:
        self.lines = tuple(line for line in self.lines if line.ingredient_id != ingredient_id)

    def consumption(self, units_sold: int) -> dict[str, Decimal]:
        """Ingredient quantities for ``units_sold`` units (R4a.3, base recipe only)."""
        if units_sold <= 0:
            raise ValidationError("units sold must be > 0")
        return {line.ingredient_id: line.quantity * units_sold for line in self.lines}
