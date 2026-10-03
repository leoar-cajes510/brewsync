"""System-wide persistence: setup state, business, settings, sequences, document series,
audit log, idempotency records and the event outbox."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database.base import utcnow
from app.models import (
    AuditLogRow, BusinessRow, DocumentSeriesRow, DomainEventRow, IdempotencyRecordRow, SequenceRow,
    SettingsDocumentRow, SettingsHistoryRow, SystemStateRow,
)


class SystemRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    # --- setup state / business ---------------------------------------------------------
    def system_state(self, *, lock: bool = False) -> SystemStateRow | None:
        stmt = select(SystemStateRow).where(SystemStateRow.id == 1)
        if lock:
            stmt = stmt.with_for_update()
        return self.s.scalars(stmt).first()

    def ensure_system_state(self) -> SystemStateRow:
        row = self.system_state(lock=True)
        if row is None:
            row = SystemStateRow(id=1, setup_status="not_started")
            self.s.add(row)
            self.s.flush()
        return row

    def business(self) -> BusinessRow | None:
        return self.s.scalars(select(BusinessRow).limit(1)).first()

    def add(self, row: Any) -> Any:
        self.s.add(row)
        self.s.flush()
        return row

    # --- settings ---------------------------------------------------------------------------
    def settings(self, business_id: uuid.UUID, section: str, *, lock: bool = False) -> SettingsDocumentRow | None:
        stmt = select(SettingsDocumentRow).where(SettingsDocumentRow.business_id == business_id,
                                                 SettingsDocumentRow.section == section)
        if lock:
            stmt = stmt.with_for_update()
        return self.s.scalars(stmt).first()

    def all_settings(self, business_id: uuid.UUID) -> list[SettingsDocumentRow]:
        return list(self.s.scalars(select(SettingsDocumentRow).where(SettingsDocumentRow.business_id == business_id)))

    def save_settings(self, business_id: uuid.UUID, section: str, data: dict, version: int,
                      by: uuid.UUID | None) -> SettingsDocumentRow:
        now = utcnow()
        row = self.settings(business_id, section, lock=True)
        if row is None:
            row = SettingsDocumentRow(business_id=business_id, section=section, data=data, version=version,
                                      updated_by=by, updated_at=now)
            self.s.add(row)
        else:
            row.data, row.version, row.updated_by, row.updated_at = data, version, by, now
        self.s.add(SettingsHistoryRow(business_id=business_id, section=section, version=version, data=data,
                                      updated_by=by, updated_at=now))
        self.s.flush()
        return row

    # --- sequences (row-locked counters) ----------------------------------------------------------
    def next_value(self, business_id: uuid.UUID, name: str) -> int:
        # Create the counter race-free (two first-time callers must not both INSERT), then lock it.
        self.s.execute(pg_insert(SequenceRow).values(business_id=business_id, name=name, next_value=1)
                       .on_conflict_do_nothing(index_elements=["business_id", "name"]))
        row = self.s.scalars(select(SequenceRow).where(SequenceRow.business_id == business_id,
                                                       SequenceRow.name == name)
                             .with_for_update().execution_options(populate_existing=True)).one()
        value = row.next_value
        row.next_value = value + 1
        self.s.flush()
        return value

    # --- document series ----------------------------------------------------------------------------
    def lock_series(self, business_id: uuid.UUID, document_type: str,
                    terminal_id: uuid.UUID | None) -> DocumentSeriesRow | None:
        stmt = (select(DocumentSeriesRow)
                .where(DocumentSeriesRow.business_id == business_id, DocumentSeriesRow.document_type == document_type,
                       DocumentSeriesRow.active.is_(True))
                .order_by(DocumentSeriesRow.scope.desc())  # 'terminal' before 'business'
                .with_for_update())
        for row in self.s.scalars(stmt):
            if row.scope == "business" or row.terminal_id == terminal_id:
                return row
        return None

    # --- audit / events / idempotency ---------------------------------------------------------------------
    def audit(self, *, business_id: uuid.UUID | None, actor_id: uuid.UUID | None, action: str, entity_type: str,
              entity_id: str | None, terminal_id: uuid.UUID | None = None, before: dict | None = None,
              after: dict | None = None, at: datetime | None = None) -> None:
        self.s.add(AuditLogRow(business_id=business_id, actor_id=actor_id, terminal_id=terminal_id, action=action,
                               entity_type=entity_type, entity_id=entity_id, before=before or {}, after=after or {},
                               created_at=at or utcnow()))

    def audit_logs(self, business_id: uuid.UUID, *, entity_type: str | None = None, limit: int = 100,
                   action: str | None = None, involving_user: uuid.UUID | None = None) -> list[AuditLogRow]:
        stmt = select(AuditLogRow).where(AuditLogRow.business_id == business_id)
        if entity_type:
            stmt = stmt.where(AuditLogRow.entity_type == entity_type)
        if action:
            stmt = stmt.where(AuditLogRow.action == action)
        if involving_user is not None:  # done by the user, or done to the user's account
            stmt = stmt.where((AuditLogRow.actor_id == involving_user)
                              | ((AuditLogRow.entity_type == "user") & (AuditLogRow.entity_id == str(involving_user))))
        return list(self.s.scalars(stmt.order_by(AuditLogRow.created_at.desc()).limit(limit)))

    def append_event(self, *, business_id: uuid.UUID, type: str, entity_type: str, entity_id: str,
                     entity_version: int, actor_id: uuid.UUID | None, terminal_id: uuid.UUID | None,
                     payload: dict, at: datetime) -> DomainEventRow:
        sequence = self.next_value(business_id, "event")
        row = DomainEventRow(business_id=business_id, sequence=sequence, type=type, entity_type=entity_type,
                             entity_id=entity_id, entity_version=entity_version, actor_id=actor_id,
                             terminal_id=terminal_id, payload=payload, occurred_at=at)
        self.s.add(row)
        return row

    def events_after(self, business_id: uuid.UUID, after_sequence: int, limit: int = 200) -> list[DomainEventRow]:
        return list(self.s.scalars(select(DomainEventRow).where(DomainEventRow.business_id == business_id,
                                                               DomainEventRow.sequence > after_sequence)
                                   .order_by(DomainEventRow.sequence).limit(limit)))

    def idempotency(self, business_id: uuid.UUID, scope: str, key: str) -> IdempotencyRecordRow | None:
        return self.s.scalars(select(IdempotencyRecordRow).where(
            IdempotencyRecordRow.business_id == business_id, IdempotencyRecordRow.scope == scope,
            IdempotencyRecordRow.key == key)).first()

    def save_idempotency(self, business_id: uuid.UUID, scope: str, key: str, request_hash: str, response: dict,
                         status_code: int) -> None:
        self.s.add(IdempotencyRecordRow(business_id=business_id, scope=scope, key=key, request_hash=request_hash,
                                        response=response, status_code=status_code))
        self.s.flush()

    def count(self, row_type: Any) -> int:
        return int(self.s.scalar(select(func.count()).select_from(row_type)) or 0)
