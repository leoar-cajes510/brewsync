"""Ingredients and recipes (BUSINESS-RULES §4a).

Choice-option ingredient effects (Q-ING-2, DECIDED): an option may SCALE the base recipe, ADD an
ingredient or REPLACE a base-recipe ingredient (R4a.3a). Not modelled because they are ⚠ OPEN: unit conversion (Q-ING-4 —
recipe and effect quantities are in the ingredient's own unit), costing method (Q-ING-3).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

from .errors import ValidationError
from .money import INGREDIENT_QUANTITY_PLACES, UNIT_COST_PLACES, to_quantity


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

    def consumption(self, units_sold: int, effects: Iterable[ChoiceEffect] = ()) -> dict[str, Decimal]:
        """Ingredient quantities for ``units_sold`` units: base recipe + choice effects (R4a.3)."""
        if units_sold <= 0:
            raise ValidationError("units sold must be > 0")
        return {ingredient_id: quantity * units_sold
                for ingredient_id, quantity in resolve_unit_consumption(self, effects).items()}


class EffectMode(StrEnum):
    ADD = "add"
    REPLACE = "replace"
    SCALE = "scale"


MAX_SCALE_FACTOR = Decimal("10")


def _round_quantity(value: Decimal) -> Decimal:
    """Scaled quantities are stored with the stock precision (3 dp, half-up)."""
    return value.quantize(Decimal(1).scaleb(-INGREDIENT_QUANTITY_PLACES), rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class ChoiceEffect:
    """What one selected choice option does to ONE unit of a product's recipe (R4a.3a).

    SCALE: multiply every BASE recipe line by ``quantity`` (the factor, e.g. 1.5 for Large); no
    ingredient. It never adds an ingredient.
    ADD: consume ``quantity`` more of ``ingredient_id`` (not scaled).
    REPLACE: if ``replaces_ingredient_id`` is in the BASE recipe, drop that line and consume
    ``quantity`` × scale factor of ``ingredient_id`` instead; otherwise the effect does nothing.
    """

    option_id: str
    mode: EffectMode
    ingredient_id: str | None
    quantity: Decimal
    replaces_ingredient_id: str | None = None

    def __post_init__(self) -> None:
        try:
            object.__setattr__(self, "mode", EffectMode(self.mode))
        except ValueError as exc:
            raise ValidationError("effect mode must be scale, add or replace") from exc
        quantity = to_quantity(self.quantity)
        if quantity <= 0:
            raise ValidationError("effect quantity must be > 0")
        object.__setattr__(self, "quantity", quantity)
        if self.mode is EffectMode.SCALE:
            if self.ingredient_id is not None or self.replaces_ingredient_id is not None:
                raise ValidationError("a SCALE effect multiplies the whole base recipe and takes no ingredient")
            if quantity > MAX_SCALE_FACTOR:
                raise ValidationError(f"scale factor must be at most {MAX_SCALE_FACTOR}")
            return
        if not self.ingredient_id:
            raise ValidationError("an ADD or REPLACE effect needs an ingredient")
        if self.mode is EffectMode.ADD and self.replaces_ingredient_id is not None:
            raise ValidationError("an ADD effect cannot replace an ingredient")
        if self.mode is EffectMode.REPLACE:
            if not self.replaces_ingredient_id:
                raise ValidationError("a REPLACE effect needs the ingredient it replaces")
            if self.replaces_ingredient_id == self.ingredient_id:
                raise ValidationError("an ingredient cannot replace itself")


def validate_option_effects(effects: Iterable[ChoiceEffect]) -> tuple[ChoiceEffect, ...]:
    """One option's effect list: at most one SCALE, each ingredient used once, and each base
    ingredient replaced at most once."""
    effects = tuple(effects)
    if sum(1 for e in effects if e.mode is EffectMode.SCALE) > 1:
        raise ValidationError("an option can have only one scale factor")
    used = [e.ingredient_id for e in effects if e.mode is not EffectMode.SCALE]
    if len(used) != len(set(used)):
        raise ValidationError("an ingredient appears once per option's effects")
    replaced = [e.replaces_ingredient_id for e in effects if e.mode is EffectMode.REPLACE]
    if len(replaced) != len(set(replaced)):
        raise ValidationError("an option can replace the same ingredient only once")
    return effects


def resolve_unit_consumption(recipe: Recipe | None, effects: Iterable[ChoiceEffect] = ()) -> dict[str, Decimal]:
    """The single consumption rule for ONE unit (R4a.3a), shared by reservations and costing.

    1. Start from the base recipe.
    2. SCALE: multiply every base line by the selected option's factor (e.g. Large 1.5×). Only one
       selected option may scale — two would be ambiguous and are refused.
    3. REPLACE: only when the replaced ingredient is a BASE recipe line — that line is removed
       and the replacement quantity × the scale factor is consumed instead. A REPLACE whose source
       is not in the base recipe is ignored entirely (nothing is added).
    4. ADD: consume the extra quantity (not scaled).
    Quantities for the same ingredient are summed; scaled results are rounded to 3 dp. Two
    selected options replacing the same base ingredient are refused, since neither can be preferred.
    """
    effects = tuple(effects)
    scales = [e for e in effects if e.mode is EffectMode.SCALE]
    if len(scales) > 1:
        raise ValidationError("two selected options scale the same recipe")
    factor = scales[0].quantity if scales else Decimal("1")
    base = {line.ingredient_id: _round_quantity(line.quantity * factor) for line in (recipe.lines if recipe else ())}
    replaces = [e for e in effects if e.mode is EffectMode.REPLACE and e.replaces_ingredient_id in base]
    sources = [e.replaces_ingredient_id for e in replaces]
    if len(sources) != len(set(sources)):
        raise ValidationError("two selected options replace the same recipe ingredient")
    result = {k: v for k, v in base.items() if k not in set(sources)}
    for effect in replaces:
        key = str(effect.ingredient_id)
        result[key] = result.get(key, Decimal("0")) + _round_quantity(effect.quantity * factor)
    for effect in (e for e in effects if e.mode is EffectMode.ADD):
        key = str(effect.ingredient_id)
        result[key] = result.get(key, Decimal("0")) + effect.quantity
    return result
