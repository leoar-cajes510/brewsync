"""POS start-up data in one request: composes the existing catalog and inventory use cases so the
POS authenticates once instead of five times. No business rules live here."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.domain.inventory import SubjectType
from app.services import inventory_service, product_service
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, feature_on


def menu(session: Session, actor: Actor) -> dict[str, Any]:
    """Same data and permission checks as GET /categories, /products, /choice-groups, /discounts and
    /inventory. Discounts are optional (as the POS already treated a failed discounts call)."""
    try:
        discounts = product_service.list_discounts(session, actor)
    except AppError:
        discounts = []
    if not feature_on(SystemRepository(session), actor.business_id, "discounts"):
        discounts = []  # Settings → Features → Discounts off: orders with a discount are refused anyway
    products = product_service.list_products(session, actor)
    return {
        "categories": product_service.list_categories(session, actor),
        "products": products,
        # Ingredient/unit availability of each product's default configuration (qty 1), computed by the
        # same rule as order creation; the POS only displays it (1, 4, 32).
        "availability": _availability(session, actor, products),
        "choice_groups": product_service.list_choice_groups(session, actor, detail=False),
        "discounts": discounts,
        "stock": inventory_service.list_stock(session, actor, SubjectType.PRODUCT),
    }


def _availability(session: Session, actor: Actor, products: list[dict[str, Any]]) -> dict[str, Any]:
    import uuid

    from app.repositories.product_repository import ProductRepository
    from app.services import availability_service
    repo = ProductRepository(session)
    rows = [r for r in repo.products(actor.business_id, [uuid.UUID(p["id"]) for p in products]) if r.active]
    if not rows:
        return {}
    links = repo.group_links([r.id for r in rows])
    domain = [repo.to_domain_product(r, actor.currency, links) for r in rows]
    groups = repo.to_domain_groups(repo.groups(actor.business_id, {l.group_id for l in links}), actor.currency)
    return availability_service.menu_availability(session, actor.business_id, domain, groups)
