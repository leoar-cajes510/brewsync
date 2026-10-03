"""Back office, settings, sequences, audit, idempotency, events, offline (DATABASE.md)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, money, text, ts, uuid_pk

BIZ = "businesses.id"
_EXPENSE_CATEGORIES = "'Supplies','Ingredients','Utilities','Rent','Equipment','Maintenance','Transportation','Marketing','Other'"


class ExpenseRow(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        UniqueConstraint("business_id", "code"),
        CheckConstraint("amount > 0", name="amount"),
        CheckConstraint(f"category in ({_EXPENSE_CATEGORIES})", name="category"),  # ExpenseCategory (fixed, Q-EXP-2)
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    code: Mapped[str] = text(20)
    category: Mapped[str] = text(20)
    description: Mapped[str] = text(120)
    amount: Mapped[Decimal] = money()
    expense_date: Mapped[date] = mapped_column(Date)
    payment_method: Mapped[str] = text(20)
    notes: Mapped[str] = mapped_column(Text, default="")
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = ts(default_now=True)
    updated_at: Mapped[datetime] = ts(default_now=True)
    voided_at: Mapped[datetime | None] = ts()  # delete vs void ⚠ OPEN Q-EXP-1
    void_reason: Mapped[str | None] = text(200, nullable=True)


class SettingsDocumentRow(Base):
    __tablename__ = "settings_documents"
    __table_args__ = (UniqueConstraint("business_id", "section"), CheckConstraint("version >= 1", name="version"))
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    section: Mapped[str] = text(20)
    data: Mapped[dict] = mapped_column(JSONType)
    version: Mapped[int] = mapped_column(Integer)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_at: Mapped[datetime] = ts(default_now=True)


class SettingsHistoryRow(Base):
    """Append-only."""

    __tablename__ = "settings_history"
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    section: Mapped[str] = text(20)
    version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSONType)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_at: Mapped[datetime] = ts(nullable=False)


class SequenceRow(Base):
    __tablename__ = "sequences"
    __table_args__ = (CheckConstraint("next_value >= 1", name="next_value"),)
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. "product:<category uuid>"
    next_value: Mapped[int] = mapped_column(Integer)


class AuditLogRow(Base):
    """Append-only; never contains credentials or identification values."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_entity", "entity_type", "entity_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"), nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    action: Mapped[str] = text(60)
    entity_type: Mapped[str] = text(40)
    entity_id: Mapped[str | None] = text(64, nullable=True)
    before: Mapped[dict] = mapped_column(JSONType, default=dict)
    after: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = ts(nullable=False)


class IdempotencyRecordRow(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("business_id", "scope", "key"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    scope: Mapped[str] = text(80)
    key: Mapped[str] = text(80)
    request_hash: Mapped[str] = text(64)
    response: Mapped[dict] = mapped_column(JSONType)
    status_code: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = ts(default_now=True)


class DomainEventRow(Base):
    """Transactional outbox: written in the same transaction; published after commit (later phase)."""

    __tablename__ = "domain_events"
    __table_args__ = (UniqueConstraint("business_id", "sequence"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    sequence: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = text(40)
    entity_type: Mapped[str] = text(40)
    entity_id: Mapped[str] = text(64)
    entity_version: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONType, default=dict)
    occurred_at: Mapped[datetime] = ts(nullable=False)
    published_at: Mapped[datetime | None] = ts()


class OfflineSubmissionRow(Base):
    __tablename__ = "offline_submissions"
    __table_args__ = (
        CheckConstraint("status in ('received','committed','needs_review','resolved')", name="status"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    client_txn_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    captured_at: Mapped[datetime] = ts(nullable=False)
    received_at: Mapped[datetime] = ts(nullable=False)
    snapshot_version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSONType)
    status: Mapped[str] = text(16)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    conflict_reasons: Mapped[list] = mapped_column(JSONType, default=list)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    resolved_at: Mapped[datetime | None] = ts()
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
