"""Analytics (⚑Analytics, ✱analytics.view; BUSINESS-RULES §16): read-only data from persisted sales
and expenses. The Admin UI aggregates (KPIs, trend, hourly, splits, products, expense categories)
from this feed, so nothing is simulated in the browser.

Sales = completed orders (archived or not) whose ``completed_at`` falls in the range, at their net
value after refunds; fully refunded orders are left out. Line cost comes from the cost snapshot frozen
on the order item at creation (0004: per-unit ingredient use × the unit cost then), so later cost or
recipe changes never rewrite history. Orders created before snapshots existed are ESTIMATED from the
current recipe and costs; lines without any recipe have NO cost data. Each line carries
``cost_source`` (snapshot · estimated · missing) and ``data_quality`` summarises them (36).
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError, validation
from app.domain.errors import ValidationError as DomainValidationError
from app.domain.identity import PermissionKey
from app.domain.recipe import resolve_unit_consumption
from app.models import CategoryRow, ExpenseRow, IngredientRow, OrderRow, ProductRow
from app.repositories.order_repository import OrderRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, feature_on

MAX_DAYS = 400
CHANNEL = {"dine_in": "Dine In", "takeout": "Takeout", "delivery": "Delivery"}
METHOD = {"cash": "Cash", "gcash": "GCash", "card": "Card", "bank_transfer": "Bank Transfer"}


def _day(value: str | None, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise validation(f"{field} must be a date (YYYY-MM-DD)") from exc


def sales_feed(session: Session, actor: Actor, start: str | None, end: str | None) -> dict[str, Any]:
    actor.require(PermissionKey.ANALYTICS_VIEW)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "analytics"):
        raise AppError("FEATURE_DISABLED", 403, "The Analytics feature is off")
    first, last = _day(start, "start"), _day(end, "end")
    if last < first or (last - first).days > MAX_DAYS:
        raise validation(f"end must be on/after start and the range at most {MAX_DAYS} days")
    business = system.business()
    assert business is not None
    tz = ZoneInfo(getattr(business, "timezone", None) or "UTC")
    lo = datetime.combine(first, time.min, tzinfo=tz)
    hi = datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz)

    rows = list(session.scalars(select(OrderRow).where(
        OrderRow.business_id == actor.business_id, OrderRow.status == "completed",
        OrderRow.completed_at >= lo, OrderRow.completed_at < hi).order_by(OrderRow.completed_at)))
    orders = OrderRepository(session).to_domain_many(rows, actor.currency) if rows else []

    product_ids = {i.product_id for o in orders for i in o.items}
    products = {str(p.id): p for p in session.scalars(select(ProductRow).where(
        ProductRow.id.in_([uuid.UUID(p) for p in product_ids])))} if product_ids else {}
    categories = {c.id: c.name for c in session.scalars(select(CategoryRow).where(
        CategoryRow.business_id == actor.business_id))}
    recipes = ProductRepository(session).recipes([p.id for p in products.values()]) if products else {}
    ing_cost = {str(i.id): Decimal(i.unit_cost) for i in session.scalars(select(IngredientRow).where(
        IngredientRow.business_id == actor.business_id))}

    option_effects = ProductRepository(session).option_effects(
        {c.option_id for o in orders for i in o.items for c in i.choices if c.option_id})

    from app.models import OrderItemRow
    snapshots = {str(r.id): (r.cost_snapshot, r.category_name) for r in session.scalars(
        select(OrderItemRow).where(OrderItemRow.order_id.in_([r.id for r in rows])))} if rows else {}
    quality = {"snapshot": 0, "estimated": 0, "missing": 0, "incomplete": 0}

    def line_cost(item) -> tuple[float, str]:  # type: ignore[no-untyped-def]
        snap = (snapshots.get(item.id) or (None, None))[0]
        if snap and snap.get("source") == "recipe" and snap.get("unit_cost") is not None:
            if not snap.get("complete", True):
                quality["incomplete"] += 1
            return float(Decimal(snap["unit_cost"])), "snapshot"
        if snap and snap.get("source") == "none":
            return 0.0, "missing"
        recipe = recipes.get(item.product_id)
        if not recipe:
            return 0.0, "missing"
        return unit_cost(item), "estimated"

    def unit_cost(item) -> float:  # type: ignore[no-untyped-def]
        recipe = recipes.get(item.product_id)
        if not recipe:
            return 0.0
        effects = [e for c in item.choices if c.option_id for e in option_effects.get(c.option_id, ())]
        try:
            used = resolve_unit_consumption(recipe, effects)
        except DomainValidationError:
            used = resolve_unit_consumption(recipe)  # options changed since the sale: base recipe estimate
        return float(sum((ing_cost.get(k, Decimal(0)) * q for k, q in used.items()), Decimal(0)))

    def _line(i):  # type: ignore[no-untyped-def]
        cost, source = line_cost(i)
        quality[source] += 1
        frozen_category = (snapshots.get(i.id) or (None, None))[1]
        category = frozen_category or (categories.get(products[i.product_id].category_id, "Uncategorized")
                                       if i.product_id in products else "Uncategorized")
        return {"product": i.product_name, "code": i.product_code, "category": category,
                "qty": i.quantity, "price": float(i.unit_price.amount), "cost": cost, "cost_source": source}

    sales = []
    for row, order in zip(rows, orders):
        refunded = order.refunded_amount.amount
        net = order.totals.total.amount - refunded
        if net <= 0:
            continue  # fully refunded: not a sale
        completed = [p for p in order.payments if p.status.value == "completed"]
        methods = {p.method.value for p in completed}
        sales.append({
            "id": order.id, "number": order.number, "at": row.completed_at,
            "total": float(net), "refunded": float(refunded),
            "channel": CHANNEL.get(order.order_type.value, order.order_type.value),
            "payment": METHOD.get(next(iter(methods)), next(iter(methods))) if len(methods) == 1 else "Split",
            "lines": [_line(i) for i in order.items],
        })

    expenses = [] if not feature_on(system, actor.business_id, "expenses") else [
        {"date": e.expense_date.isoformat(), "category": e.category, "amount": float(e.amount)}
        for e in session.scalars(select(ExpenseRow).where(
            ExpenseRow.business_id == actor.business_id, ExpenseRow.voided_at.is_(None),
            ExpenseRow.expense_date >= first, ExpenseRow.expense_date <= last))]
    return {"start": first.isoformat(), "end": last.isoformat(), "timezone": str(tz), "sales": sales, "expenses": expenses,
            "data_quality": {**quality, "complete": quality["estimated"] == 0 and quality["missing"] == 0
                             and quality["incomplete"] == 0}}
