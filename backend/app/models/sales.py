"""Sales tables: orders, items, discounts, payments, refunds, documents (DATABASE.md §Sales)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, Numeric, Text, UniqueConstraint, Uuid, text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, JSONType, money, text, ts, uuid_pk

BIZ = "businesses.id"


class OrderRow(Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("business_id", "number"),
        CheckConstraint("status in ('pending','preparing','ready','completed','cancelled')", name="status"),
        CheckConstraint("payment_status in ('unpaid','partially_paid','paid')", name="payment_status"),
        CheckConstraint("refund_status in ('none','partially_refunded','refunded')", name="refund_status"),
        CheckConstraint("origin in ('online','offline')", name="origin"),
        CheckConstraint("version >= 1", name="version"),
        CheckConstraint("total >= 0 and subtotal >= 0 and discount_total >= 0", name="totals"),
        Index("ix_orders_business_status", "business_id", "status"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    number: Mapped[str | None] = text(20, nullable=True)
    offline_ref: Mapped[str | None] = text(40, nullable=True)
    origin: Mapped[str] = text(10)
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id", ondelete="RESTRICT"))
    cashier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    customer_name: Mapped[str | None] = text(120, nullable=True)
    order_type: Mapped[str] = text(12)
    tag: Mapped[str | None] = text(40, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = text(12)
    payment_status: Mapped[str] = text(16)
    refund_status: Mapped[str] = text(20)
    version: Mapped[int] = mapped_column(Integer)
    subtotal: Mapped[Decimal] = money()
    discount_total: Mapped[Decimal] = money()
    net_amount: Mapped[Decimal] = money()
    tax_name: Mapped[str] = text(40)
    tax_rate: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    tax_mode: Mapped[str | None] = text(10, nullable=True)
    tax_amount: Mapped[Decimal] = money()
    tax_breakdown: Mapped[list] = mapped_column(JSONType)
    total: Mapped[Decimal] = money()
    reservation: Mapped[dict] = mapped_column(JSONType)  # frozen reserved quantities (R4.5)
    idempotency_key: Mapped[str | None] = text(80, nullable=True)
    created_at: Mapped[datetime] = ts(nullable=False)
    started_at: Mapped[datetime | None] = ts()
    ready_at: Mapped[datetime | None] = ts()
    completed_at: Mapped[datetime | None] = ts()
    cancelled_at: Mapped[datetime | None] = ts()
    cancel_reason: Mapped[str | None] = text(200, nullable=True)
    archived_at: Mapped[datetime | None] = ts()
    archived_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    archive_method: Mapped[str | None] = text(10, nullable=True)
    archive_reason: Mapped[str | None] = text(200, nullable=True)
    restored_at: Mapped[datetime | None] = ts()
    restored_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class OrderItemRow(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="quantity"), UniqueConstraint("order_id", "position"))
    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"))
    position: Mapped[int] = mapped_column(Integer)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"))
    product_code: Mapped[str] = text(40)
    product_name: Mapped[str] = text(120)
    tax_class: Mapped[str] = text(20)
    base_price: Mapped[Decimal] = money()
    unit_price: Mapped[Decimal] = money()
    quantity: Mapped[int] = mapped_column(Integer)
    line_total: Mapped[Decimal] = money()
    discount_allocation: Mapped[Decimal] = money()
    # Frozen at creation (0004): per-unit ingredient use + unit cost then; NULL on older orders.
    cost_snapshot: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    category_name: Mapped[str | None] = text(80, nullable=True)


class OrderItemChoiceRow(Base):
    __tablename__ = "order_item_choices"
    id: Mapped[uuid.UUID] = uuid_pk()
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id", ondelete="RESTRICT"))
    position: Mapped[int] = mapped_column(Integer)
    option_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    group_name: Mapped[str] = text(80)
    option_name: Mapped[str] = text(80)
    price_delta: Mapped[Decimal] = money()


class OrderDiscountRow(Base):
    __tablename__ = "order_discounts"
    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), unique=True)
    discount_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("discounts.id", ondelete="RESTRICT"))
    name: Mapped[str] = text(80)
    type: Mapped[str] = text(12)
    value: Mapped[Decimal] = money()
    eligibility: Mapped[str] = text(12)
    eligibility_label: Mapped[str] = text(60)
    min_order: Mapped[Decimal | None] = money(nullable=True)
    max_discount: Mapped[Decimal | None] = money(nullable=True)
    amount: Mapped[Decimal] = money()
    requires_identification: Mapped[bool] = mapped_column(Boolean)
    # Personal data (⚖ VR-7): stored only when the discount requires it; never logged/evented.
    customer_name: Mapped[str | None] = text(120, nullable=True)
    id_type: Mapped[str | None] = text(60, nullable=True)
    id_number: Mapped[str | None] = text(80, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class PaymentRow(Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("order_id", "idempotency_key"),
        CheckConstraint("amount > 0", name="amount"),
        CheckConstraint("change_given is null or change_given >= 0", name="change"),
        CheckConstraint("tendered is null or tendered >= amount", name="tendered"),
        CheckConstraint("method in ('cash','gcash','card','bank_transfer')", name="method"),
        CheckConstraint("status in ('pending','completed','voided')", name="status"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"))
    method: Mapped[str] = text(16)
    amount: Mapped[Decimal] = money()
    tendered: Mapped[Decimal | None] = money(nullable=True)
    change_given: Mapped[Decimal | None] = money(nullable=True)
    rounding_adjustment: Mapped[Decimal] = money()
    reference: Mapped[str | None] = text(40, nullable=True)
    status: Mapped[str] = text(12)
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    confirmed_at: Mapped[datetime | None] = ts()
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    idempotency_key: Mapped[str] = text(80)
    origin: Mapped[str] = text(10)
    created_at: Mapped[datetime] = ts(nullable=False)


class RefundRow(Base):
    __tablename__ = "refunds"
    __table_args__ = (UniqueConstraint("order_id", "idempotency_key"), CheckConstraint("amount > 0", name="amount"))
    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"))
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id", ondelete="RESTRICT"), nullable=True)
    kind: Mapped[str] = text(10)
    amount: Mapped[Decimal] = money()
    reason: Mapped[str] = text(200)
    method: Mapped[str | None] = text(16, nullable=True)  # how money is returned: ⚠ OPEN Q-REF-2
    restocked: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    idempotency_key: Mapped[str] = text(80)
    created_at: Mapped[datetime] = ts(nullable=False)


class RefundLineRow(Base):
    __tablename__ = "refund_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="quantity"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    refund_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("refunds.id", ondelete="RESTRICT"))
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id", ondelete="RESTRICT"))
    quantity: Mapped[int] = mapped_column(Integer)


class RefundAllocationRow(Base):
    __tablename__ = "refund_allocations"
    __table_args__ = (CheckConstraint("amount > 0", name="amount"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    refund_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("refunds.id", ondelete="RESTRICT"))
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id", ondelete="RESTRICT"))
    amount: Mapped[Decimal] = money()
    method: Mapped[str] = text(16)  # method of the payment being refunded
    reference: Mapped[str | None] = text(40, nullable=True)


class DocumentSeriesRow(Base):
    __tablename__ = "document_series"
    __table_args__ = (
        CheckConstraint("document_type in ('sales','refund')", name="document_type"),
        CheckConstraint("scope in ('business','terminal')", name="scope"),
        CheckConstraint("start_number >= 1 and next_number >= start_number", name="numbers"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    document_type: Mapped[str] = text(10)
    scope: Mapped[str] = text(10)
    format_template: Mapped[str] = text(60)
    start_number: Mapped[int] = mapped_column(Integer)
    next_number: Mapped[int] = mapped_column(Integer)
    range_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("terminals.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class DocumentRow(Base):
    __tablename__ = "documents"
    __table_args__ = (
        UniqueConstraint("series_id", "number"),
        Index("uq_documents_sales_order", "order_id", unique=True, postgresql_where=sql_text("document_type = 'sales'")),
        CheckConstraint("status in ('issued','partially_refunded','refunded','void')", name="status"),
        CheckConstraint("print_count >= 0", name="print_count"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey(BIZ, ondelete="RESTRICT"))
    document_type: Mapped[str] = text(10)
    series_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("document_series.id", ondelete="RESTRICT"))
    number: Mapped[str] = text(60)
    order_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), nullable=True)
    refund_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    issued_at: Mapped[datetime] = ts(nullable=False)
    issued_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    status: Mapped[str] = text(20)
    print_count: Mapped[int] = mapped_column(Integer, default=0)
    last_printed_at: Mapped[datetime | None] = ts()
    snapshot: Mapped[dict] = mapped_column(JSONType)


class DocumentPrintRow(Base):
    __tablename__ = "document_prints"
    __table_args__ = (UniqueConstraint("document_id", "print_number"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id", ondelete="RESTRICT"))
    print_number: Mapped[int] = mapped_column(Integer)
    is_reprint: Mapped[bool] = mapped_column(Boolean)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    terminal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"))
    printed_at: Mapped[datetime] = ts(nullable=False)
