"""Order aggregate persistence (orders, items, choices, discount, payments, refunds)."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.archive import ArchiveMethod
from app.domain.discount import DiscountType, Eligibility, IdentificationDetails, OrderDiscount
from app.domain.inventory import ReservationPlan, StockKey, SubjectType
from app.domain.money import Money
from app.domain.order import (
    Attribution, Order, OrderItem, OrderItemChoice, OrderOrigin, OrderStatus, OrderTotals, OrderType,
)
from app.domain.payment import Payment, PaymentMethod, PaymentOrigin, PaymentRecordStatus
from app.domain.pricing import TaxBreakdownEntry
from app.domain.refund import Refund, RefundAllocation, RefundKind, RefundLine
from app.domain.tax import TaxClass, TaxMode
from app.models import (
    OrderDiscountRow, OrderItemChoiceRow, OrderItemRow, OrderRow, PaymentRow, RefundAllocationRow, RefundLineRow,
    RefundRow,
)

_LIFECYCLE = ("started_at", "ready_at", "completed_at", "cancelled_at", "cancel_reason", "archived_at",
              "archive_reason", "restored_at")


def _u(value: str | None) -> uuid.UUID | None:
    return uuid.UUID(value) if value else None


def _s(value: uuid.UUID | None) -> str | None:
    return str(value) if value else None


def _money(value: Decimal | None, currency: str) -> Money | None:
    return Money.of(value, currency) if value is not None else None


def reservation_to_json(plan: ReservationPlan) -> dict[str, str]:
    return {f"{k.subject_type.value}:{k.subject_id}": str(q) for k, q in plan.quantities.items()}


def reservation_from_json(data: dict[str, str]) -> ReservationPlan:
    quantities = {}
    for key, qty in data.items():
        subject_type, subject_id = key.split(":", 1)
        quantities[StockKey(SubjectType(subject_type), subject_id)] = Decimal(qty)
    return ReservationPlan(quantities)


class OrderRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    # --- create ------------------------------------------------------------------------------------------
    def insert(self, business_id: uuid.UUID, order: Order, idempotency_key: str | None,
               item_extras: dict[str, dict] | None = None) -> OrderRow:
        """``item_extras``: per item id, the frozen cost snapshot and category name (0004)."""
        t = order.totals
        row = OrderRow(
            id=uuid.UUID(order.id), business_id=business_id, number=order.number, offline_ref=order.offline_ref,
            origin=order.origin.value, terminal_id=uuid.UUID(order.attribution.terminal_id),
            session_id=uuid.UUID(order.attribution.session_id), cashier_id=uuid.UUID(order.attribution.cashier_id),
            customer_name=order.customer_name, order_type=order.order_type.value, tag=order.tag, note=order.note,
            status=order.status.value, payment_status=order.payment_status.value,
            refund_status=order.refund_status.value, version=order.version, subtotal=t.subtotal.amount,
            discount_total=t.discount_total.amount, net_amount=t.net_amount.amount, tax_name=t.tax_name,
            tax_rate=t.tax_rate, tax_mode=t.tax_mode.value if t.tax_mode else None, tax_amount=t.tax_amount.amount,
            tax_breakdown=[{"tax_class": e.tax_class.value, "taxable_amount": str(e.taxable_amount.amount),
                            "tax_amount": str(e.tax_amount.amount)} for e in t.tax_breakdown],
            total=t.total.amount, reservation=reservation_to_json(order.reservation), idempotency_key=idempotency_key,
            created_at=order.created_at,
        )
        self.s.add(row)
        self.s.flush()
        for position, item in enumerate(order.items):
            item_row = OrderItemRow(
                id=uuid.UUID(item.id), order_id=row.id, position=position, product_id=uuid.UUID(item.product_id),
                product_code=item.product_code, product_name=item.product_name, tax_class=item.tax_class.value,
                base_price=item.base_price.amount, unit_price=item.unit_price.amount, quantity=item.quantity,
                line_total=item.line_total.amount,
                discount_allocation=(item.discount_allocation or Money.zero(order.currency)).amount,
                **(item_extras or {}).get(item.id, {}))
            self.s.add(item_row)
            if item.choices:
                # No ORM relationship links the rows, so the unit of work does not order these
                # inserts: write the item before its choice snapshots (FK order_item_id).
                self.s.flush()
            for c_pos, choice in enumerate(item.choices):
                self.s.add(OrderItemChoiceRow(order_item_id=item_row.id, position=c_pos,
                                              option_id=_u(choice.option_id), group_name=choice.group_name,
                                              option_name=choice.option_name, price_delta=choice.price_delta.amount))
        if order.discount is not None:
            d, ident = order.discount, order.discount.identification
            self.s.add(OrderDiscountRow(
                order_id=row.id, discount_id=uuid.UUID(d.discount_id), name=d.name, type=d.type.value, value=d.value,
                eligibility=d.eligibility.value, eligibility_label=d.eligibility_label,
                min_order=d.min_order.amount if d.min_order else None,
                max_discount=d.max_discount.amount if d.max_discount else None, amount=d.amount.amount,
                requires_identification=d.requires_identification,
                customer_name=ident.customer_name if ident else None, id_type=ident.id_type if ident else None,
                id_number=ident.id_number if ident else None, approved_by=_u(d.approved_by)))
        self.s.flush()
        return row

    # --- load ----------------------------------------------------------------------------------------------------
    def row(self, order_id: uuid.UUID, *, lock: bool = False) -> OrderRow | None:
        stmt = select(OrderRow).where(OrderRow.id == order_id)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def load(self, order_id: uuid.UUID, currency: str, *, lock: bool = False) -> tuple[OrderRow, Order] | None:
        row = self.row(order_id, lock=lock)
        if row is None:
            return None
        return row, self.to_domain(row, currency)

    def to_domain(self, row: OrderRow, currency: str) -> Order:
        return self.to_domain_many([row], currency)[0]

    def to_domain_many(self, rows: list[OrderRow], currency: str) -> list[Order]:
        """Rehydrate several orders with one query per child table (no per-order queries)."""
        if not rows:
            return []
        c = currency
        ids = [r.id for r in rows]
        item_rows = list(self.s.scalars(select(OrderItemRow).where(OrderItemRow.order_id.in_(ids))
                                        .order_by(OrderItemRow.order_id, OrderItemRow.position)))
        choice_rows = list(self.s.scalars(select(OrderItemChoiceRow).where(
            OrderItemChoiceRow.order_item_id.in_([i.id for i in item_rows])).order_by(OrderItemChoiceRow.position))
        ) if item_rows else []
        discount_rows = {d.order_id: d for d in self.s.scalars(
            select(OrderDiscountRow).where(OrderDiscountRow.order_id.in_(ids)))}
        payment_rows = list(self.s.scalars(select(PaymentRow).where(PaymentRow.order_id.in_(ids))
                                           .order_by(PaymentRow.created_at, PaymentRow.id)))
        refund_rows = list(self.s.scalars(select(RefundRow).where(RefundRow.order_id.in_(ids))
                                          .order_by(RefundRow.created_at)))
        refund_ids = [r.id for r in refund_rows]
        line_rows = list(self.s.scalars(select(RefundLineRow).where(RefundLineRow.refund_id.in_(refund_ids)))
                         ) if refund_ids else []
        alloc_rows = list(self.s.scalars(select(RefundAllocationRow).where(
            RefundAllocationRow.refund_id.in_(refund_ids)))) if refund_ids else []
        return [self._assemble(row, c, [i for i in item_rows if i.order_id == row.id], choice_rows,
                               discount_rows.get(row.id), [p for p in payment_rows if p.order_id == row.id],
                               [r for r in refund_rows if r.order_id == row.id], line_rows, alloc_rows)
                for row in rows]

    def _assemble(self, row: OrderRow, c: str, item_rows: list, choice_rows: list, drow: OrderDiscountRow | None,
                  payment_rows: list, refund_rows: list, line_rows: list, alloc_rows: list) -> Order:
        items = tuple(OrderItem(
            id=str(i.id), product_id=str(i.product_id), product_code=i.product_code, product_name=i.product_name,
            tax_class=TaxClass(i.tax_class), base_price=Money.of(i.base_price, c), unit_price=Money.of(i.unit_price, c),
            quantity=i.quantity, line_total=Money.of(i.line_total, c),
            choices=tuple(OrderItemChoice(_s(ch.option_id), ch.group_name, ch.option_name, Money.of(ch.price_delta, c))
                          for ch in choice_rows if ch.order_item_id == i.id),
            discount_allocation=Money.of(i.discount_allocation, c)) for i in item_rows)
        discount = None
        if drow is not None:
            ident = (IdentificationDetails(drow.customer_name, drow.id_type, drow.id_number)
                     if drow.requires_identification else None)
            discount = OrderDiscount(
                discount_id=str(drow.discount_id), name=drow.name, type=DiscountType(drow.type), value=Decimal(drow.value),
                eligibility=Eligibility(drow.eligibility), eligibility_label=drow.eligibility_label,
                min_order=_money(drow.min_order, c), max_discount=_money(drow.max_discount, c),
                amount=Money.of(drow.amount, c), requires_identification=drow.requires_identification,
                identification=ident, approved_by=_s(drow.approved_by))
        totals = OrderTotals(
            subtotal=Money.of(row.subtotal, c), discount_total=Money.of(row.discount_total, c),
            net_amount=Money.of(row.net_amount, c), tax_amount=Money.of(row.tax_amount, c),
            tax_breakdown=tuple(TaxBreakdownEntry(TaxClass(e["tax_class"]), Money.of(e["taxable_amount"], c),
                                                  Money.of(e["tax_amount"], c)) for e in row.tax_breakdown),
            total=Money.of(row.total, c), tax_name=row.tax_name, tax_rate=row.tax_rate,
            tax_mode=TaxMode(row.tax_mode) if row.tax_mode else None)
        payments = [self._payment(p, c) for p in payment_rows]
        refunds = [self._refund(r, c, [l for l in line_rows if l.refund_id == r.id],
                                [a for a in alloc_rows if a.refund_id == r.id]) for r in refund_rows]
        lifecycle: dict[str, object] = {name: getattr(row, name) for name in _LIFECYCLE}
        lifecycle["archived_by"] = _s(row.archived_by)
        lifecycle["restored_by"] = _s(row.restored_by)
        lifecycle["archive_method"] = ArchiveMethod(row.archive_method) if row.archive_method else None
        return Order.rehydrate(
            payments=payments, refunds=refunds, status=OrderStatus(row.status), version=row.version,
            lifecycle=lifecycle, id=str(row.id), number=row.number, origin=OrderOrigin(row.origin),
            order_type=OrderType(row.order_type), items=items, totals=totals, discount=discount,
            attribution=Attribution(str(row.terminal_id), str(row.session_id), str(row.cashier_id)),
            reservation=reservation_from_json(row.reservation), created_at=row.created_at,
            offline_ref=row.offline_ref, tag=row.tag, note=row.note, customer_name=row.customer_name)

    @staticmethod
    def _payment(p: PaymentRow, c: str) -> Payment:
        return Payment(id=str(p.id), order_id=str(p.order_id), method=PaymentMethod(p.method),
                       amount=Money.of(p.amount, c), status=PaymentRecordStatus(p.status),
                       idempotency_key=p.idempotency_key, terminal_id=str(p.terminal_id), user_id=str(p.user_id),
                       created_at=p.created_at, origin=PaymentOrigin(p.origin), tendered=_money(p.tendered, c),
                       change_given=_money(p.change_given, c), rounding_adjustment=Money.of(p.rounding_adjustment, c),
                       reference=p.reference, confirmed_by=_s(p.confirmed_by), confirmed_at=p.confirmed_at)

    @staticmethod
    def _refund(r: RefundRow, c: str, lines: list, allocs: list) -> Refund:
        return Refund(id=str(r.id), order_id=str(r.order_id), kind=RefundKind(r.kind), amount=Money.of(r.amount, c),
                      reason=r.reason, allocations=tuple(RefundAllocation(str(a.payment_id), Money.of(a.amount, c),
                                                                          PaymentMethod(a.method), a.reference)
                                                         for a in allocs),
                      user_id=str(r.user_id), terminal_id=str(r.terminal_id), idempotency_key=r.idempotency_key,
                      created_at=r.created_at, lines=tuple(RefundLine(str(l.order_item_id), l.quantity) for l in lines),
                      document_id=_s(r.document_id), approved_by=_s(r.approved_by), restocked=r.restocked)

    # --- save --------------------------------------------------------------------------------------------------------
    def save(self, row: OrderRow, order: Order) -> None:
        """Persist state changes of an order loaded with ``lock=True``. Existing payments may only
        change status (pending → completed/voided); refunds are append-only."""
        row.status, row.version = order.status.value, order.version
        row.payment_status, row.refund_status = order.payment_status.value, order.refund_status.value
        for name in _LIFECYCLE:
            setattr(row, name, getattr(order, name))
        row.archived_by, row.restored_by = _u(order.archived_by), _u(order.restored_by)
        row.archive_method = order.archive_method.value if order.archive_method else None
        existing = {p.id: p for p in self.s.scalars(select(PaymentRow).where(PaymentRow.order_id == row.id))}
        for p in order.payments:
            pid = uuid.UUID(p.id)
            if pid in existing:
                prow = existing[pid]
                if prow.status != p.status.value:
                    prow.status, prow.confirmed_by, prow.confirmed_at = p.status.value, _u(p.confirmed_by), p.confirmed_at
                continue
            self.s.add(PaymentRow(
                id=pid, order_id=row.id, method=p.method.value, amount=p.amount.amount,
                tendered=p.tendered.amount if p.tendered else None,
                change_given=p.change_given.amount if p.change_given else None,
                rounding_adjustment=p.rounding_adjustment.amount if p.rounding_adjustment else Decimal("0"),
                reference=p.reference, status=p.status.value, confirmed_by=_u(p.confirmed_by),
                confirmed_at=p.confirmed_at, terminal_id=uuid.UUID(p.terminal_id), user_id=uuid.UUID(p.user_id),
                idempotency_key=p.idempotency_key, origin=p.origin.value, created_at=p.created_at))
        known_refunds = set(self.s.scalars(select(RefundRow.id).where(RefundRow.order_id == row.id)))
        for r in order.refunds:
            rid = uuid.UUID(r.id)
            if rid in known_refunds:
                continue
            self.s.add(RefundRow(id=rid, order_id=row.id, document_id=_u(r.document_id), kind=r.kind.value,
                                 amount=r.amount.amount, reason=r.reason, method=None, restocked=r.restocked,
                                 approved_by=_u(r.approved_by), user_id=uuid.UUID(r.user_id),
                                 terminal_id=uuid.UUID(r.terminal_id), idempotency_key=r.idempotency_key,
                                 created_at=r.created_at))
            self.s.flush()
            for line in r.lines:
                self.s.add(RefundLineRow(refund_id=rid, order_item_id=uuid.UUID(line.order_item_id),
                                         quantity=line.quantity))
            for a in r.allocations:
                self.s.add(RefundAllocationRow(refund_id=rid, payment_id=uuid.UUID(a.payment_id),
                                               amount=a.amount.amount, method=a.method.value, reference=a.reference))
        self.s.flush()

    # --- queries -------------------------------------------------------------------------------------------------------
    def list(self, business_id: uuid.UUID, *, statuses: list[str] | None = None, archived: bool | None = None,
             limit: int = 100, since: datetime | None = None) -> list[OrderRow]:
        stmt = select(OrderRow).where(OrderRow.business_id == business_id)
        if statuses:
            stmt = stmt.where(OrderRow.status.in_(statuses))
        if archived is True:
            stmt = stmt.where(OrderRow.archived_at.is_not(None))
        elif archived is False:
            stmt = stmt.where(OrderRow.archived_at.is_(None))
        if since is not None:
            stmt = stmt.where(OrderRow.created_at >= since)
        return list(self.s.scalars(stmt.order_by(OrderRow.created_at.desc()).limit(limit)))

    def items(self, order_id: uuid.UUID) -> list[OrderItemRow]:
        return list(self.s.scalars(select(OrderItemRow).where(OrderItemRow.order_id == order_id)
                                   .order_by(OrderItemRow.position)))
