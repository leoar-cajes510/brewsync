"""Cart: the client-side working set before ``POST /orders`` (R2.1, R2.5).

The cart is NOT authoritative: the server re-validates and re-prices everything when the
order is created. Identical lines (same product + same option set) merge; different
choices stay distinct lines.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .errors import ValidationError
from .money import Money, sum_money
from .product import ChoiceGroup, ChoiceOption, Product


@dataclass(slots=True)
class CartLine:
    product: Product
    selections: tuple[tuple[ChoiceGroup, ChoiceOption], ...]
    quantity: int

    @property
    def key(self) -> tuple[str, frozenset[str]]:
        return (self.product.id, frozenset(option.id for _, option in self.selections))

    @property
    def unit_price(self) -> Money:
        price = self.product.price
        for _, option in self.selections:
            price = price + option.price_delta
        return price

    @property
    def line_total(self) -> Money:
        return self.unit_price * self.quantity


class Cart:
    def __init__(self, currency: str) -> None:
        self.currency = currency
        self._lines: list[CartLine] = []

    @property
    def lines(self) -> tuple[CartLine, ...]:
        return tuple(self._lines)

    @property
    def is_empty(self) -> bool:
        return not self._lines

    def _find(self, key: tuple[str, frozenset[str]]) -> CartLine | None:
        return next((line for line in self._lines if line.key == key), None)

    def add(self, product: Product, groups: Mapping[str, ChoiceGroup],
            selections: Mapping[str, Sequence[str]], quantity: int = 1) -> CartLine:
        if quantity <= 0:
            raise ValidationError("quantity must be > 0")
        if not product.is_sellable:
            raise ValidationError(f"{product.name} is not available")
        if product.price.currency != self.currency:
            raise ValidationError("product currency differs from cart currency")
        resolved = product.resolve_selections(groups, selections)
        line = CartLine(product, resolved, quantity)
        existing = self._find(line.key)
        if existing is not None:
            existing.quantity += quantity
            return existing
        self._lines.append(line)
        return line

    def _line_at(self, index: int) -> CartLine:
        if not 0 <= index < len(self._lines):
            raise ValidationError("no such cart line")
        return self._lines[index]

    def increase(self, index: int, by: int = 1) -> None:
        if by <= 0:
            raise ValidationError("increase must be > 0")
        self._line_at(index).quantity += by

    def decrease(self, index: int, by: int = 1) -> None:
        """Decreasing to zero removes the line; quantities never go negative."""
        if by <= 0:
            raise ValidationError("decrease must be > 0")
        line = self._line_at(index)
        if by >= line.quantity:
            self.remove(index)
        else:
            line.quantity -= by

    def remove(self, index: int) -> None:
        self._line_at(index)
        del self._lines[index]

    def clear(self) -> None:
        self._lines.clear()

    def subtotal(self) -> Money:
        """Preview only; the authoritative subtotal comes from ``PriceCalculator`` server-side."""
        return sum_money([line.line_total for line in self._lines], self.currency)
