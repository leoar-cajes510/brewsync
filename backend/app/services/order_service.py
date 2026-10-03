"""Order use cases (Q-ORD-1, Q-INV-2; BUSINESS-RULES §1, §2, §9, §11).

Order creation: server re-prices from stored data, reserves stock all-or-nothing under row
locks (deterministic order), assigns the order number and writes the outbox event — one
transaction. There is no checkout concept: payment is a separate use case.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.domain.discount import IdentificationDetails, OrderDiscount
from app.domain.identity import PermissionKey
from app.domain.inventory import ReservationPlan, finalize_sale_all, release_all, reserve_all
from app.domain.order import Attribution, Order, OrderItem, OrderOrigin, OrderStatus, OrderType
from app.domain.pricing import PriceCalculator, PricingLine
from app.repositories.document_repository import DocumentRepository
from app.repositories.inventory_repository import InventoryRepository
from app.repositories.order_repository import OrderRepository
from app.repositories.product_repository import ProductRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, feature_on, idempotent, now, parse_uuid, section
from app.services.document_service import document_dto
from app.services.settings_service import tax_settings


def order_dto(order: Order) -> dict[str, Any]:
    t = order.totals
    return {
        "id": order.id, "number": order.number, "origin": order.origin.value, "order_type": order.order_type.value,
        "tag": order.tag, "note": order.note, "status": order.status.value,
        "payment_status": order.payment_status.value, "refund_status": order.refund_status.value,
        "version": order.version, "created_at": order.created_at, "completed_at": order.completed_at,
        "cancelled_at": order.cancelled_at, "cancel_reason": order.cancel_reason,
        "archived_at": order.archived_at, "archived_by": order.archived_by,
        "cashier_id": order.attribution.cashier_id,
        "archive_reason": order.archive_reason,
        "items": [{"id": i.id, "product_id": i.product_id, "product_name": i.product_name, "quantity": i.quantity,
                   "unit_price": str(i.unit_price.amount), "line_total": str(i.line_total.amount),
                   "tax_class": i.tax_class.value,
                   "discount_allocation": str(i.discount_allocation.amount) if i.discount_allocation else "0.00",
                   "choices": [{"group": c.group_name, "option": c.option_name, "price_delta": str(c.price_delta.amount)}
                               for c in i.choices]} for i in order.items],
        # Identification values are never returned in list/detail payloads (masked; ⚖ VR-7).
        "discount": {"name": order.discount.name, "amount": str(order.discount.amount.amount),
                     "identification_captured": order.discount.identification is not None,
                     "id_number_masked": order.discount.identification.masked_id_number
                     if order.discount.identification else None} if order.discount else None,
        "totals": {"subtotal": str(t.subtotal.amount), "discount_total": str(t.discount_total.amount),
                   "net_amount": str(t.net_amount.amount), "tax_amount": str(t.tax_amount.amount),
                   "total": str(t.total.amount),
                   "tax_breakdown": [{"tax_class": e.tax_class.value, "taxable_amount": str(e.taxable_amount.amount),
                                      "tax_amount": str(e.tax_amount.amount)} for e in t.tax_breakdown]},
        "amount_due": str(order.remaining_balance.amount),
        "payments": [{"id": p.id, "method": p.method.value, "amount": str(p.amount.amount), "status": p.status.value,
                      "tendered": str(p.tendered.amount) if p.tendered else None,
                      "change_given": str(p.change_given.amount) if p.change_given else None,
                      "rounding_adjustment": str(p.rounding_adjustment.amount) if p.rounding_adjustment else "0.00",
                      "reference": p.reference} for p in order.payments],
        "refunds": [{"id": r.id, "kind": r.kind.value, "amount": str(r.amount.amount), "reason": r.reason}
                    for r in order.refunds],
    }


def _merge_lines(lines: list[dict[str, Any]]) -> list[tuple[uuid.UUID, dict[str, list[str]], int]]:
    """Identical lines (same product + same option set) merge (R2.5)."""
    merged: dict[tuple, tuple[uuid.UUID, dict[str, list[str]], int]] = {}
    for line in lines:
        pid = parse_uuid(line.get("product_id", ""), "product")
        qty = line.get("quantity")
        if isinstance(qty, bool) or not isinstance(qty, int) or qty <= 0:
            raise validation("quantity must be a positive integer")
        selections = {str(g): [str(o) for o in opts] for g, opts in (line.get("selections") or {}).items()}
        key = (pid, frozenset((g, o) for g, opts in selections.items() for o in opts))
        if key in merged:
            merged[key] = (pid, selections, merged[key][2] + qty)
        else:
            merged[key] = (pid, selections, qty)
    return list(merged.values())


def _price_order(session: Session, actor: Actor, data: dict[str, Any]):  # type: ignore[no-untyped-def]
    system, catalog = SystemRepository(session), ProductRepository(session)
    raw_lines = data.get("lines") or []
    if not raw_lines:
        raise AppError("EMPTY_CART", 400, "An order needs at least one line")
    merged = _merge_lines(raw_lines)
    product_rows = {r.id: r for r in catalog.products(actor.business_id, [pid for pid, _, _ in merged])}
    links = catalog.group_links(product_rows)
    groups = catalog.to_domain_groups(catalog.groups(actor.business_id, {l.group_id for l in links}), actor.currency)
    items, lines_for_plan = [], []
    with domain_errors():
        for pid, selections, qty in merged:
            prow = product_rows.get(pid)
            if prow is None:
                raise not_found("product")
            product = catalog.to_domain_product(prow, actor.currency, links)
            resolved = product.resolve_selections(groups, selections)
            items.append(OrderItem.from_product(str(uuid.uuid4()), product, resolved, qty))
            lines_for_plan.append((product, qty))
    discount = snapshot = None
    discount_in = data.get("discount")
    if discount_in:
        actor.require(PermissionKey.POS_APPLY_DISCOUNTS)
        if not feature_on(system, actor.business_id, "discounts"):
            raise AppError("FEATURE_DISABLED", 403, "The Discounts feature is off")
        drow = catalog.discount(parse_uuid(discount_in.get("discount_id", ""), "discount"))
        if drow is None or drow.business_id != actor.business_id:
            raise not_found("discount")
        discount = catalog.to_domain_discount(drow, actor.currency)
    tax = tax_settings(section(system, actor.business_id, "tax") or {})
    with domain_errors():
        pricing = PriceCalculator(tax, actor.currency).price(
            [PricingLine(i.line_total, i.tax_class) for i in items], discount)
        if discount is not None:
            ident_in = discount_in.get("identification") or {}
            identification = IdentificationDetails(ident_in.get("customer_name"), ident_in.get("id_type"),
                                                   ident_in.get("id_number")) if ident_in else None
            snapshot = OrderDiscount.snapshot(discount, pricing.discount_total, identification)
    return items, lines_for_plan, pricing, snapshot


def quote(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """Server-side totals preview; nothing is created or reserved."""
    actor.require(PermissionKey.POS_VIEW)
    _, _, pricing, _ = _price_order(session, actor, data)
    return {"subtotal": str(pricing.subtotal.amount), "discount_total": str(pricing.discount_total.amount),
            "tax_amount": str(pricing.tax_amount.amount), "net_amount": str(pricing.net_amount.amount),
            "total": str(pricing.total.amount)}


def create_order(session: Session, actor: Actor, data: dict[str, Any], idempotency_key: str | None) -> tuple[int, dict]:
    actor.require(PermissionKey.POS_CREATE_ORDERS)
    terminal_id = actor.require_terminal()

    def run() -> tuple[int, dict]:
        system, catalog, inv, orders = (SystemRepository(session), ProductRepository(session),
                                        InventoryRepository(session), OrderRepository(session))
        items, lines_for_plan, pricing, snapshot = _price_order(session, actor, data)
        try:
            order_type = OrderType(data.get("order_type"))
        except ValueError as exc:
            raise validation("order_type must be dine_in, takeout or delivery") from exc
        order_id = str(uuid.uuid4())
        with domain_errors():
            plan = ReservationPlan.for_lines(lines_for_plan, catalog.recipes([uuid.UUID(p.id) for p, _ in lines_for_plan]))
        locked = inv.lock_levels(actor.business_id, plan.keys)
        at = now()
        with domain_errors():
            movements = reserve_all(plan, {k: lvl for k, (_, lvl) in locked.items()}, order_id=order_id,
                                    actor_id=str(actor.user_id), at=at)
        for key, (row, level) in locked.items():
            inv.save(actor.business_id, row, level, [m for m in movements if m.key == key])
        number = str(system.next_value(actor.business_id, "order"))
        with domain_errors():
            order = Order.place(id=order_id, number=number, origin=OrderOrigin.ONLINE, order_type=order_type,
                                items=items, pricing=pricing, discount=snapshot,
                                attribution=Attribution(str(terminal_id), str(actor.session_id), str(actor.user_id)),
                                reservation=plan, created_at=at, tag=data.get("tag"), note=data.get("note"))
        orders.insert(actor.business_id, order, idempotency_key)
        if snapshot is not None:
            audit(system, actor, actor.business_id, "discount.applied", "order", order.id,
                  after={"discount_id": snapshot.discount_id, "amount": str(snapshot.amount.amount),
                         "identification_captured": snapshot.identification is not None})
        emit(system, actor, actor.business_id, "order.created", "order", order.id, order.version,
             {"number": order.number, "status": order.status.value})
        for key in locked:
            emit(system, actor, actor.business_id, "stock.changed", key.subject_type.value, key.subject_id, 1, {})
        return 201, order_dto(order)

    return idempotent(session, actor.business_id, "POST /orders", idempotency_key, data, run)


def _load(session: Session, actor: Actor, order_id: str, *, lock: bool):  # type: ignore[no-untyped-def]
    loaded = OrderRepository(session).load(parse_uuid(order_id, "order"), actor.currency, lock=lock)
    if loaded is None or loaded[0].business_id != actor.business_id:
        raise not_found("order")
    return loaded


def _with_cashier_names(session: Session, actor: Actor, dtos: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Display name of the cashier who placed each order (ORD-14); ids come from the session attribution."""
    from app.repositories.staff_repository import StaffRepository
    names = {str(u.id): u.full_name for u in StaffRepository(session).users(actor.business_id)}
    for dto in dtos:
        dto["cashier_name"] = names.get(str(dto.get("cashier_id")))
    return dtos


def get_order(session: Session, actor: Actor, order_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.ORDERS_VIEW)
    return _with_cashier_names(session, actor, [order_dto(_load(session, actor, order_id, lock=False)[1])])[0]


def list_orders(session: Session, actor: Actor, statuses: list[str] | None) -> list[dict[str, Any]]:
    actor.require(PermissionKey.ORDERS_VIEW)
    repo = OrderRepository(session)
    wanted = statuses or ["pending", "preparing", "ready"]
    rows = repo.list(actor.business_id, statuses=wanted, archived=False)
    return _with_cashier_names(session, actor, [order_dto(o) for o in repo.to_domain_many(rows, actor.currency)])


def change_status(session: Session, actor: Actor, order_id: str, data: dict[str, Any],
                  idempotency_key: str | None) -> tuple[int, dict]:
    """Forward steps, undo, and completion (requires full settlement; reservation → sale)."""
    try:
        target = OrderStatus(data.get("target"))
    except ValueError as exc:
        raise validation("invalid target status") from exc
    if target is OrderStatus.CANCELLED:
        raise validation("use POST /orders/{id}/cancel")
    expected = data.get("expected_version")
    if target is OrderStatus.COMPLETED:
        actor.require(PermissionKey.ORDERS_COMPLETE)
        return idempotent(session, actor.business_id, f"complete:{order_id}", idempotency_key, data,
                          lambda: _complete(session, actor, order_id, expected))
    actor.require(PermissionKey.ORDERS_CHANGE_STATUS)
    row, order = _load(session, actor, order_id, lock=True)
    at = now()
    with domain_errors():
        order_rank = [OrderStatus.PENDING, OrderStatus.PREPARING, OrderStatus.READY]
        if order.status in order_rank and target in order_rank and order_rank.index(target) < order_rank.index(order.status):
            if order_rank.index(order.status) - order_rank.index(target) != 1:
                raise validation("undo goes back one step at a time")
            order.undo_last_step(at, expected_version=expected)
        else:
            order.advance(target, at, expected_version=expected)
    OrderRepository(session).save(row, order)
    system = SystemRepository(session)
    emit(system, actor, actor.business_id, "order.status_changed", "order", order.id, order.version,
         {"status": order.status.value})
    return 200, order_dto(order)


def _complete(session: Session, actor: Actor, order_id: str, expected: int | None) -> tuple[int, dict]:
    row, order = _load(session, actor, order_id, lock=True)  # order row first, then stock rows
    inv, system = InventoryRepository(session), SystemRepository(session)
    at = now()
    with domain_errors():
        plan = order.complete(at, expected_version=expected)
    locked = inv.lock_levels(actor.business_id, plan.keys)
    with domain_errors():
        movements = finalize_sale_all(plan, {k: lvl for k, (_, lvl) in locked.items()}, order_id=order.id,
                                      actor_id=str(actor.user_id), at=at)
    for key, (lrow, level) in locked.items():
        inv.save(actor.business_id, lrow, level, [m for m in movements if m.key == key])
    OrderRepository(session).save(row, order)
    emit(system, actor, actor.business_id, "order.completed", "order", order.id, order.version, {})
    return 200, order_dto(order)


def cancel_order(session: Session, actor: Actor, order_id: str, data: dict[str, Any],
                 idempotency_key: str | None) -> tuple[int, dict]:
    """Cancel before completion: reservation released, pending payments voided. Orders with
    completed payments → DECISION_PENDING (Q-CAN-1)."""
    actor.require(PermissionKey.POS_CANCEL_ORDERS)

    def run() -> tuple[int, dict]:
        row, order = _load(session, actor, order_id, lock=True)
        inv, system = InventoryRepository(session), SystemRepository(session)
        at = now()
        with domain_errors():
            plan = order.cancel(str(data.get("reason", "")), at, expected_version=data.get("expected_version"))
        locked = inv.lock_levels(actor.business_id, plan.keys)
        with domain_errors():
            movements = release_all(plan, {k: lvl for k, (_, lvl) in locked.items()}, order_id=order.id,
                                    actor_id=str(actor.user_id), at=at)
        for key, (lrow, level) in locked.items():
            inv.save(actor.business_id, lrow, level, [m for m in movements if m.key == key])
        OrderRepository(session).save(row, order)
        audit(system, actor, actor.business_id, "order.cancelled", "order", order.id,
              after={"reason": order.cancel_reason})
        emit(system, actor, actor.business_id, "order.cancelled", "order", order.id, order.version, {})
        return 200, order_dto(order)

    return idempotent(session, actor.business_id, f"cancel:{order_id}", idempotency_key, data, run)


# --- history ---------------------------------------------------------------------------------------------------
def history(session: Session, actor: Actor, include_archived: bool = False) -> list[dict[str, Any]]:
    actor.require(PermissionKey.HISTORY_VIEW)
    repo, docs = OrderRepository(session), DocumentRepository(session)
    rows = repo.list(actor.business_id, statuses=["completed", "cancelled"],
                     archived=None if include_archived else False, limit=200)
    result = []
    documents = docs.for_orders([r.id for r in rows])
    for r, order in zip(rows, repo.to_domain_many(rows, actor.currency)):
        dto = order_dto(order)
        doc = documents.get(r.id)
        dto["document"] = {"id": str(doc.id), "number": doc.number, "status": doc.status} if doc else None
        result.append(dto)
    return result


def history_detail(session: Session, actor: Actor, order_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.HISTORY_VIEW)
    row, order = _load(session, actor, order_id, lock=False)
    dto = order_dto(order)
    doc = DocumentRepository(session).for_order(row.id)
    dto["document"] = document_dto(doc) if doc else None
    return dto
