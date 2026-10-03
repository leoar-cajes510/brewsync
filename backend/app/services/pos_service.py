"""POS start-up data in one request: composes the existing catalog and inventory use cases so the
POS authenticates once instead of five times. No business rules live here."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.domain.inventory import SubjectType
from app.services import inventory_service, product_service
from app.services.base import Actor


def menu(session: Session, actor: Actor) -> dict[str, Any]:
    """Same data and permission checks as GET /categories, /products, /choice-groups, /discounts and
    /inventory. Discounts are optional (as the POS already treated a failed discounts call)."""
    try:
        discounts = product_service.list_discounts(session, actor)
    except AppError:
        discounts = []
    return {
        "categories": product_service.list_categories(session, actor),
        "products": product_service.list_products(session, actor),
        "choice_groups": product_service.list_choice_groups(session, actor),
        "discounts": discounts,
        "stock": inventory_service.list_stock(session, actor, SubjectType.PRODUCT),
    }
