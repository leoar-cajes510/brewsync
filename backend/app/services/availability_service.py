"""Ingredient-aware availability and recipe health (BUSINESS-RULES §4, §4a).

One rule, three callers: the POS menu (each product in its default configuration, qty 1), the
quote (the exact cart) and order creation (the exact cart, under row locks). All of them build the
requirement with ``ReservationPlan.for_lines`` (base recipe → SCALE → REPLACE → ADD → quantity)
and compare it with ``available = on_hand − reserved`` via ``inventory.shortfalls``. Availability is
computed at read time; it is never written into ``products.available``.

Stock status vocabulary (kept apart on purpose):
- ``in`` / ``low`` / ``out`` — the ingredient's own level against its low-stock threshold.
  Low stock never makes a product unsellable by itself.
- *insufficient for recipe* — a configuration needs more than is available (a shortfall).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.domain.errors import ValidationError as DomainValidationError
from app.domain.inventory import ReservationPlan, StockKey, StockLevel, SubjectType, shortfalls
from app.domain.product import ChoiceGroup, Product
from app.domain.recipe import ChoiceEffect, EffectMode, Recipe
from app.models import IngredientRow
from app.repositories.inventory_repository import InventoryRepository
from app.repositories.product_repository import ProductRepository

Line = tuple[Product, int, Sequence[ChoiceEffect]]


def qty(value: Decimal) -> str:
    """Quantity for people: 36.000 → "36", 0.500 → "0.5"."""
    text = f"{Decimal(value).normalize():f}"
    return text


class Context:
    """Everything availability needs for one business, loaded once per request."""

    def __init__(self, session: Session, business_id: uuid.UUID, product_ids: Iterable[str] = (),
                 levels: Mapping[StockKey, StockLevel] | None = None) -> None:
        self.session, self.business_id = session, business_id
        repo = ProductRepository(session)
        self.ingredients: dict[str, IngredientRow] = {str(r.id): r for r in repo.ingredients(business_id)}
        if levels is None:
            levels = {StockKey(SubjectType(r.subject_type), str(r.subject_id)): InventoryRepository.to_domain(r)
                      for r in InventoryRepository(session).levels(business_id)}
        self.levels = dict(levels)
        self.recipes: dict[str, Recipe] = repo.recipes([uuid.UUID(p) for p in set(product_ids)])
        self.product_names: dict[str, str] = {}

    def name(self, key: StockKey) -> str:
        if key.subject_type is SubjectType.INGREDIENT:
            row = self.ingredients.get(key.subject_id)
            return row.name if row else "Unknown ingredient"
        return self.product_names.get(key.subject_id, "Product")

    def unit(self, key: StockKey) -> str:
        if key.subject_type is SubjectType.INGREDIENT:
            row = self.ingredients.get(key.subject_id)
            return row.unit if row else ""
        return "pcs"


def config_issues(ctx: Context, lines: Sequence[Line]) -> list[dict[str, Any]]:
    """Broken configuration that would make a sale fail for a reason other than stock (13)."""
    issues: list[dict[str, Any]] = []
    for product, _, effects in lines:
        if not product.track_ingredients:
            continue
        recipe = ctx.recipes.get(product.id)
        if recipe is None or not recipe.lines:
            issues.append({"code": "RECIPE_EMPTY", "product_id": product.id,
                           "message": f"{product.name} deducts a recipe but the recipe has no ingredients"})
            continue
        try:  # only what this configuration actually consumes (a replaced base line is not used)
            used = list(recipe.consumption(1, effects))
        except DomainValidationError as exc:
            issues.append({"code": "RECIPE_INVALID", "product_id": product.id, "message": f"{product.name}: {exc}"})
            continue
        for ingredient_id in used:
            row = ctx.ingredients.get(ingredient_id)
            if row is None:
                issues.append({"code": "INGREDIENT_MISSING", "product_id": product.id,
                               "message": f"{product.name} uses an ingredient that no longer exists"})
            elif not row.active:
                issues.append({"code": "INGREDIENT_INACTIVE", "product_id": product.id,
                               "message": f"{product.name} uses {row.name}, which is inactive"})
            elif StockKey(SubjectType.INGREDIENT, ingredient_id) not in ctx.levels:
                issues.append({"code": "STOCK_LEVEL_MISSING", "product_id": product.id,
                               "message": f"{row.name} has no stock record"})
    return issues


def _shortfall_dto(ctx: Context, key: StockKey, required: Decimal, available: Decimal) -> dict[str, Any]:
    name, unit = ctx.name(key), ctx.unit(key)
    if key.subject_type is SubjectType.PRODUCT:
        message = f"{name}: {qty(required)} needed, {qty(available)} in stock"
    else:
        message = f"{name}: {qty(required)} {unit} needed, {qty(available)} {unit} available"
    return {"subject_type": key.subject_type.value, "subject_id": key.subject_id, "name": name, "unit": unit,
            "required": qty(required), "available": qty(available), "message": message}


def assess(ctx: Context, lines: Sequence[Line]) -> dict[str, Any]:
    """Availability of an exact set of lines (a cart, or one configuration)."""
    for product, _, _ in lines:
        ctx.product_names[product.id] = product.name
    issues = config_issues(ctx, lines)
    line_dtos: list[dict[str, Any]] = []
    try:
        plan = ReservationPlan.for_lines(lines, ctx.recipes)
    except DomainValidationError as exc:
        return {"ok": False, "issues": issues or [{"code": "RECIPE_INVALID", "product_id": None, "message": str(exc)}],
                "shortfalls": [], "lines": [], "requirements": []}
    short = shortfalls(plan, ctx.levels)
    blocked_products = {i["product_id"] for i in issues}
    for index, (product, quantity, effects) in enumerate(lines):
        try:
            own = ReservationPlan.for_lines([(product, quantity, effects)], ctx.recipes).quantities
        except DomainValidationError:
            own = {}
        reasons = [_shortfall_dto(ctx, k, *short[k])["message"] for k in own if k in short]
        reasons += [i["message"] for i in issues if i["product_id"] == product.id]
        line_dtos.append({"index": index, "product_id": product.id, "product_name": product.name,
                          "available": not reasons, "reasons": reasons})
    requirements = [{"subject_type": k.subject_type.value, "subject_id": k.subject_id, "name": ctx.name(k),
                     "unit": ctx.unit(k), "required": qty(v),
                     "available": qty(ctx.levels[k].available) if k in ctx.levels else "0",
                     "status": ctx.levels[k].status().value if k in ctx.levels else "out"}
                    for k, v in plan.quantities.items()]
    return {"ok": not short and not issues, "issues": issues,
            "shortfalls": [_shortfall_dto(ctx, k, r, a) for k, (r, a) in short.items()],
            "lines": line_dtos, "requirements": requirements}


def cost_snapshot(ctx: Context, product: Product, effects: Sequence[ChoiceEffect]) -> dict[str, Any]:
    """Per-unit ingredient use and the unit cost in force now, frozen on the order item (16, 25)."""
    recipe = ctx.recipes.get(product.id)
    if recipe is None or not recipe.lines:
        return {"source": "none", "unit_cost": None, "lines": []}
    try:
        used = recipe.consumption(1, effects)
    except DomainValidationError:
        used = recipe.consumption(1)
    lines, total, complete = [], Decimal("0"), True
    for ingredient_id, quantity in used.items():
        row = ctx.ingredients.get(ingredient_id)
        cost = Decimal(row.unit_cost) if row is not None else None
        if cost is None or cost == 0:
            complete = False
        total += (cost or Decimal("0")) * quantity
        lines.append({"ingredient_id": ingredient_id, "name": row.name if row else None, "unit": row.unit if row else None,
                      "quantity": str(quantity), "unit_cost": str(cost) if cost is not None else None})
    return {"source": "recipe", "unit_cost": str(total.quantize(Decimal("0.0001"))), "complete": complete, "lines": lines}


def raise_if_unavailable(result: dict[str, Any]) -> None:
    """Order creation: refuse with a message the POS can show as-is."""
    if result["issues"]:
        messages = [i["message"] for i in result["issues"]]
        raise AppError("RECIPE_INVALID", 409, "Cannot sell this item: " + "; ".join(messages) +
                       ". Ask an Admin to fix the recipe.", {"issues": result["issues"]})
    if result["shortfalls"]:
        raise AppError("INSUFFICIENT_STOCK", 409, "Not enough stock: " +
                       "; ".join(s["message"] for s in result["shortfalls"]),
                       {"shortfalls": {f"{s['subject_type']}:{s['subject_id']}": s["required"] for s in result["shortfalls"]},
                        "items": result["shortfalls"], "lines": result["lines"]})


def default_effects(product: Product, groups: Mapping[str, ChoiceGroup],
                    effects: Mapping[str, tuple[ChoiceEffect, ...]]) -> tuple[ChoiceEffect, ...]:
    """Effects of the options the POS preselects (active defaults of linked active groups)."""
    result: list[ChoiceEffect] = []
    for group_id in product.linked_group_ids:
        group = groups.get(group_id)
        if group is None or not group.active:
            continue
        for option in group.options:
            if option.is_default and option.active:
                result.extend(effects.get(option.id, ()))
    return tuple(result)


def menu_availability(session: Session, business_id: uuid.UUID, products: Sequence[Product],
                      groups: Mapping[str, ChoiceGroup]) -> dict[str, dict[str, Any]]:
    """Per product, default configuration, quantity 1: sellable? and why not."""
    tracked = [p for p in products if p.tracks_stock]
    if not tracked:
        return {}
    ctx = Context(session, business_id, [p.id for p in tracked])
    repo = ProductRepository(session)
    effects = repo.option_effects(o.id for g in groups.values() for o in g.options if o.is_default)
    result: dict[str, dict[str, Any]] = {}
    for product in tracked:
        try:
            line_effects = default_effects(product, groups, effects)
            assessed = assess(ctx, [(product, 1, line_effects)])
        except DomainValidationError as exc:  # e.g. two default options both scale
            assessed = {"ok": False, "issues": [{"code": "RECIPE_INVALID", "product_id": product.id, "message": str(exc)}],
                        "shortfalls": [], "lines": [], "requirements": []}
        reasons = [s["message"] for s in assessed["shortfalls"]] + [i["message"] for i in assessed["issues"]]
        low = [r["name"] for r in assessed["requirements"] if r["status"] == "low"]
        result[product.id] = {"sellable": assessed["ok"], "reasons": reasons, "low_stock": low}
    return result


def dependencies(session: Session, business_id: uuid.UUID, ingredient_id: str) -> dict[str, Any]:
    """Active products that consume an ingredient through their recipe or a choice effect (8, 31)."""
    from sqlalchemy import select

    from app.models import ChoiceOptionEffectRow, ChoiceOptionRow, ProductChoiceGroupRow, ProductRow, RecipeLineRow, RecipeRow
    iid = uuid.UUID(ingredient_id)
    recipe_products = set(session.scalars(select(RecipeRow.product_id).join(RecipeLineRow, RecipeLineRow.recipe_id == RecipeRow.id)
                                          .where(RecipeLineRow.ingredient_id == iid)))
    option_rows = list(session.execute(
        select(ChoiceOptionRow.id, ChoiceOptionRow.name, ChoiceOptionRow.group_id)
        .join(ChoiceOptionEffectRow, ChoiceOptionEffectRow.option_id == ChoiceOptionRow.id)
        .where((ChoiceOptionEffectRow.ingredient_id == iid) | (ChoiceOptionEffectRow.replaces_ingredient_id == iid))))
    group_ids = {r.group_id for r in option_rows}
    choice_products = set(session.scalars(select(ProductChoiceGroupRow.product_id)
                                          .where(ProductChoiceGroupRow.group_id.in_(group_ids)))) if group_ids else set()
    rows = list(session.scalars(select(ProductRow).where(
        ProductRow.business_id == business_id, ProductRow.deleted_at.is_(None),
        ProductRow.id.in_(recipe_products | choice_products)).order_by(ProductRow.name))) if (recipe_products | choice_products) else []
    products = [{"id": str(r.id), "name": r.name, "active": r.active, "track_ingredients": r.track_ingredients,
                 "via": "recipe" if r.id in recipe_products else "choice"} for r in rows]
    active = [p for p in products if p["active"] and p["track_ingredients"]]
    return {"ingredient_id": ingredient_id, "products": products, "active_count": len(active),
            "options": [{"id": str(r.id), "name": r.name} for r in option_rows]}


def recipe_health(session: Session, business_id: uuid.UUID, currency: str) -> list[dict[str, Any]]:
    """Admin-facing list of configuration problems, found before a cashier hits them (13)."""
    repo = ProductRepository(session)
    rows = [r for r in repo.products(business_id) if r.active]
    links = repo.group_links([r.id for r in rows])
    products = [repo.to_domain_product(r, currency, links) for r in rows]
    groups = repo.to_domain_groups(repo.groups(business_id, {l.group_id for l in links}), currency)
    effects = repo.option_effects(o.id for g in groups.values() for o in g.options)
    ctx = Context(session, business_id, [p.id for p in products])
    issues: list[dict[str, Any]] = []
    for product in products:
        if not product.track_ingredients:
            continue
        found = config_issues(ctx, [(product, 1, ())])
        recipe = ctx.recipes.get(product.id)
        base = {l.ingredient_id for l in recipe.lines} if recipe else set()
        for group_id in product.linked_group_ids:
            group = groups.get(group_id)
            if group is None or not group.active:
                continue
            scaling = [o for o in group.options if o.active and any(e.mode is EffectMode.SCALE for e in effects.get(o.id, ()))]
            for option in (o for o in group.options if o.active):
                for effect in effects.get(option.id, ()):
                    label = f"{product.name} · {group.label} → {option.name}"
                    if effect.ingredient_id:
                        row = ctx.ingredients.get(effect.ingredient_id)
                        if row is None or not row.active:
                            found.append({"code": "INGREDIENT_INACTIVE", "product_id": product.id,
                                          "message": f"{label} uses {row.name if row else 'a missing ingredient'}, which is not active"})
                    if effect.mode is EffectMode.REPLACE and effect.replaces_ingredient_id not in base:
                        target = ctx.ingredients.get(str(effect.replaces_ingredient_id))
                        found.append({"code": "REPLACE_TARGET_NOT_IN_RECIPE", "product_id": product.id,
                                      "message": f"{label} replaces {target.name if target else 'an ingredient'}, "
                                                 f"which is not in the {product.name} recipe (the option has no effect)"})
            if group.selection_type.value == "multi" and len(scaling) > 1:
                found.append({"code": "SCALE_CONFLICT", "product_id": product.id,
                              "message": f"{product.name} · {group.label}: several options scale the recipe and can be "
                                         "selected together (such orders are refused)"})
        scaling_groups = [g for g in (groups.get(gid) for gid in product.linked_group_ids) if g is not None and g.active
                          and any(e.mode is EffectMode.SCALE for o in g.options if o.active for e in effects.get(o.id, ()))]
        if len(scaling_groups) > 1:
            found.append({"code": "SCALE_CONFLICT", "product_id": product.id,
                          "message": f"{product.name}: options in {', '.join(g.label for g in scaling_groups)} all scale "
                                     "the recipe; choosing more than one scaling option is refused"})
        for ingredient_id in base:
            row = ctx.ingredients.get(ingredient_id)
            if row is not None and Decimal(row.unit_cost) == 0:
                found.append({"code": "COST_MISSING", "product_id": product.id, "severity": "warning",
                              "message": f"{row.name} has no unit cost, so {product.name} margins are incomplete"})
        for issue in found:
            issue.setdefault("severity", "error")
            issue["product_name"] = product.name
        issues.extend(found)
    return issues


def dependency_map(session: Session, business_id: uuid.UUID) -> dict[str, list[str]]:
    """ingredient id → names of active, recipe-deducting products that can consume it (one pass)."""
    from sqlalchemy import select

    from app.models import ChoiceOptionEffectRow, ChoiceOptionRow, ProductChoiceGroupRow, ProductRow, RecipeLineRow, RecipeRow
    products = {r.id: r.name for r in session.scalars(select(ProductRow).where(
        ProductRow.business_id == business_id, ProductRow.deleted_at.is_(None), ProductRow.active.is_(True),
        ProductRow.track_ingredients.is_(True)))}
    if not products:
        return {}
    result: dict[str, set[str]] = {}
    for pid, iid in session.execute(select(RecipeRow.product_id, RecipeLineRow.ingredient_id)
                                    .join(RecipeLineRow, RecipeLineRow.recipe_id == RecipeRow.id)
                                    .where(RecipeRow.product_id.in_(list(products)))):
        result.setdefault(str(iid), set()).add(products[pid])
    group_products: dict[uuid.UUID, set[uuid.UUID]] = {}
    for pid, gid in session.execute(select(ProductChoiceGroupRow.product_id, ProductChoiceGroupRow.group_id)
                                    .where(ProductChoiceGroupRow.product_id.in_(list(products)))):
        group_products.setdefault(gid, set()).add(pid)
    if group_products:
        for gid, iid in session.execute(select(ChoiceOptionRow.group_id, ChoiceOptionEffectRow.ingredient_id)
                                        .join(ChoiceOptionEffectRow, ChoiceOptionEffectRow.option_id == ChoiceOptionRow.id)
                                        .where(ChoiceOptionRow.group_id.in_(list(group_products)),
                                               ChoiceOptionRow.active.is_(True),
                                               ChoiceOptionEffectRow.ingredient_id.is_not(None))):
            for pid in group_products.get(gid, ()):
                result.setdefault(str(iid), set()).add(products[pid])
    return {k: sorted(v) for k, v in result.items()}
