"""In-memory test builders for domain unit tests (test data only — never production seed data)."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))  # backend/ on sys.path

from app.domain.discount import Discount, DiscountType, Eligibility, OrderDiscount  # noqa: E402
from app.domain.inventory import ReservationPlan  # noqa: E402
from app.domain.money import Money  # noqa: E402
from app.domain.order import Attribution, Order, OrderItem, OrderOrigin, OrderType  # noqa: E402
from app.domain.pricing import PriceCalculator, PricingLine  # noqa: E402
from app.domain.product import ChoiceGroup, ChoiceOption, Product, ProductChoiceGroup, SelectionType  # noqa: E402
from app.domain.tax import TaxClass, TaxMode, TaxSettings  # noqa: E402

CUR = "PHP"
T0 = datetime(2026, 9, 28, 8, 0, tzinfo=timezone.utc)


def m(value: str) -> Money:
    return Money.of(value, CUR)


def product(pid: str = "p-latte", price: str = "120.00", *, tax_class: TaxClass = TaxClass.TAXABLE,
            groups: tuple[str, ...] = (), track_units: bool = False, track_ingredients: bool = False) -> Product:
    return Product(id=pid, code=pid.upper(), name=f"Item {pid}", category_id="c-1", price=m(price),
                   tax_class=tax_class, track_units=track_units, track_ingredients=track_ingredients,
                   choice_groups=tuple(ProductChoiceGroup(pid, g, i) for i, g in enumerate(groups)))


def milk_group() -> ChoiceGroup:
    return ChoiceGroup(
        id="g-milk", code="MILK", name="Milk", selection_type=SelectionType.SINGLE, required=True,
        min_select=1, max_select=1,
        options=(ChoiceOption("o-regular", "g-milk", "Regular Milk", m("0.00")),
                 ChoiceOption("o-oat", "g-milk", "Oat Milk", m("25.00")),
                 ChoiceOption("o-old", "g-milk", "Discontinued", m("0.00"), active=False)),
    )


def tax_settings(rate: str = "10", mode: TaxMode = TaxMode.EXCLUDED) -> TaxSettings:
    return TaxSettings(enabled=True, mode=mode, name="Sales Tax", rate=Decimal(rate))


def percent_discount(pct: str = "20", **kw) -> Discount:
    return Discount(id="d-1", name="Promo", type=DiscountType.PERCENTAGE, value=Decimal(pct),
                    eligibility=kw.pop("eligibility", Eligibility.ALL), currency=CUR, **kw)


def make_order(items: list[OrderItem] | None = None, *, tax: TaxSettings | None = None,
               discount: Discount | None = None, oid: str = "o-1") -> Order:
    items = items or [OrderItem.from_product("i-1", product(price="250.00"), (), 2)]
    tax = tax or TaxSettings(enabled=False, mode=TaxMode.INCLUDED)
    pricing = PriceCalculator(tax, CUR).price([PricingLine(i.line_total, i.tax_class) for i in items], discount)
    snapshot = OrderDiscount.snapshot(discount, pricing.discount_total) if discount else None
    return Order.place(id=oid, number="1045", origin=OrderOrigin.ONLINE, order_type=OrderType.TAKEOUT,
                       items=items, pricing=pricing, discount=snapshot,
                       attribution=Attribution("t-1", "s-1", "u-1"), reservation=ReservationPlan({}),
                       created_at=T0)
