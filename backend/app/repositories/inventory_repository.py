"""Stock persistence. Stock rows are locked in deterministic order (subject_type, subject_id)
before any change (BUSINESS-RULES R4.8)."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from decimal import Decimal

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.domain.inventory import StockKey, StockLevel, StockMovement, SubjectType
from app.models import StockLevelRow, StockMovementRow


class InventoryRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    def lock_levels(self, business_id: uuid.UUID, keys: Iterable[StockKey]) -> dict[StockKey, tuple[StockLevelRow, StockLevel]]:
        """SELECT … FOR UPDATE in sorted key order; returns row + domain level per key."""
        result: dict[StockKey, tuple[StockLevelRow, StockLevel]] = {}
        for key in sorted(set(keys)):
            row = self.s.scalars(select(StockLevelRow).where(
                StockLevelRow.business_id == business_id, StockLevelRow.subject_type == key.subject_type.value,
                StockLevelRow.subject_id == uuid.UUID(key.subject_id)).with_for_update()).first()
            if row is not None:
                result[key] = (row, self.to_domain(row))
        return result

    def levels(self, business_id: uuid.UUID, subject_type: SubjectType | None = None) -> list[StockLevelRow]:
        stmt = select(StockLevelRow).where(StockLevelRow.business_id == business_id)
        if subject_type is not None:
            stmt = stmt.where(StockLevelRow.subject_type == subject_type.value)
        return list(self.s.scalars(stmt))

    def levels_for(self, business_id: uuid.UUID, keys: Iterable[StockKey]) -> dict[StockKey, StockLevel]:
        pairs = [(k.subject_type.value, uuid.UUID(k.subject_id)) for k in keys]
        if not pairs:
            return {}
        rows = self.s.scalars(select(StockLevelRow).where(
            StockLevelRow.business_id == business_id,
            tuple_(StockLevelRow.subject_type, StockLevelRow.subject_id).in_(pairs)))
        return {StockKey(SubjectType(r.subject_type), str(r.subject_id)): self.to_domain(r) for r in rows}

    def create_level(self, business_id: uuid.UUID, key: StockKey, threshold: Decimal) -> tuple[StockLevelRow, StockLevel]:
        row = StockLevelRow(business_id=business_id, subject_type=key.subject_type.value,
                            subject_id=uuid.UUID(key.subject_id), on_hand=Decimal("0"), reserved=Decimal("0"),
                            low_stock_threshold=threshold, initialized=False)
        self.s.add(row)
        self.s.flush()
        return row, self.to_domain(row)

    @staticmethod
    def to_domain(row: StockLevelRow) -> StockLevel:
        return StockLevel(StockKey(SubjectType(row.subject_type), str(row.subject_id)),
                          low_stock_threshold=Decimal(row.low_stock_threshold), on_hand=Decimal(row.on_hand),
                          reserved=Decimal(row.reserved), initialized=row.initialized)

    def save(self, business_id: uuid.UUID, row: StockLevelRow, level: StockLevel,
             movements: Iterable[StockMovement], extra: dict | None = None) -> None:
        """``extra``: receiving/count details stored on the movement rows (supplier, counted/system qty)."""
        row.on_hand, row.reserved, row.initialized = level.on_hand, level.reserved, level.initialized
        for mv in movements:
            if mv.type.value in ("restock", "initial"):
                row.last_restocked_at = mv.occurred_at
            self.s.add(StockMovementRow(
                business_id=business_id, subject_type=mv.key.subject_type.value, subject_id=uuid.UUID(mv.key.subject_id),
                type=mv.type.value, delta_on_hand=mv.delta_on_hand, delta_reserved=mv.delta_reserved,
                on_hand_after=mv.on_hand_after, reserved_after=mv.reserved_after, reason=mv.reason, note=mv.note,
                unit_cost=mv.unit_cost, reference_type=mv.reference_type.value, reference_id=mv.reference_id,
                actor_id=uuid.UUID(mv.actor_id) if mv.actor_id else None, created_at=mv.occurred_at, **(extra or {})))
        self.s.flush()

    def movements(self, business_id: uuid.UUID, key: StockKey, limit: int = 100) -> list[StockMovementRow]:
        return list(self.s.scalars(select(StockMovementRow).where(
            StockMovementRow.business_id == business_id, StockMovementRow.subject_type == key.subject_type.value,
            StockMovementRow.subject_id == uuid.UUID(key.subject_id)).order_by(StockMovementRow.created_at.desc())
            .limit(limit)))
