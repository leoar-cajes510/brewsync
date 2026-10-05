"""Stock levels, immutable stock movements and reservations (BUSINESS-RULES §3–§4).

Invariants (Q-INV-3): on_hand ≥ 0, reserved ≥ 0, reserved ≤ on_hand, so
available = on_hand − reserved ≥ 0. Movements are rejected, never clamped.

Row locking and transactions belong to the service/repository layer; this module
only models the invariants and the deterministic subject order (``StockKey`` sorts).
Low-stock default thresholds (Q-INV-4) and disabled-feature behaviour (Q-FEAT-1)
are ⚠ OPEN and are not decided here.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from types import MappingProxyType

from .errors import InsufficientStock, NegativeStockError, StockReserved, ValidationError
from .money import to_quantity
from .product import Product
from .recipe import ChoiceEffect, Recipe


class SubjectType(StrEnum):
    PRODUCT = "product"
    INGREDIENT = "ingredient"


@dataclass(frozen=True, slots=True, order=True)
class StockKey:
    """Identifies one stock subject. Sort order = deterministic lock order (R4.8)."""

    subject_type: SubjectType
    subject_id: str


class MovementType(StrEnum):
    INITIAL = "initial"
    RESTOCK = "restock"
    ADJUSTMENT = "adjustment"
    CORRECTION = "correction"
    WASTE = "waste"
    RESERVATION = "reservation"
    RESERVATION_RELEASE = "reservation_release"
    SALE = "sale"
    SALE_REVERSAL = "sale_reversal"


class ReferenceType(StrEnum):
    ORDER = "order"
    REFUND = "refund"
    OFFLINE_SUBMISSION = "offline_submission"
    MANUAL = "manual"


class AdjustmentReason(StrEnum):
    DAMAGED = "damaged"
    LOST = "lost"
    OTHER = "other"


class StockStatus(StrEnum):
    IN = "in"
    LOW = "low"
    OUT = "out"


MAX_NOTE_LENGTH = 200


@dataclass(frozen=True, slots=True)
class StockMovement:
    """Immutable ledger row (never edited or deleted; corrections are new rows)."""

    key: StockKey
    type: MovementType
    delta_on_hand: Decimal
    delta_reserved: Decimal
    on_hand_after: Decimal
    reserved_after: Decimal
    reference_type: ReferenceType
    reference_id: str | None
    actor_id: str | None
    occurred_at: datetime
    reason: str | None = None
    note: str | None = None
    unit_cost: Decimal | None = None


@dataclass(slots=True)
class StockLevel:
    """Current stock of one subject. Changes only through movement-producing methods."""

    key: StockKey
    low_stock_threshold: Decimal
    on_hand: Decimal = Decimal("0")
    reserved: Decimal = Decimal("0")
    initialized: bool = False

    def __post_init__(self) -> None:
        self.low_stock_threshold = self._quantity(self.low_stock_threshold, allow_zero=True)
        self.on_hand = self._quantity(self.on_hand, allow_zero=True)
        self.reserved = self._quantity(self.reserved, allow_zero=True)
        self._check_invariants(self.on_hand, self.reserved)

    # --- helpers ------------------------------------------------------------------------
    def _quantity(self, value: object, *, allow_zero: bool = False) -> Decimal:
        quantity = to_quantity(value)
        if self.key.subject_type is SubjectType.PRODUCT and quantity != quantity.to_integral_value():
            raise ValidationError("product unit quantities must be whole numbers")
        if quantity < 0 or (quantity == 0 and not allow_zero):
            raise ValidationError("quantity must be > 0" if not allow_zero else "quantity must be ≥ 0")
        return quantity

    @staticmethod
    def _check_invariants(on_hand: Decimal, reserved: Decimal) -> None:
        if on_hand < 0 or reserved < 0:
            raise NegativeStockError("stock cannot be negative")
        if reserved > on_hand:
            raise StockReserved("reserved cannot exceed on_hand")

    @property
    def available(self) -> Decimal:
        return self.on_hand - self.reserved

    def status(self) -> StockStatus:
        """Computed on available (R3.7)."""
        if self.available <= 0:
            return StockStatus.OUT
        if self.available <= self.low_stock_threshold:
            return StockStatus.LOW
        return StockStatus.IN

    def _apply(
        self,
        movement_type: MovementType,
        delta_on_hand: Decimal,
        delta_reserved: Decimal,
        *,
        reference_type: ReferenceType,
        reference_id: str | None,
        actor_id: str | None,
        at: datetime,
        reason: str | None = None,
        note: str | None = None,
        unit_cost: Decimal | None = None,
    ) -> StockMovement:
        if note is not None and len(note) > MAX_NOTE_LENGTH:
            raise ValidationError(f"note must be ≤ {MAX_NOTE_LENGTH} characters")
        on_hand = self.on_hand + delta_on_hand
        reserved = self.reserved + delta_reserved
        self._check_invariants(on_hand, reserved)
        self.on_hand, self.reserved = on_hand, reserved
        return StockMovement(
            key=self.key, type=movement_type, delta_on_hand=delta_on_hand, delta_reserved=delta_reserved,
            on_hand_after=on_hand, reserved_after=reserved, reference_type=reference_type,
            reference_id=reference_id, actor_id=actor_id, occurred_at=at, reason=reason, note=note,
            unit_cost=unit_cost,
        )

    def _manual_decrease_guard(self, new_on_hand: Decimal) -> None:
        if new_on_hand < 0:
            raise NegativeStockError("on_hand cannot go below 0")
        if new_on_hand < self.reserved:
            raise StockReserved("movement would reduce on_hand below reserved stock")

    # --- manual movements (R3.4–R3.6) ------------------------------------------------------
    def set_threshold(self, value: object) -> None:
        """Low-stock threshold (≥ 0; whole units for products). Not a stock movement."""
        self.low_stock_threshold = self._quantity(value, allow_zero=True)

    def set_initial(self, quantity: Decimal, *, actor_id: str, at: datetime) -> StockMovement:
        if self.initialized:
            raise ValidationError("initial stock is set once; use restock/adjustment afterwards")
        q = self._quantity(quantity, allow_zero=True)
        movement = self._apply(MovementType.INITIAL, q, Decimal("0"), reference_type=ReferenceType.MANUAL,
                               reference_id=None, actor_id=actor_id, at=at)
        self.initialized = True
        return movement

    def restock(self, quantity: Decimal, *, actor_id: str, at: datetime,
                unit_cost: Decimal | None = None, note: str | None = None) -> StockMovement:
        q = self._quantity(quantity)
        if unit_cost is not None:
            unit_cost = to_quantity(unit_cost, 4, "unit_cost")
            if unit_cost < 0:
                raise ValidationError("unit_cost must be ≥ 0")
        return self._apply(MovementType.RESTOCK, q, Decimal("0"), reference_type=ReferenceType.MANUAL,
                           reference_id=None, actor_id=actor_id, at=at, note=note, unit_cost=unit_cost)

    def _signed_manual(self, movement_type: MovementType, delta: Decimal, reason: str, *,
                       actor_id: str, at: datetime, note: str | None) -> StockMovement:
        d = to_quantity(delta, field="delta")
        if d == 0:
            raise ValidationError("delta must not be 0")
        if not reason or not str(reason).strip():
            raise ValidationError("a reason is required")
        self._quantity(abs(d))
        self._manual_decrease_guard(self.on_hand + d)
        return self._apply(movement_type, d, Decimal("0"), reference_type=ReferenceType.MANUAL,
                           reference_id=None, actor_id=actor_id, at=at, reason=str(reason), note=note)

    def adjust(self, delta: Decimal, reason: AdjustmentReason, *, actor_id: str, at: datetime,
               note: str | None = None) -> StockMovement:
        reason = AdjustmentReason(reason)
        # Damaged / Lost record a loss: they can only take stock away (INV-08). Increases use a
        # count correction, "Other" with a note, or a restock.
        if reason in (AdjustmentReason.DAMAGED, AdjustmentReason.LOST) and to_quantity(delta, field="delta") > 0:
            raise ValidationError(f"a {reason.value} adjustment can only decrease stock")
        return self._signed_manual(MovementType.ADJUSTMENT, delta, AdjustmentReason(reason).value,
                                   actor_id=actor_id, at=at, note=note)

    def correct(self, delta: Decimal, reason: str, *, actor_id: str, at: datetime,
                note: str | None = None) -> StockMovement:
        return self._signed_manual(MovementType.CORRECTION, delta, reason, actor_id=actor_id, at=at, note=note)

    def waste(self, quantity: Decimal, *, actor_id: str, at: datetime, note: str | None = None) -> StockMovement:
        q = self._quantity(quantity)
        self._manual_decrease_guard(self.on_hand - q)
        return self._apply(MovementType.WASTE, -q, Decimal("0"), reference_type=ReferenceType.MANUAL,
                           reference_id=None, actor_id=actor_id, at=at, note=note)

    # --- order-driven movements (R4.2–R4.4) ------------------------------------------------------
    def reserve(self, quantity: Decimal, *, order_id: str, actor_id: str | None, at: datetime) -> StockMovement:
        q = self._quantity(quantity)
        if q > self.available:
            raise InsufficientStock({self.key: q - self.available})
        return self._apply(MovementType.RESERVATION, Decimal("0"), q, reference_type=ReferenceType.ORDER,
                           reference_id=order_id, actor_id=actor_id, at=at)

    def release(self, quantity: Decimal, *, order_id: str, actor_id: str | None, at: datetime) -> StockMovement:
        q = self._quantity(quantity)
        return self._apply(MovementType.RESERVATION_RELEASE, Decimal("0"), -q, reference_type=ReferenceType.ORDER,
                           reference_id=order_id, actor_id=actor_id, at=at)

    def sell(self, quantity: Decimal, *, order_id: str, actor_id: str | None, at: datetime) -> StockMovement:
        """Reservation becomes the finalized sale: on_hand −q and reserved −q."""
        q = self._quantity(quantity)
        return self._apply(MovementType.SALE, -q, -q, reference_type=ReferenceType.ORDER,
                           reference_id=order_id, actor_id=actor_id, at=at)

    def reverse_sale(self, quantity: Decimal, *, refund_id: str, actor_id: str, at: datetime) -> StockMovement:
        """Mechanics of a ``sale_reversal``. Whether refunds restock is ⚠ OPEN (Q-REF-3):
        the service must not call this until that decision exists."""
        q = self._quantity(quantity)
        return self._apply(MovementType.SALE_REVERSAL, q, Decimal("0"), reference_type=ReferenceType.REFUND,
                           reference_id=refund_id, actor_id=actor_id, at=at)


@dataclass(frozen=True, slots=True)
class ReservationPlan:
    """Quantities to reserve per stock subject for one order, fixed at creation (R4.5)."""

    quantities: Mapping[StockKey, Decimal] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for key, quantity in self.quantities.items():
            if quantity <= 0:
                raise ValidationError(f"reservation quantity for {key} must be > 0")
        object.__setattr__(self, "quantities", MappingProxyType(dict(sorted(self.quantities.items()))))

    @classmethod
    def for_lines(cls, lines: Iterable[tuple[Product, int] | tuple[Product, int, Sequence[ChoiceEffect]]],
                  recipes: Mapping[str, Recipe]) -> ReservationPlan:
        """Aggregate unit and ingredient requirements across all lines (R4.2, R4a.3).

        A line may carry the ingredient effects of its selected choice options (R4a.3a); they
        apply only when the product tracks ingredients.
        """
        totals: dict[StockKey, Decimal] = {}
        for product, quantity, *rest in lines:
            effects = tuple(rest[0]) if rest else ()
            if quantity <= 0:
                raise ValidationError("line quantity must be > 0")
            if product.track_units:
                key = StockKey(SubjectType.PRODUCT, product.id)
                totals[key] = totals.get(key, Decimal("0")) + quantity
            if product.track_ingredients:
                recipe = recipes.get(product.id)
                if recipe is None or not recipe.lines:
                    raise ValidationError(f"product {product.name} tracks ingredients but has no recipe")
                for ingredient_id, needed in recipe.consumption(quantity, effects).items():
                    key = StockKey(SubjectType.INGREDIENT, ingredient_id)
                    totals[key] = totals.get(key, Decimal("0")) + needed
        return cls(totals)

    @property
    def keys(self) -> tuple[StockKey, ...]:
        return tuple(self.quantities)


def _levels_for(plan: ReservationPlan, levels: Mapping[StockKey, StockLevel]) -> list[StockLevel]:
    missing = [key for key in plan.keys if key not in levels]
    if missing:
        raise ValidationError(f"missing stock levels for {missing}")
    return [levels[key] for key in plan.keys]  # plan keys are sorted: deterministic order


def reserve_all(plan: ReservationPlan, levels: Mapping[StockKey, StockLevel], *, order_id: str,
                actor_id: str | None, at: datetime) -> list[StockMovement]:
    """All-or-nothing reservation (R4.2): check every subject before changing any."""
    targets = _levels_for(plan, levels)
    shortfalls = {
        level.key: plan.quantities[level.key] - level.available
        for level in targets if plan.quantities[level.key] > level.available
    }
    if shortfalls:
        raise InsufficientStock(shortfalls)
    return [level.reserve(plan.quantities[level.key], order_id=order_id, actor_id=actor_id, at=at)
            for level in targets]


def release_all(plan: ReservationPlan, levels: Mapping[StockKey, StockLevel], *, order_id: str,
                actor_id: str | None, at: datetime) -> list[StockMovement]:
    """Release exactly the order's reserved quantities (cancel before completion, R4.3)."""
    targets = _levels_for(plan, levels)
    for level in targets:
        if plan.quantities[level.key] > level.reserved:
            raise NegativeStockError(f"{level.key} has less reserved stock than the order reserved")
    return [level.release(plan.quantities[level.key], order_id=order_id, actor_id=actor_id, at=at)
            for level in targets]


def finalize_sale_all(plan: ReservationPlan, levels: Mapping[StockKey, StockLevel], *, order_id: str,
                      actor_id: str | None, at: datetime) -> list[StockMovement]:
    """Convert the order's reservations into sale movements (completion, R4.4)."""
    targets = _levels_for(plan, levels)
    for level in targets:
        if plan.quantities[level.key] > level.reserved:
            raise NegativeStockError(f"{level.key} has less reserved stock than the order reserved")
    return [level.sell(plan.quantities[level.key], order_id=order_id, actor_id=actor_id, at=at)
            for level in targets]


def pos_availability(product: Product, levels: Mapping[StockKey, StockLevel],
                     recipe: Recipe | None) -> int | None:
    """Sellable units (R4.6); ``None`` when the product tracks no stock (unlimited)."""
    limits: list[int] = []
    if product.track_units:
        level = levels.get(StockKey(SubjectType.PRODUCT, product.id))
        limits.append(int(level.available) if level else 0)
    if product.track_ingredients:
        if recipe is None or not recipe.lines:
            limits.append(0)
        else:
            for line in recipe.lines:
                level = levels.get(StockKey(SubjectType.INGREDIENT, line.ingredient_id))
                available = level.available if level else Decimal("0")
                limits.append(int(available // line.quantity))
    return min(limits) if limits else None


def sorted_keys(keys: Sequence[StockKey]) -> list[StockKey]:
    """Deterministic lock order for the service layer (by subject_type, then subject_id)."""
    return sorted(keys)
