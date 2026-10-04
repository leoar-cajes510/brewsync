"""Catalog, inventory, orders, payments, refunds, documents, history, archive, expenses."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request

from app.core.exceptions import AppError
from app.domain.inventory import SubjectType
from app.routers.api import authed, idem_key, respond, respond_pair
from app.schemas.requests import (
    ArchiveRequest, CancelRequest, CreateOrderRequest, PaymentRequestIn, RefundRequest, StatusRequest,
)
from app.services import (
    analytics_service, archive_service, document_service, expense_service, inventory_service, order_service, payment_service,
    pos_service, product_service, refund_service,
)

router = APIRouter(prefix="/api/v1")


# --- catalog -----------------------------------------------------------------------------------------------------
@router.get("/categories", tags=["catalog"])
def list_categories(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, product_service.list_categories))


@router.post("/categories", tags=["catalog"])
def create_category(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.create_category(s, a, body)), 201)


@router.patch("/categories/{category_id}", tags=["catalog"])
def update_category(category_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.update_category(s, a, category_id, body)))


@router.get("/products", tags=["catalog"])
def list_products(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, product_service.list_products))


@router.post("/products", tags=["catalog"])
def create_product(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.create_product(s, a, body)), 201)


@router.delete("/products/{product_id}", tags=["catalog"])
def delete_product(product_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.delete_product(s, a, product_id)))


@router.patch("/products/{product_id}", tags=["catalog"])
def update_product(product_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.update_product(s, a, product_id, body)))


@router.put("/products/{product_id}/recipe", tags=["catalog"])
def set_recipe(product_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.set_recipe(
        s, a, product_id, body.get("lines"), body.get("track_ingredients"))))


@router.get("/products/{product_id}/recipe", tags=["catalog"])
def get_recipe(product_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.get_recipe(s, a, product_id)))


@router.get("/choice-groups", tags=["catalog"])
def list_choice_groups(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, product_service.list_choice_groups))


@router.post("/choice-groups", tags=["catalog"])
def create_choice_group(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.create_choice_group(s, a, body)), 201)


@router.patch("/choice-groups/{group_id}", tags=["catalog"])
def update_choice_group(group_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.update_choice_group(s, a, group_id, body)))


@router.get("/discounts", tags=["catalog"])
def list_discounts(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, product_service.list_discounts))


@router.post("/discounts", tags=["catalog"])
def create_discount(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.create_discount(s, a, body)), 201)


@router.patch("/discounts/{discount_id}", tags=["catalog"])
def update_discount(discount_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: product_service.update_discount(s, a, discount_id, body)))


@router.post("/discounts/{discount_id}/{action}", tags=["catalog"])
def toggle_discount(discount_id: str, action: str, request: Request):  # type: ignore[no-untyped-def]
    if action not in ("activate", "deactivate"):
        raise AppError("NOT_FOUND", 404, "unknown discount action")
    return respond(authed(request, lambda s, a: product_service.set_discount_active(s, a, discount_id, action == "activate")))


# --- inventory & ingredients ------------------------------------------------------------------------------------------
@router.get("/pos/menu", tags=["catalog"])
def pos_menu(request: Request):  # type: ignore[no-untyped-def]
    """POS start-up data (categories, products, choice groups, discounts, stock) in one request."""
    return respond(authed(request, pos_service.menu))


@router.get("/inventory", tags=["inventory"])
def list_inventory(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.list_stock(s, a, SubjectType.PRODUCT)))


@router.get("/inventory/{product_id}/movements", tags=["inventory"])
def product_movements(product_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.list_movements(s, a, SubjectType.PRODUCT, product_id)))


@router.patch("/inventory/{product_id}", tags=["inventory"])
def product_threshold(product_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.set_threshold(
        s, a, SubjectType.PRODUCT, product_id, body)))


@router.post("/inventory/{product_id}/{action}", tags=["inventory"])
def move_product_stock(product_id: str, action: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: inventory_service.move_stock(
        s, a, SubjectType.PRODUCT, product_id, action, body, idem_key(request))))


@router.get("/ingredients", tags=["inventory"])
def list_ingredients(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, inventory_service.list_ingredients))


@router.post("/ingredients", tags=["inventory"])
def create_ingredient(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.create_ingredient(s, a, body)), 201)


@router.patch("/ingredients/{ingredient_id}", tags=["inventory"])
def update_ingredient(ingredient_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.update_ingredient(s, a, ingredient_id, body)))


@router.get("/ingredients/{ingredient_id}/movements", tags=["inventory"])
def ingredient_movements(ingredient_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.list_movements(
        s, a, SubjectType.INGREDIENT, ingredient_id)))


@router.patch("/ingredients/{ingredient_id}/threshold", tags=["inventory"])
def ingredient_threshold(ingredient_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: inventory_service.set_threshold(
        s, a, SubjectType.INGREDIENT, ingredient_id, body)))


@router.post("/ingredients/{ingredient_id}/{action}", tags=["inventory"])
def move_ingredient_stock(ingredient_id: str, action: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: inventory_service.move_stock(
        s, a, SubjectType.INGREDIENT, ingredient_id, action, body, idem_key(request))))


# --- orders ----------------------------------------------------------------------------------------------------------------
@router.post("/orders/quote", tags=["orders"])
def quote(body: CreateOrderRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: order_service.quote(s, a, body.payload())))


@router.post("/orders", tags=["orders"])
def create_order(body: CreateOrderRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: order_service.create_order(s, a, body.payload(), idem_key(request))))


@router.get("/orders", tags=["orders"])
def list_orders(request: Request, status: str | None = Query(default=None)):  # type: ignore[no-untyped-def]
    statuses = [x for x in status.split(",") if x] if status else None
    return respond(authed(request, lambda s, a: order_service.list_orders(s, a, statuses)))


@router.get("/orders/{order_id}", tags=["orders"])
def get_order(order_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: order_service.get_order(s, a, order_id)))


@router.post("/orders/{order_id}/status", tags=["orders"])
def change_status(order_id: str, body: StatusRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: order_service.change_status(
        s, a, order_id, body.model_dump(), idem_key(request))))


@router.post("/orders/{order_id}/cancel", tags=["orders"])
def cancel_order(order_id: str, body: CancelRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: order_service.cancel_order(
        s, a, order_id, body.model_dump(), idem_key(request))))


@router.post("/orders/{order_id}/payments", tags=["payments"])
def record_payment(order_id: str, body: PaymentRequestIn, request: Request):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: payment_service.record_payment(
        s, a, order_id, body.payload(), idem_key(request))))


@router.post("/orders/{order_id}/payments/{payment_id}/confirm", tags=["payments"])
def confirm_payment(order_id: str, payment_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: payment_service.confirm_payment(s, a, order_id, payment_id)))


@router.post("/orders/{order_id}/payments/{payment_id}/void", tags=["payments"])
def void_payment(order_id: str, payment_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: payment_service.void_payment(s, a, order_id, payment_id)))


@router.post("/orders/{order_id}/refunds", tags=["refunds"])
def record_refund(order_id: str, body: RefundRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond_pair(authed(request, lambda s, a: refund_service.record_refund(
        s, a, order_id, body.model_dump(), idem_key(request))))


# --- documents (UI label "Receipts") ---------------------------------------------------------------------------------------------
@router.get("/documents", tags=["documents"])
def list_documents(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, document_service.list_documents))


@router.get("/documents/{document_id}", tags=["documents"])
def get_document(document_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: document_service.get_document(s, a, document_id)))


@router.post("/documents/{document_id}/reprint", tags=["documents"])
def reprint_document(document_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: document_service.print_document(s, a, document_id)))


# --- history & archive --------------------------------------------------------------------------------------------------------------
@router.get("/history", tags=["history"])
def history(request: Request, include_archived: bool = False):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: order_service.history(s, a, include_archived)))


@router.get("/history/{order_id}", tags=["history"])
def history_detail(order_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: order_service.history_detail(s, a, order_id)))


@router.get("/archive", tags=["archive"])
def list_archive(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, archive_service.list_archive))


@router.post("/archive", tags=["archive"])
def archive(body: ArchiveRequest, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: archive_service.archive_orders(s, a, body.order_ids, body.reason)))


@router.post("/archive/{order_id}/restore", tags=["archive"])
def restore(order_id: str, request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: archive_service.restore_order(s, a, order_id)))


# --- expenses -------------------------------------------------------------------------------------------------------------------------
@router.get("/expenses", tags=["expenses"])
def list_expenses(request: Request):  # type: ignore[no-untyped-def]
    return respond(authed(request, expense_service.list_expenses))


@router.post("/expenses", tags=["expenses"])
def record_expense(request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: expense_service.record_expense(s, a, body)), 201)


@router.patch("/expenses/{expense_id}", tags=["expenses"])
def update_expense(expense_id: str, request: Request, body: dict[str, Any] = Body(...)):  # type: ignore[no-untyped-def]
    return respond(authed(request, lambda s, a: expense_service.update_expense(s, a, expense_id, body)))


# --- analytics --------------------------------------------------------------------------------------------------------
@router.get("/analytics/sales", tags=["analytics"])
def analytics_sales(request: Request, start: str = Query(...), end: str = Query(...)):  # type: ignore[no-untyped-def]
    """Completed sales (net of refunds) and expenses in [start, end] for the Admin analytics views."""
    return respond(authed(request, lambda s, a: analytics_service.sales_feed(s, a, start, end)))
