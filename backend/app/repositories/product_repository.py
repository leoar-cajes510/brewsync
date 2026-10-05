"""Catalog persistence: categories, products, choice groups, ingredients, recipes, discounts."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.domain.discount import Discount, DiscountType, Eligibility, IdentificationField
from app.domain.money import Money
from app.domain.product import ChoiceGroup, ChoiceOption, Product, ProductChoiceGroup, SelectionType
from app.domain.recipe import ChoiceEffect, Recipe, RecipeLine
from app.domain.tax import TaxClass
from app.models import (
    CategoryRow, ChoiceGroupRow, ChoiceOptionEffectRow, ChoiceOptionRow, DiscountRow, IngredientRow, ProductChoiceGroupRow, ProductRow,
    RecipeLineRow, RecipeRow,
)


class ProductRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    def add(self, row):  # type: ignore[no-untyped-def]
        self.s.add(row)
        self.s.flush()
        return row

    # --- categories / products ---------------------------------------------------------------------
    def category(self, category_id: uuid.UUID) -> CategoryRow | None:
        return self.s.get(CategoryRow, category_id)

    def categories(self, business_id: uuid.UUID) -> list[CategoryRow]:
        return list(self.s.scalars(select(CategoryRow).where(CategoryRow.business_id == business_id)
                                   .order_by(CategoryRow.sort_order, CategoryRow.name)))

    def product(self, product_id: uuid.UUID) -> ProductRow | None:
        return self.s.get(ProductRow, product_id)

    def code_exists(self, business_id: uuid.UUID, code: str) -> bool:
        """Includes soft-deleted products: their codes stay reserved."""
        return self.s.scalars(select(ProductRow.id).where(ProductRow.business_id == business_id,
                                                          ProductRow.code == code)).first() is not None

    def products(self, business_id: uuid.UUID, ids: Iterable[uuid.UUID] | None = None) -> list[ProductRow]:
        stmt = select(ProductRow).where(ProductRow.business_id == business_id, ProductRow.deleted_at.is_(None))
        if ids is not None:
            stmt = stmt.where(ProductRow.id.in_(list(ids)))
        return list(self.s.scalars(stmt.order_by(ProductRow.name)))

    def group_links(self, product_ids: Iterable[uuid.UUID]) -> list[ProductChoiceGroupRow]:
        return list(self.s.scalars(select(ProductChoiceGroupRow).where(
            ProductChoiceGroupRow.product_id.in_(list(product_ids)))))

    def set_group_links(self, product_id: uuid.UUID, group_ids: list[uuid.UUID]) -> None:
        self.s.execute(delete(ProductChoiceGroupRow).where(ProductChoiceGroupRow.product_id == product_id))
        for index, group_id in enumerate(group_ids):
            self.s.add(ProductChoiceGroupRow(product_id=product_id, group_id=group_id, sort_order=index))
        self.s.flush()

    def to_domain_product(self, row: ProductRow, currency: str,
                          links: list[ProductChoiceGroupRow] | None = None) -> Product:
        links = links if links is not None else self.group_links([row.id])
        return Product(
            id=str(row.id), code=row.code, name=row.name, category_id=str(row.category_id),
            price=Money.of(row.price, currency), tax_class=TaxClass(row.tax_class), description=row.description,
            image_ref=row.image_url, available=row.available, active=row.active, track_units=row.track_units,
            track_ingredients=row.track_ingredients,
            choice_groups=tuple(ProductChoiceGroup(str(row.id), str(l.group_id), l.sort_order)
                                for l in links if l.product_id == row.id),
        )

    # --- choice groups ---------------------------------------------------------------------------------------
    def group(self, group_id: uuid.UUID) -> ChoiceGroupRow | None:
        return self.s.get(ChoiceGroupRow, group_id)

    def groups(self, business_id: uuid.UUID, ids: Iterable[uuid.UUID] | None = None) -> list[ChoiceGroupRow]:
        stmt = select(ChoiceGroupRow).where(ChoiceGroupRow.business_id == business_id)
        if ids is not None:
            stmt = stmt.where(ChoiceGroupRow.id.in_(list(ids)))
        return list(self.s.scalars(stmt.order_by(ChoiceGroupRow.name)))

    def options(self, group_ids: Iterable[uuid.UUID]) -> list[ChoiceOptionRow]:
        return list(self.s.scalars(select(ChoiceOptionRow).where(ChoiceOptionRow.group_id.in_(list(group_ids)))
                                   .order_by(ChoiceOptionRow.sort_order)))

    def to_domain_groups(self, rows: list[ChoiceGroupRow], currency: str) -> dict[str, ChoiceGroup]:
        options = self.options([r.id for r in rows])
        result: dict[str, ChoiceGroup] = {}
        for row in rows:
            opts = tuple(ChoiceOption(str(o.id), str(row.id), o.name, Money.of(o.price_delta, currency),
                                      o.is_default, o.active, o.sort_order) for o in options if o.group_id == row.id)
            result[str(row.id)] = ChoiceGroup(
                id=str(row.id), code=row.code, name=row.name, selection_type=SelectionType(row.selection_type),
                required=row.required, min_select=row.min_select, max_select=row.max_select, options=opts,
                display_name=row.display_name, description=row.description, active=row.active)
        return result

    # --- ingredients & recipes ------------------------------------------------------------------------------------
    def ingredient(self, ingredient_id: uuid.UUID) -> IngredientRow | None:
        return self.s.get(IngredientRow, ingredient_id)

    def ingredients(self, business_id: uuid.UUID) -> list[IngredientRow]:
        return list(self.s.scalars(select(IngredientRow).where(IngredientRow.business_id == business_id)
                                   .order_by(IngredientRow.name)))

    def recipe_row(self, product_id: uuid.UUID) -> RecipeRow | None:
        return self.s.scalars(select(RecipeRow).where(RecipeRow.product_id == product_id)).first()

    def recipes(self, product_ids: Iterable[uuid.UUID]) -> dict[str, Recipe]:
        rows = list(self.s.scalars(select(RecipeRow).where(RecipeRow.product_id.in_(list(product_ids)))))
        lines = list(self.s.scalars(select(RecipeLineRow).where(RecipeLineRow.recipe_id.in_([r.id for r in rows]))))
        return {str(r.product_id): Recipe(str(r.product_id), tuple(
            RecipeLine(str(l.ingredient_id), Decimal(l.quantity)) for l in lines if l.recipe_id == r.id))
            for r in rows}

    def replace_recipe(self, product_id: uuid.UUID, recipe: Recipe, by: uuid.UUID) -> None:
        row = self.recipe_row(product_id)
        if row is None:
            row = self.add(RecipeRow(product_id=product_id, updated_by=by))
        else:
            row.updated_by = by
            self.s.execute(delete(RecipeLineRow).where(RecipeLineRow.recipe_id == row.id))
        for line in recipe.lines:
            self.s.add(RecipeLineRow(recipe_id=row.id, ingredient_id=uuid.UUID(line.ingredient_id),
                                     quantity=line.quantity))
        self.s.flush()

    # --- choice option ingredient effects (R4a.3a) ----------------------------------------------------------
    def option_effects(self, option_ids: Iterable[uuid.UUID | str]) -> dict[str, tuple[ChoiceEffect, ...]]:
        ids = [uuid.UUID(str(o)) for o in option_ids]
        if not ids:
            return {}
        result: dict[str, tuple[ChoiceEffect, ...]] = {}
        for r in self.s.scalars(select(ChoiceOptionEffectRow).where(ChoiceOptionEffectRow.option_id.in_(ids))
                                .order_by(ChoiceOptionEffectRow.option_id, ChoiceOptionEffectRow.sort_order)):
            effect = ChoiceEffect(str(r.option_id), r.mode, str(r.ingredient_id) if r.ingredient_id else None,
                                  Decimal(r.quantity),
                                  str(r.replaces_ingredient_id) if r.replaces_ingredient_id else None)
            result[str(r.option_id)] = result.get(str(r.option_id), ()) + (effect,)
        return result

    def replace_option_effects(self, option_id: uuid.UUID, effects: Iterable[ChoiceEffect]) -> None:
        self.s.execute(delete(ChoiceOptionEffectRow).where(ChoiceOptionEffectRow.option_id == option_id))
        self.s.flush()
        for i, e in enumerate(effects):
            self.s.add(ChoiceOptionEffectRow(
                option_id=option_id, mode=e.mode.value,
                ingredient_id=uuid.UUID(e.ingredient_id) if e.ingredient_id else None,
                replaces_ingredient_id=uuid.UUID(e.replaces_ingredient_id) if e.replaces_ingredient_id else None,
                quantity=e.quantity, sort_order=i))
        self.s.flush()

    # --- discounts ---------------------------------------------------------------------------------------------
    def discount(self, discount_id: uuid.UUID) -> DiscountRow | None:
        return self.s.get(DiscountRow, discount_id)

    def discounts(self, business_id: uuid.UUID) -> list[DiscountRow]:
        return list(self.s.scalars(select(DiscountRow).where(DiscountRow.business_id == business_id)
                                   .order_by(DiscountRow.sort_order, DiscountRow.name)))

    @staticmethod
    def to_domain_discount(row: DiscountRow, currency: str) -> Discount:
        return Discount(
            id=str(row.id), name=row.name, type=DiscountType(row.type), value=Decimal(row.value),
            eligibility=Eligibility(row.eligibility), currency=currency, custom_eligibility=row.custom_eligibility,
            min_order=Money.of(row.min_order, currency) if row.min_order is not None else None,
            max_discount=Money.of(row.max_discount, currency) if row.max_discount is not None else None,
            active=row.active, requires_identification=row.requires_identification,
            identification_fields=frozenset(IdentificationField(f) for f in row.identification_fields or []),
        )
