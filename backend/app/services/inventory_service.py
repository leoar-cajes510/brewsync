"""Stock and ingredient use cases (BUSINESS-RULES §3, §4a). Every change is a movement;
rows are locked in deterministic order; nothing is ever clamped."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.domain.identity import PermissionKey
from app.domain.inventory import AdjustmentReason, StockKey, SubjectType
from app.domain.recipe import Ingredient, IngredientUnit, Recipe
from app.models import IngredientRow, StockLevelRow
from app.repositories.inventory_repository import InventoryRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, feature_on, idempotent, now, parse_uuid
from app.services.product_service import _dec


def level_dto(row: StockLevelRow) -> dict[str, Any]:
    level = InventoryRepository.to_domain(row)
    return {"subject_type": row.subject_type, "subject_id": str(row.subject_id), "on_hand": str(level.on_hand),
            "reserved": str(level.reserved), "available": str(level.available),
            "low_stock_threshold": str(level.low_stock_threshold), "status": level.status().value}


def list_stock(session: Session, actor: Actor, subject_type: SubjectType) -> list[dict[str, Any]]:
    actor.require(PermissionKey.INVENTORY_VIEW if subject_type is SubjectType.PRODUCT else PermissionKey.INGREDIENTS_VIEW)
    return [level_dto(r) for r in InventoryRepository(session).levels(actor.business_id, subject_type)]


def _gate(system: SystemRepository, actor: Actor, subject_type: SubjectType, *, adjust: bool) -> None:
    if subject_type is SubjectType.PRODUCT:
        actor.require(PermissionKey.INVENTORY_ADJUST if adjust else PermissionKey.INVENTORY_RESTOCK)
        feature = "inventory"
    else:
        actor.require(PermissionKey.INGREDIENTS_ADJUST)
        feature = "ingredients"
    if not feature_on(system, actor.business_id, feature):
        raise AppError("FEATURE_DISABLED", 403, f"The {feature} feature is off")


def move_stock(session: Session, actor: Actor, subject_type: SubjectType, subject_id: str, action: str,
               data: dict[str, Any], idempotency_key: str | None) -> tuple[int, dict]:
    """Restock / adjustment / correction / waste (R3.4). Idempotency-Key required."""
    system, inv = SystemRepository(session), InventoryRepository(session)
    _gate(system, actor, subject_type, adjust=action != "restock")
    sid = parse_uuid(subject_id, "stock subject")
    key = StockKey(subject_type, str(sid))

    def run() -> tuple[int, dict]:
        locked = inv.lock_levels(actor.business_id, [key])
        if key not in locked:
            raise not_found("stock level")
        row, level = locked[key]
        at, who, note = now(), str(actor.user_id), data.get("note")
        before_status = level.status().value
        with domain_errors():
            if action == "restock":
                unit_cost = _dec(data["unit_cost"], "unit_cost") if data.get("unit_cost") not in (None, "") else None
                mv = level.restock(_dec(data.get("quantity"), "quantity"), actor_id=who, at=at, unit_cost=unit_cost,
                                   note=note)
            elif action == "adjust":
                try:
                    reason = AdjustmentReason(data.get("reason"))
                except ValueError as exc:
                    raise validation("reason must be damaged, lost or other") from exc
                mv = level.adjust(_dec(data.get("delta"), "delta"), reason, actor_id=who, at=at, note=note)
            elif action == "correct":
                mv = level.correct(_dec(data.get("delta"), "delta"), str(data.get("reason", "")), actor_id=who, at=at,
                                   note=note)
            elif action == "waste":
                mv = level.waste(_dec(data.get("quantity"), "quantity"), actor_id=who, at=at, note=note)
            else:
                raise not_found("stock action")
        inv.save(actor.business_id, row, level, [mv])
        audit(system, actor, actor.business_id, f"stock.{action}", subject_type.value, sid,
              after={"delta_on_hand": str(mv.delta_on_hand), "on_hand_after": str(mv.on_hand_after)})
        emit(system, actor, actor.business_id, "stock.changed", subject_type.value, sid, 1,
             {"available": str(level.available)})
        status = level.status().value
        if status != before_status and status in ("low", "out"):
            emit(system, actor, actor.business_id, f"stock.{status}", subject_type.value, sid, 1, {})
        return 200, level_dto(row)

    return idempotent(session, actor.business_id, f"stock.{action}:{key.subject_type}:{sid}", idempotency_key, data, run)


def create_ingredient(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """Create an ingredient with its stock level; initial stock and threshold are required
    (threshold default source ⚠ OPEN Q-INV-4)."""
    actor.require(PermissionKey.INGREDIENTS_RECIPES)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "ingredients"):
        raise AppError("FEATURE_DISABLED", 403, "The Ingredient Tracking feature is off")
    if "initial_stock" not in data or "low_stock_threshold" not in data:
        raise validation("initial_stock and low_stock_threshold are required")
    try:
        unit = IngredientUnit(data.get("unit"))
    except ValueError as exc:
        raise validation("unit must be g, kg, ml, L or pcs") from exc
    with domain_errors():
        ing = Ingredient(id="new", code=str(data.get("code", "")), name=str(data.get("name", "")), unit=unit,
                         unit_cost=_dec(data.get("unit_cost", "0"), "unit_cost"), category=str(data.get("category", "")))
    row = IngredientRow(business_id=actor.business_id, code=ing.code, name=ing.name.strip(), category=ing.category,
                        unit=ing.unit.value, unit_cost=ing.unit_cost, notes=str(data.get("notes", "")), active=True)
    session.add(row)
    try:
        session.flush()
    except IntegrityError as exc:
        raise AppError("CONFLICT", 409, "Ingredient name or code already exists") from exc
    inv = InventoryRepository(session)
    level_row, level = inv.create_level(actor.business_id, StockKey(SubjectType.INGREDIENT, str(row.id)),
                                        _dec(data["low_stock_threshold"], "threshold"))
    with domain_errors():
        mv = level.set_initial(_dec(data["initial_stock"], "initial_stock"), actor_id=str(actor.user_id), at=now())
    inv.save(actor.business_id, level_row, level, [mv])
    audit(system, actor, actor.business_id, "ingredient.created", "ingredient", row.id)
    return {"id": str(row.id), "code": row.code, "name": row.name, "unit": row.unit, "unit_cost": str(row.unit_cost),
            "stock": level_dto(level_row)}


def set_recipe(session: Session, actor: Actor, product_id: str, lines: list[dict[str, Any]],
               track_ingredients: bool | None = None) -> dict[str, Any]:
    """Replace a product's recipe. Quantities are in each ingredient's own unit (Q-ING-4 open).
    ``track_ingredients`` switches recipe consumption on sales (Q-INV-1/Q-INV-2: reserved at order
    creation, released on cancel, finalized on completion). It needs a recipe with at least one
    line; an empty recipe always switches consumption off so orders cannot fail on it (ING-15)."""
    actor.require(PermissionKey.INGREDIENTS_RECIPES)
    repo = ProductRepository(session)
    pid = parse_uuid(product_id, "product")
    product = repo.product(pid)
    if product is None or product.business_id != actor.business_id:
        raise not_found("product")
    recipe = Recipe(str(pid))
    with domain_errors():
        for line in lines:
            ing_row = repo.ingredient(parse_uuid(line.get("ingredient_id", ""), "ingredient"))
            if ing_row is None or ing_row.business_id != actor.business_id:
                raise not_found("ingredient")
            ingredient = Ingredient(id=str(ing_row.id), code=ing_row.code, name=ing_row.name,
                                    unit=IngredientUnit(ing_row.unit), unit_cost=ing_row.unit_cost,
                                    active=ing_row.active)
            recipe.add_line(ingredient, _dec(line.get("quantity"), "quantity"))
    if track_ingredients and not recipe.lines:
        raise validation("add at least one ingredient before deducting the recipe on sales")
    repo.replace_recipe(pid, recipe, actor.user_id)
    if not recipe.lines:
        product.track_ingredients = False
    elif track_ingredients is not None:
        product.track_ingredients = bool(track_ingredients)
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "recipe.updated", "product", pid,
          after={"lines": len(recipe.lines), "track_ingredients": product.track_ingredients})
    return {"product_id": str(pid), "track_ingredients": product.track_ingredients,
            "lines": [{"ingredient_id": l.ingredient_id, "quantity": str(l.quantity)} for l in recipe.lines]}




def movement_dto(r: Any) -> dict[str, Any]:
    return {"id": str(r.id), "type": r.type, "delta_on_hand": str(r.delta_on_hand), "delta_reserved": str(r.delta_reserved),
            "on_hand_after": str(r.on_hand_after), "reserved_after": str(r.reserved_after), "reason": r.reason,
            "note": r.note, "unit_cost": str(r.unit_cost) if r.unit_cost is not None else None,
            "reference_type": r.reference_type, "reference_id": r.reference_id,
            "actor_id": str(r.actor_id) if r.actor_id else None, "created_at": r.created_at}


def list_movements(session: Session, actor: Actor, subject_type: SubjectType, subject_id: str) -> list[dict[str, Any]]:
    """Newest-first stock movements of one product or ingredient (append-only ledger)."""
    actor.require(PermissionKey.INVENTORY_VIEW if subject_type is SubjectType.PRODUCT else PermissionKey.INGREDIENTS_VIEW)
    sid = parse_uuid(subject_id, "stock subject")
    rows = InventoryRepository(session).movements(actor.business_id, StockKey(subject_type, str(sid)))
    return [movement_dto(r) for r in rows]


def set_threshold(session: Session, actor: Actor, subject_type: SubjectType, subject_id: str,
                  data: dict[str, Any]) -> dict[str, Any]:
    """Change a low-stock threshold (PATCH /inventory/{product_id}); stock quantities are untouched."""
    system, inv = SystemRepository(session), InventoryRepository(session)
    _gate(system, actor, subject_type, adjust=True)
    sid = parse_uuid(subject_id, "stock subject")
    key = StockKey(subject_type, str(sid))
    locked = inv.lock_levels(actor.business_id, [key])
    if key not in locked:
        raise not_found("stock level")
    row, level = locked[key]
    before = str(level.low_stock_threshold)
    with domain_errors():
        level.set_threshold(_dec(data.get("low_stock_threshold"), "low_stock_threshold"))
    row.low_stock_threshold = level.low_stock_threshold
    session.flush()
    audit(system, actor, actor.business_id, "stock.threshold_changed", subject_type.value, sid,
          before={"threshold": before}, after={"threshold": str(level.low_stock_threshold)})
    return level_dto(row)


def ingredient_dto(row: IngredientRow, level: StockLevelRow | None) -> dict[str, Any]:
    return {"id": str(row.id), "code": row.code, "name": row.name, "category": row.category, "unit": row.unit,
            "unit_cost": str(row.unit_cost), "notes": row.notes, "active": row.active,
            "stock": level_dto(level) if level is not None else None}


def list_ingredients(session: Session, actor: Actor) -> list[dict[str, Any]]:
    """Ingredients with their stock level (on_hand, reserved, available, status)."""
    actor.require(PermissionKey.INGREDIENTS_VIEW)
    levels = {r.subject_id: r for r in InventoryRepository(session).levels(actor.business_id, SubjectType.INGREDIENT)}
    return [ingredient_dto(r, levels.get(r.id)) for r in ProductRepository(session).ingredients(actor.business_id)]


def update_ingredient(session: Session, actor: Actor, ingredient_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit ingredient details or (de)activate it. The unit is fixed once created because
    recipe quantities are stored in it (unit conversion ⚠ OPEN Q-ING-4)."""
    actor.require(PermissionKey.INGREDIENTS_RECIPES)
    repo = ProductRepository(session)
    row = repo.ingredient(parse_uuid(ingredient_id, "ingredient"))
    if row is None or row.business_id != actor.business_id:
        raise not_found("ingredient")
    if "unit" in data and data["unit"] != row.unit:
        raise validation("the unit of an existing ingredient cannot be changed")
    with domain_errors():
        ing = Ingredient(id=str(row.id), code=row.code, name=str(data.get("name", row.name)), unit=IngredientUnit(row.unit),
                         unit_cost=_dec(data.get("unit_cost", row.unit_cost), "unit_cost"),
                         category=str(data.get("category", row.category)), notes=str(data.get("notes", row.notes)),
                         active=bool(data.get("active", row.active)))
    row.name, row.unit_cost, row.category = ing.name.strip(), ing.unit_cost, ing.category
    row.notes, row.active = ing.notes, ing.active
    try:
        session.flush()
    except IntegrityError as exc:
        raise AppError("CONFLICT", 409, "Ingredient name already exists") from exc
    audit(SystemRepository(session), actor, actor.business_id, "ingredient.updated", "ingredient", row.id,
          after={"active": row.active, "unit_cost": str(row.unit_cost)})
    levels = {r.subject_id: r for r in InventoryRepository(session).levels(actor.business_id, SubjectType.INGREDIENT)}
    return ingredient_dto(row, levels.get(row.id))


def get_recipe(session: Session, actor: Actor, product_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.INGREDIENTS_VIEW)
    repo = ProductRepository(session)
    pid = parse_uuid(product_id, "product")
    product = repo.product(pid)
    if product is None or product.business_id != actor.business_id:
        raise not_found("product")
    recipe = repo.recipes([pid]).get(str(pid))
    return {"product_id": str(pid), "track_ingredients": product.track_ingredients,
            "lines": [{"ingredient_id": l.ingredient_id, "quantity": str(l.quantity)} for l in (recipe.lines if recipe else ())]}
