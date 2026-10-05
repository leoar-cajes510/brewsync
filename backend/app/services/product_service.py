"""Catalog use cases: categories, products (+ unit stock row), choice groups, discounts."""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.domain.discount import Discount, DiscountType, Eligibility, IdentificationField
from app.domain.identity import PermissionKey, RoleKey
from app.domain.inventory import StockKey, SubjectType
from app.domain.money import Money
from app.domain.product import (
    Category, ChoiceGroup, ChoiceOption, Product, SelectionType, generate_product_code, normalize_product_code,
)
from app.domain.recipe import ChoiceEffect, EffectMode, validate_option_effects
from app.domain.tax import TaxClass
from app.models import CategoryRow, ChoiceGroupRow, ChoiceOptionRow, DiscountRow, ProductRow
from app.repositories.inventory_repository import InventoryRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, feature_on, flag, now, objects, parse_uuid, text


def _dec(value: Any, field: str) -> Decimal:
    if isinstance(value, float) or isinstance(value, bool):
        raise validation(f"{field} must be a decimal string or integer, not a float")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise validation(f"{field} is not a number") from exc


def _flush(session: Session, message: str) -> None:
    try:
        session.flush()
    except IntegrityError as exc:
        raise AppError("CONFLICT", 409, message) from exc


# --- categories ----------------------------------------------------------------------------------------------
def category_dto(r: CategoryRow) -> dict[str, Any]:
    return {"id": str(r.id), "name": r.name, "code_prefix": r.code_prefix, "sort_order": r.sort_order,
            "active": r.active}


def list_categories(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.PRODUCTS_VIEW)
    return [category_dto(r) for r in ProductRepository(session).categories(actor.business_id)]


def _ensure_unique_category_name(session: Session, actor: Actor, name: str, exclude: uuid.UUID | None = None) -> None:
    """Category names are unique per business ignoring case (CAT-04): "coffee" duplicates "Coffee".
    Checked in the service; the DB constraint is case-sensitive (no migration, see report)."""
    from sqlalchemy import func, select
    stmt = select(CategoryRow.id).where(CategoryRow.business_id == actor.business_id,
                                        func.lower(CategoryRow.name) == name.strip().lower())
    if exclude is not None:
        stmt = stmt.where(CategoryRow.id != exclude)
    if session.scalar(stmt.limit(1)) is not None:
        raise AppError("CONFLICT", 409, "A category with this name already exists")


def create_category(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    actor.require(PermissionKey.PRODUCTS_EDIT)
    with domain_errors():
        cat = Category(id="new", name=text(data.get("name", ""), "name"), code_prefix=text(data.get("code_prefix"), "code_prefix"),
                       sort_order=int(data.get("sort_order", 0)))
    _ensure_unique_category_name(session, actor, cat.name)
    row = CategoryRow(business_id=actor.business_id, name=cat.name, code_prefix=cat.code_prefix,
                      sort_order=cat.sort_order, active=True)
    session.add(row)
    _flush(session, "Category name or code prefix already exists")
    audit(SystemRepository(session), actor, actor.business_id, "category.created", "category", row.id)
    return category_dto(row)


# --- products -------------------------------------------------------------------------------------------------
def product_dto(row: ProductRow, group_ids: list[str] | None = None) -> dict[str, Any]:
    return {"id": str(row.id), "code": row.code, "name": row.name, "description": row.description,
            "category_id": str(row.category_id), "price": str(row.price), "image_url": row.image_url,
            "available": row.available, "active": row.active, "track_units": row.track_units,
            "track_ingredients": row.track_ingredients, "tax_class": row.tax_class,
            "choice_group_ids": group_ids or [], "updated_at": row.updated_at}


def list_products(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.PRODUCTS_VIEW)
    repo = ProductRepository(session)
    rows = repo.products(actor.business_id)
    links = repo.group_links([r.id for r in rows])
    return [product_dto(r, [str(l.group_id) for l in links if l.product_id == r.id]) for r in rows]


def _next_product_code(session: Session, actor: Actor, category: CategoryRow) -> str:
    """Next ``PREFIX-NNN`` from the category's row-locked counter (``product:<category_id>``).
    Numbers are never reused; one already taken (e.g. a legacy manual code) is skipped."""
    system, repo = SystemRepository(session), ProductRepository(session)
    while True:
        code = generate_product_code(category.code_prefix, system.next_value(actor.business_id,
                                                                             f"product:{category.id}"))
        if not repo.code_exists(actor.business_id, code):
            return code


def create_product(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """Create a product. With ``track_units`` an initial stock and a low-stock threshold are
    required (the threshold default source is ⚠ OPEN Q-INV-4, so none is assumed)."""
    actor.require(PermissionKey.PRODUCTS_CREATE)
    repo, system = ProductRepository(session), SystemRepository(session)
    category_id = parse_uuid(data.get("category_id", ""), "category")
    category = repo.category(category_id)
    if category is None or category.business_id != actor.business_id:
        raise not_found("category")
    try:
        tax_class = TaxClass(data.get("tax_class"))
    except ValueError as exc:
        raise validation("tax_class must be 'taxable' or 'non_taxable' (no default is assumed)") from exc
    group_ids = [parse_uuid(g, "choice group") for g in data.get("choice_group_ids", [])]
    with domain_errors():
        # The server generates the code (PREFIX-NNN, one counter per category). An explicit
        # ``code`` is still accepted for API backward compatibility; the UI never sends one.
        supplied = text(data.get("code"), "code").strip()
        code = normalize_product_code(supplied) if supplied else _next_product_code(session, actor, category)
        product = Product(id="new", code=code, name=text(data.get("name", ""), "name"),
                          category_id=str(category_id), price=Money.of(_dec(data.get("price"), "price"), actor.currency),
                          tax_class=tax_class, description=text(data.get("description", ""), "description"),
                          image_ref=None, available=flag(data.get("available"), "available", True),
                          active=True, track_units=flag(data.get("track_units"), "track_units", False),
                          track_ingredients=flag(data.get("track_ingredients"), "track_ingredients", False))
    row = ProductRow(business_id=actor.business_id, code=product.code, name=product.name,
                     description=product.description, category_id=category_id, price=product.price.amount,
                     image_url=product.image_ref, available=product.available, active=True,
                     track_units=product.track_units, track_ingredients=product.track_ingredients,
                     tax_class=product.tax_class.value)
    session.add(row)
    _flush(session, "Product code already exists")
    for gid in group_ids:
        group = repo.group(gid)
        if group is None or group.business_id != actor.business_id:
            raise not_found("choice group")
    repo.set_group_links(row.id, group_ids)
    if product.track_units:
        if "initial_stock" not in data or "low_stock_threshold" not in data:
            raise validation("track_units requires initial_stock and low_stock_threshold")
        inv = InventoryRepository(session)
        key = StockKey(SubjectType.PRODUCT, str(row.id))
        level_row, level = inv.create_level(actor.business_id, key, _dec(data["low_stock_threshold"], "threshold"))
        with domain_errors():
            movement = level.set_initial(_dec(data["initial_stock"], "initial_stock"), actor_id=str(actor.user_id),
                                         at=now())
        inv.save(actor.business_id, level_row, level, [movement])
    audit(system, actor, actor.business_id, "product.created", "product", row.id,
          after={"price": str(row.price), "tax_class": row.tax_class})
    return product_dto(row, [str(g) for g in group_ids])


def update_product(session: Session, actor: Actor, product_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit price, taxability, availability, name. Affects new orders only (snapshots, R0.5)."""
    actor.require(PermissionKey.PRODUCTS_EDIT)
    repo = ProductRepository(session)
    row = repo.product(parse_uuid(product_id, "product"), lock=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("product")
    before = product_dto(row)
    if "code" in data and text(data["code"], "code").strip().upper() != row.code:
        raise validation("product code cannot be changed after creation")
    if "price" in data:
        with domain_errors():
            row.price = Money.of(_dec(data["price"], "price"), actor.currency).require_non_negative("price").amount
    if "tax_class" in data:
        try:
            row.tax_class = TaxClass(data["tax_class"]).value
        except ValueError as exc:
            raise validation("invalid tax_class") from exc
    for key in ("available", "active"):
        if key in data:
            setattr(row, key, flag(data[key], key, getattr(row, key)))
    if "name" in data:
        if not text(data["name"], "name").strip():
            raise validation("name is required")
        row.name = text(data["name"], "name").strip()
    if "description" in data:
        row.description = text(data["description"], "description").strip()
    if "category_id" in data:
        category_id = parse_uuid(data["category_id"], "category")
        category = repo.category(category_id)
        if category is None or category.business_id != actor.business_id:
            raise not_found("category")
        row.category_id = category_id
    if "choice_group_ids" in data:
        repo.set_group_links(row.id, [parse_uuid(g, "choice group") for g in data["choice_group_ids"]])
    row.updated_at = now()
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "product.updated", "product", row.id,
          before={k: before[k] for k in ("name", "price", "tax_class", "available", "active", "category_id")},
          after={k: product_dto(row)[k] for k in ("name", "price", "tax_class", "available", "active", "category_id")})
    return product_dto(row)


# --- choice groups -------------------------------------------------------------------------------------------------
def _option_effects_in(session: Session, actor: Actor, option: dict[str, Any], option_id: uuid.UUID,
                       gated: list[bool], stored: tuple[ChoiceEffect, ...] = ()) -> tuple[ChoiceEffect, ...] | None:
    """Parse an option's ``effects`` (R4a.3a). A missing key leaves stored effects unchanged and
    ``[]`` clears them. Editing effects changes recipe consumption, so it needs the recipe permission
    and the Ingredient Tracking feature (R4a.7). Every ingredient must belong to this business; an
    inactive one is accepted only in an effect that is already stored unchanged (like recipes, R4a.5),
    so deactivating an ingredient never blocks unrelated edits of the group."""
    if "effects" not in option:
        return None
    if not gated:
        actor.require(PermissionKey.INGREDIENTS_RECIPES)
        if not feature_on(SystemRepository(session), actor.business_id, "ingredients"):
            raise AppError("FEATURE_DISABLED", 403, "The Ingredient Tracking feature is off")
        gated.append(True)
    repo = ProductRepository(session)

    inactive: list[str] = []

    def ingredient_id(value: Any, field: str) -> str:
        row = repo.ingredient(parse_uuid(value or "", field))
        if row is None or row.business_id != actor.business_id:
            raise not_found("ingredient")
        if not row.active:
            inactive.append(row.name)
        return str(row.id)

    effects = []
    for e in objects(option["effects"], "effects"):
        mode = e.get("mode")
        if mode not in {m.value for m in EffectMode}:
            raise validation("effect mode must be scale, add or replace")
        if mode == EffectMode.SCALE.value:  # factor for the whole base recipe; never names an ingredient
            if e.get("ingredient_id") or e.get("replaces_ingredient_id"):
                raise validation("a SCALE effect multiplies the whole base recipe and takes no ingredient")
            with domain_errors():
                effects.append(ChoiceEffect(str(option_id), EffectMode.SCALE, None, _dec(e.get("quantity"), "quantity")))
            continue
        if mode == EffectMode.ADD.value and e.get("replaces_ingredient_id"):
            raise validation("an ADD effect cannot replace an ingredient")
        if mode == EffectMode.REPLACE.value and not e.get("replaces_ingredient_id"):
            raise validation("a REPLACE effect needs the base ingredient it replaces")
        inactive.clear()
        replaces = ingredient_id(e.get("replaces_ingredient_id"), "replaced ingredient") if mode == "replace" else None
        with domain_errors():
            effect = ChoiceEffect(str(option_id), EffectMode(mode), ingredient_id(e.get("ingredient_id"), "ingredient"),
                                  _dec(e.get("quantity"), "quantity"), replaces)
        if inactive and effect not in stored:
            raise validation(f"ingredient {inactive[0]} is inactive")
        effects.append(effect)
    with domain_errors():
        return validate_option_effects(effects)


def _effect_dto(e: ChoiceEffect) -> dict[str, Any]:
    return {"mode": e.mode.value, "ingredient_id": e.ingredient_id, "replaces_ingredient_id": e.replaces_ingredient_id,
            "quantity": str(e.quantity)}


def _effect_warnings(repo: ProductRepository, actor: Actor, groups: dict[str, Any],
                     effects: dict[str, tuple[ChoiceEffect, ...]]) -> dict[str, list[str]]:
    """Per option: linked products that track ingredients but whose base recipe lacks an ingredient
    a REPLACE effect would replace, so the effect is ignored for them (R4a.3a). Advisory only: a
    group is shared by many products, so this cannot be a hard validation."""
    replacing = {oid: {e.replaces_ingredient_id for e in effs if e.mode is EffectMode.REPLACE}
                 for oid, effs in effects.items()}
    if not any(replacing.values()):
        return {}
    products = {p.id: p for p in repo.products(actor.business_id) if p.deleted_at is None and p.track_ingredients}
    links = [l for l in repo.group_links(list(products)) if str(l.group_id) in groups]
    recipes = repo.recipes(list(products))
    warnings: dict[str, list[str]] = {}
    for link in links:
        product = products[link.product_id]
        recipe = recipes.get(str(product.id))
        base = {line.ingredient_id for line in (recipe.lines if recipe else ())}
        for o in groups[str(link.group_id)].options:
            if (replacing.get(o.id) or set()) - base:
                warnings.setdefault(o.id, []).append(product.name)
    return warnings


def create_choice_group(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    actor.require(PermissionKey.CHOICES_MANAGE)
    group_id = uuid.uuid4()
    options_in = objects(data.get("options"), "options")
    with domain_errors():
        options = tuple(ChoiceOption(str(uuid.uuid4()), str(group_id), text(o.get("name", ""), "options.name"),
                                     Money.of(_dec(o.get("price_delta", "0"), "price_delta"), actor.currency),
                                     flag(o.get("is_default"), "is_default", False), True, i) for i, o in enumerate(options_in))
        group = ChoiceGroup(id=str(group_id), code=text(data.get("code", ""), "code"), name=text(data.get("name", ""), "name"),
                            selection_type=SelectionType(data.get("selection_type", "")),
                            required=flag(data.get("required"), "required"), min_select=int(data.get("min_select", 0)),
                            max_select=int(data.get("max_select", 1)), options=options,
                            display_name=text(data.get("display_name", ""), "display_name"), description=text(data.get("description", ""), "description"))
    gated: list[bool] = []
    effects_in = [_option_effects_in(session, actor, raw, uuid.UUID(o.id), gated) for raw, o in zip(options_in, options)]
    session.add(ChoiceGroupRow(id=group_id, business_id=actor.business_id, code=group.code, name=group.name,
                               display_name=group.display_name, description=group.description,
                               selection_type=group.selection_type.value, required=group.required,
                               min_select=group.min_select, max_select=group.max_select, active=True))
    _flush(session, "Choice group code already exists")
    for o in options:
        session.add(ChoiceOptionRow(id=uuid.UUID(o.id), group_id=group_id, name=o.name,
                                    price_delta=o.price_delta.amount, is_default=o.is_default, active=True,
                                    sort_order=o.sort_order))
    session.flush()
    repo = ProductRepository(session)
    for o, effs in zip(options, effects_in):
        if effs:
            repo.replace_option_effects(uuid.UUID(o.id), effs)
    audit(SystemRepository(session), actor, actor.business_id, "choice_group.created", "choice_group", group_id)
    return {"id": str(group_id), "code": group.code, "name": group.name, "selection_type": group.selection_type.value,
            "required": group.required, "min_select": group.min_select, "max_select": group.max_select,
            "options": [{"id": o.id, "name": o.name, "price_delta": str(o.price_delta.amount),
                         "effects": [_effect_dto(e) for e in effs or ()]} for o, effs in zip(options, effects_in)]}


def list_choice_groups(session: Session, actor: Actor, detail: bool = True) -> list[dict[str, Any]]:
    """``detail`` adds per-option ``effect_warnings`` (Admin); the POS menu skips that work."""
    actor.require(PermissionKey.CHOICES_VIEW)
    repo = ProductRepository(session)
    groups = repo.to_domain_groups(repo.groups(actor.business_id), actor.currency)
    effects = repo.option_effects(o.id for g in groups.values() for o in g.options)
    warnings = _effect_warnings(repo, actor, groups, effects) if detail else {}
    return [{"id": g.id, "code": g.code, "name": g.name, "display_name": g.display_name, "description": g.description,
             "selection_type": g.selection_type.value, "required": g.required, "min_select": g.min_select,
             "max_select": g.max_select, "active": g.active,
             "options": [{"id": o.id, "name": o.name, "price_delta": str(o.price_delta.amount), "active": o.active,
                          "is_default": o.is_default, "effects": [_effect_dto(e) for e in effects.get(o.id, ())],
                          "effect_warnings": warnings.get(o.id, [])} for o in g.options]} for g in groups.values()]


# --- discounts --------------------------------------------------------------------------------------------------------
def discount_dto(r: DiscountRow) -> dict[str, Any]:
    return {"id": str(r.id), "name": r.name, "type": r.type, "value": str(r.value), "eligibility": r.eligibility,
            "custom_eligibility": r.custom_eligibility, "min_order": str(r.min_order) if r.min_order is not None else None,
            "max_discount": str(r.max_discount) if r.max_discount is not None else None, "active": r.active,
            "requires_identification": r.requires_identification, "identification_fields": r.identification_fields}


def create_discount(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    actor.require(PermissionKey.SETTINGS_DISCOUNTS)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "discounts"):
        raise AppError("FEATURE_DISABLED", 403, "The Discounts feature is off")
    money = lambda key: Money.of(_dec(data[key], key), actor.currency) if data.get(key) not in (None, "") else None  # noqa: E731
    with domain_errors():
        discount = Discount(
            id="new", name=text(data.get("name", ""), "name"), type=DiscountType(data.get("type")), value=_dec(data.get("value"), "value"),
            eligibility=Eligibility(data.get("eligibility", "all")), currency=actor.currency,
            custom_eligibility=text(data.get("custom_eligibility", ""), "custom_eligibility"), min_order=money("min_order"),
            max_discount=money("max_discount"), requires_identification=flag(data.get("requires_identification"), "requires_identification", False),
            identification_fields=frozenset(IdentificationField(f) for f in data.get("identification_fields", [])))
    row = DiscountRow(business_id=actor.business_id, name=discount.name, type=discount.type.value, value=discount.value,
                      eligibility=discount.eligibility.value, custom_eligibility=discount.custom_eligibility,
                      min_order=discount.min_order.amount if discount.min_order else None,
                      max_discount=discount.max_discount.amount if discount.max_discount else None, active=True,
                      requires_identification=discount.requires_identification,
                      identification_fields=sorted(f.value for f in discount.identification_fields))
    session.add(row)
    _flush(session, "Discount name already exists")
    audit(system, actor, actor.business_id, "discount.created", "discount", row.id)
    return discount_dto(row)


def list_discounts(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.POS_VIEW)
    return [discount_dto(r) for r in ProductRepository(session).discounts(actor.business_id)]


def update_category(session: Session, actor: Actor, category_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Rename, reorder or (de)activate a category (API §3 PATCH /categories/{id})."""
    actor.require(PermissionKey.PRODUCTS_EDIT)
    row = ProductRepository(session).category(parse_uuid(category_id, "category"))
    if row is None or row.business_id != actor.business_id:
        raise not_found("category")
    before = category_dto(row)
    if "code_prefix" in data and text(data["code_prefix"], "code_prefix").strip().upper() != row.code_prefix:
        raise validation("code prefix cannot be changed after the category is created")
    with domain_errors():
        cat = Category(id=str(row.id), name=text(data.get("name", row.name), "name"), code_prefix=row.code_prefix,
                       sort_order=int(data.get("sort_order", row.sort_order)), active=flag(data.get("active"), "active", row.active))
    if cat.name.strip().lower() != row.name.strip().lower():
        _ensure_unique_category_name(session, actor, cat.name, exclude=row.id)
    row.name, row.sort_order, row.active = cat.name, cat.sort_order, cat.active
    _flush(session, "Category name already exists")
    audit(SystemRepository(session), actor, actor.business_id, "category.updated", "category", row.id,
          before=before, after=category_dto(row))
    return category_dto(row)


def delete_category(session: Session, actor: Actor, category_id: str) -> dict[str, Any]:
    """DELETE /categories/{id} (Q-DEL-1), Admin only: permanent, and only for a category that never held a
    product (soft-deleted ones included) and never issued a product code, so codes are never reused. Nothing
    else is touched: products are never reassigned and the FK (ON DELETE RESTRICT) backs this check up."""
    from sqlalchemy import func, select

    from app.models import SequenceRow

    actor.require(PermissionKey.PRODUCTS_DELETE)
    if actor.role is not RoleKey.ADMIN:
        raise AppError("PERMISSION_DENIED", 403, "Only an Admin can delete categories")
    cid = parse_uuid(category_id, "category")
    row = session.get(CategoryRow, cid, with_for_update=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("category")
    products = session.scalar(select(func.count()).select_from(ProductRow).where(ProductRow.category_id == cid)) or 0
    if products:
        noun = "product" if products == 1 else "products"
        raise AppError("CONFLICT", 409,
                       f"This category has {products} {noun} and cannot be deleted. Move or delete them first.")
    counter = session.get(SequenceRow, (actor.business_id, f"product:{cid}"), with_for_update=True)
    if counter is not None and counter.next_value > 1:
        raise AppError("CONFLICT", 409, "Product codes were already issued from this category.")
    if counter is not None:
        session.delete(counter)
    name, prefix = row.name, row.code_prefix
    session.delete(row)
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "category.deleted", "category", cid,
          before={"name": name, "code_prefix": prefix})
    return {"id": str(cid), "deleted": True}


def _group_audit_state(repo: ProductRepository, row: Any, options: list[Any]) -> dict[str, Any]:
    """Before/after of a choice group for the audit trail: prices and ingredient effects (29)."""
    effects = repo.option_effects(o.id for o in options)
    return {"name": row.name, "active": row.active, "required": row.required,
            "options": [{"id": str(o.id), "name": o.name, "price_delta": f"{Decimal(o.price_delta):.2f}", "active": o.active,
                         "effects": [_effect_dto(e) for e in effects.get(str(o.id), ())]} for o in options]}


def update_choice_group(session: Session, actor: Actor, group_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit a choice group and its options (API §3 PATCH /choice-groups/{id}).

    ``options`` (optional) is the full desired list: entries with an ``id`` update that option,
    entries without one create a new option, and existing options left out are deactivated —
    never deleted, because past orders reference them (Q-DEL-1). The group is re-validated by
    the domain (selection rules R2.3) before anything is written.
    """
    actor.require(PermissionKey.CHOICES_MANAGE)
    repo = ProductRepository(session)
    gid = parse_uuid(group_id, "choice group")
    row = repo.group(gid, lock=True)  # serialise concurrent edits of one group
    if row is None or row.business_id != actor.business_id:
        raise not_found("choice group")
    existing = {o.id: o for o in repo.options([gid])}
    audit_before = _group_audit_state(repo, row, list(existing.values()))
    options_in = objects(data.get("options"), "options") if data.get("options") is not None else None
    planned: list[tuple[ChoiceOptionRow | None, dict[str, Any]]] = []
    if options_in is not None:
        seen: set[uuid.UUID] = set()
        for o in options_in:
            oid = parse_uuid(o["id"], "option") if o.get("id") else None
            if oid is not None and oid not in existing:
                raise not_found("choice option")
            if oid is not None:
                seen.add(oid)
            planned.append((existing.get(oid) if oid else None, o))
        for oid, orow in existing.items():
            if oid not in seen:
                planned.append((orow, {"active": False}))
    else:
        planned = [(orow, {}) for orow in existing.values()]

    new_ids: dict[int, uuid.UUID] = {}
    with domain_errors():
        options = []
        for i, (orow, o) in enumerate(planned):
            oid = orow.id if orow is not None else new_ids.setdefault(i, uuid.uuid4())
            options.append(ChoiceOption(
                str(oid), str(gid), text(o.get("name", orow.name if orow else ""), "options.name"),
                Money.of(_dec(o.get("price_delta", orow.price_delta if orow else "0"), "price_delta"), actor.currency),
                flag(o.get("is_default"), "is_default", orow.is_default if orow else False),
                flag(o.get("active"), "active", orow.active if orow else True),
                int(o.get("sort_order", i))))
        group = ChoiceGroup(
            id=str(gid), code=row.code, name=text(data.get("name", row.name), "name"),
            selection_type=SelectionType(data.get("selection_type", row.selection_type)),
            required=flag(data.get("required"), "required", row.required), min_select=int(data.get("min_select", row.min_select)),
            max_select=int(data.get("max_select", row.max_select)), options=tuple(options),
            display_name=text(data.get("display_name", row.display_name), "display_name"),
            description=text(data.get("description", row.description), "description"), active=flag(data.get("active"), "active", row.active))
    row.name, row.display_name, row.description = group.name, group.display_name, group.description
    row.selection_type, row.required = group.selection_type.value, group.required
    row.min_select, row.max_select, row.active = group.min_select, group.max_select, group.active
    gated: list[bool] = []
    stored = repo.option_effects(existing)
    effects_in = [_option_effects_in(session, actor, o, uuid.UUID(opt.id), gated, stored.get(opt.id, ()))
                  for (_, o), opt in zip(planned, options)]
    for (orow, _), opt in zip(planned, options):
        if orow is None:
            session.add(ChoiceOptionRow(id=uuid.UUID(opt.id), group_id=gid, name=opt.name,
                                        price_delta=opt.price_delta.amount, is_default=opt.is_default,
                                        active=opt.active, sort_order=opt.sort_order))
        else:
            orow.name, orow.price_delta, orow.is_default = opt.name, opt.price_delta.amount, opt.is_default
            orow.active, orow.sort_order = opt.active, opt.sort_order
    session.flush()
    for opt, effs in zip(options, effects_in):
        if effs is not None:
            repo.replace_option_effects(uuid.UUID(opt.id), effs)
    audit(SystemRepository(session), actor, actor.business_id, "choice_group.updated", "choice_group", gid,
          before=audit_before, after=_group_audit_state(repo, row, repo.options([gid])))
    return next(g for g in list_choice_groups(session, actor) if g["id"] == str(gid))


def delete_product(session: Session, actor: Actor, product_id: str) -> dict[str, Any]:
    """DELETE /products/{id} (Q-DEL-1): hard delete only if the product was never sold, reserved or
    in a stock movement; otherwise 409 CONFLICT and the product must be deactivated instead. Its own
    configuration (choice-group links, recipe, empty stock level) goes with it; codes are never reused."""
    from sqlalchemy import delete, exists, select

    from app.models import OrderItemRow, ProductChoiceGroupRow, RecipeRow, StockLevelRow, StockMovementRow

    actor.require(PermissionKey.PRODUCTS_DELETE)
    pid = parse_uuid(product_id, "product")
    row = session.get(ProductRow, pid, with_for_update=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("product")
    sold = session.scalar(select(exists().where(OrderItemRow.product_id == pid)))
    moved = session.scalar(select(exists().where(StockMovementRow.subject_type == SubjectType.PRODUCT.value,
                                                 StockMovementRow.subject_id == pid)))
    held = session.scalar(select(exists().where(StockLevelRow.subject_type == SubjectType.PRODUCT.value,
                                                StockLevelRow.subject_id == pid,
                                                (StockLevelRow.on_hand != 0) | (StockLevelRow.reserved != 0))))
    if sold or moved or held:
        raise AppError("CONFLICT", 409, "This product has sales or stock history and cannot be deleted. Deactivate it instead.")
    session.execute(delete(ProductChoiceGroupRow).where(ProductChoiceGroupRow.product_id == pid))
    session.execute(delete(RecipeRow).where(RecipeRow.product_id == pid))  # recipe lines cascade
    session.execute(delete(StockLevelRow).where(StockLevelRow.subject_type == SubjectType.PRODUCT.value,
                                                StockLevelRow.subject_id == pid))
    code, name = row.code, row.name
    session.delete(row)
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "product.deleted", "product", pid,
          before={"code": code, "name": name})
    return {"id": str(pid), "deleted": True}


def update_discount(session: Session, actor: Actor, discount_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """PATCH /discounts/{id} (✱settings.discounts ⚑Discounts). Orders keep their own discount
    snapshot, so editing never rewrites history. Fields not sent keep their current value."""
    actor.require(PermissionKey.SETTINGS_DISCOUNTS)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "discounts"):
        raise AppError("FEATURE_DISABLED", 403, "The Discounts feature is off")
    row = session.get(DiscountRow, parse_uuid(discount_id, "discount"), with_for_update=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("discount")
    before = discount_dto(row)
    merged = {**before, **{k: v for k, v in data.items() if k in before and k != "id"}}
    money = lambda key: Money.of(_dec(merged[key], key), actor.currency) if merged.get(key) not in (None, "") else None  # noqa: E731
    with domain_errors():
        d = Discount(
            id=str(row.id), name=text(merged.get("name"), "name"), type=DiscountType(merged.get("type")),
            value=_dec(merged.get("value"), "value"), eligibility=Eligibility(merged.get("eligibility", "all")),
            currency=actor.currency, custom_eligibility=text(merged.get("custom_eligibility"), "custom_eligibility"),
            min_order=money("min_order"), max_discount=money("max_discount"), active=flag(merged.get("active"), "active", True),
            requires_identification=flag(merged.get("requires_identification"), "requires_identification", False),
            identification_fields=frozenset(IdentificationField(f) for f in merged.get("identification_fields") or []))
    row.name, row.type, row.value, row.eligibility = d.name, d.type.value, d.value, d.eligibility.value
    row.custom_eligibility = d.custom_eligibility
    row.min_order = d.min_order.amount if d.min_order else None
    row.max_discount = d.max_discount.amount if d.max_discount else None
    row.active, row.requires_identification = d.active, d.requires_identification
    row.identification_fields = sorted(f.value for f in d.identification_fields)
    _flush(session, "Discount name already exists")
    audit(system, actor, actor.business_id, "discount.updated", "discount", row.id, before=before, after=discount_dto(row))
    return discount_dto(row)


def set_discount_active(session: Session, actor: Actor, discount_id: str, active: bool) -> dict[str, Any]:
    """POST /discounts/{id}/activate|deactivate: an inactive discount is no longer offered at the POS."""
    return update_discount(session, actor, discount_id, {"active": active})
