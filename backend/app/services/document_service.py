"""Sales documents (Q-RCP-1, Q-RCP-2; BUSINESS-RULES §8). The number comes from a row-locked
document series inside the settling transaction; reprints keep the number. No BIR/legal
compliance is claimed; titles/mandatory content are compliance configuration (⚖ VR-3)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found
from app.domain.document import Document
from app.domain.identity import PermissionKey
from app.domain.order import Order
from app.models import DocumentPrintRow, DocumentRow, UserRow
from app.repositories.document_repository import DocumentRepository
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, now, parse_uuid


def _snapshot(session: Session, order: Order, actor: Actor) -> dict[str, Any]:
    system = SystemRepository(session)
    business = system.business()
    assert business is not None
    compliance = system.settings(actor.business_id, "compliance")
    receipts = system.settings(actor.business_id, "receipts")
    terminal = StaffRepository(session).terminal(actor.terminal_id) if actor.terminal_id else None
    t = order.totals
    return {
        "document_title": (compliance.data if compliance else {}).get("sales_document_title"),
        "business": {"name": business.name, "address": business.address, "phone": business.phone,
                     "email": business.email},
        "order": {"number": order.number, "type": order.order_type.value, "tag": order.tag},
        "items": [{"name": i.product_name, "code": i.product_code, "quantity": i.quantity,
                   "unit_price": str(i.unit_price.amount), "line_total": str(i.line_total.amount),
                   "choices": [{"group": c.group_name, "option": c.option_name, "price_delta": str(c.price_delta.amount)}
                               for c in i.choices]} for i in order.items],
        # Identification values are not printed unless a compliance setting allows it (⚖ VR-2/VR-7).
        "discount": {"name": order.discount.name, "amount": str(order.discount.amount.amount)} if order.discount else None,
        "totals": {"subtotal": str(t.subtotal.amount), "discount_total": str(t.discount_total.amount),
                   "net_amount": str(t.net_amount.amount), "tax_amount": str(t.tax_amount.amount),
                   "total": str(t.total.amount), "tax_name": t.tax_name,
                   "tax_rate": str(t.tax_rate) if t.tax_rate is not None else None,
                   "tax_mode": t.tax_mode.value if t.tax_mode else None,
                   "tax_breakdown": [{"tax_class": e.tax_class.value, "taxable_amount": str(e.taxable_amount.amount),
                                      "tax_amount": str(e.tax_amount.amount)} for e in t.tax_breakdown]},
        "payments": [{"method": p.method.value, "amount": str(p.amount.amount), "reference": p.reference,
                      "tendered": str(p.tendered.amount) if p.tendered else None,
                      "change": str(p.change_given.amount) if p.change_given else None,
                      "rounding_adjustment": str(p.rounding_adjustment.amount) if p.rounding_adjustment else "0.00"}
                     for p in order.payments if p.status.value == "completed"],
        "cashier": actor.full_name,
        "terminal": terminal.code if terminal else None,
        "display": dict(receipts.data) if receipts else None,
    }


def issue_sales_document(session: Session, actor: Actor, order: Order) -> DocumentRow:
    """Called inside the settling payment/confirmation transaction (R7.12, R8.2)."""
    system, docs = SystemRepository(session), DocumentRepository(session)
    terminal_id = actor.require_terminal()
    series_row = system.lock_series(actor.business_id, "sales", terminal_id)
    if series_row is None:
        raise AppError("SETTINGS_REQUIRED", 409, "No active sales document series is configured",
                       {"section": "compliance"})
    series = docs.series_to_domain(series_row)
    with domain_errors():
        document = Document.issue(series, id=str(uuid.uuid4()), issued_at=now(), issued_by=str(actor.user_id),
                                  terminal_id=str(terminal_id), snapshot=_snapshot(session, order, actor),
                                  order_id=order.id)
    row = docs.insert(actor.business_id, series_row, series, document)
    audit(system, actor, actor.business_id, "document.issued", "document", row.id, after={"number": row.number})
    return row


def document_dto(row: DocumentRow, prints: list[DocumentPrintRow] | None = None) -> dict[str, Any]:
    dto = {"id": str(row.id), "document_type": row.document_type, "number": row.number,
           "order_id": str(row.order_id) if row.order_id else None, "issued_at": row.issued_at, "status": row.status,
           "print_count": row.print_count, "snapshot": row.snapshot}
    if prints is not None:
        dto["prints"] = [{"print_number": p.print_number, "is_reprint": p.is_reprint, "printed_at": p.printed_at,
                          "actor_id": str(p.actor_id)} for p in prints]
    return dto


def list_documents(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.RECEIPTS_VIEW)
    return [document_dto(r) for r in DocumentRepository(session).list(actor.business_id)]


def get_document(session: Session, actor: Actor, document_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.RECEIPTS_VIEW)
    docs = DocumentRepository(session)
    row = docs.row(parse_uuid(document_id, "document"))
    if row is None or row.business_id != actor.business_id:
        raise not_found("document")
    return document_dto(row, docs.prints(row.id))


def print_document(session: Session, actor: Actor, document_id: str) -> dict[str, Any]:
    """Print or reprint: same number and content, print_count + 1, DocumentPrint + audit (R8.7)."""
    actor.require(PermissionKey.RECEIPTS_REPRINT)
    terminal_id = actor.require_terminal()
    docs, system = DocumentRepository(session), SystemRepository(session)
    row = docs.row(parse_uuid(document_id, "document"), lock=True)
    if row is None or row.business_id != actor.business_id:
        raise not_found("document")
    document = docs.to_domain(row)
    record = document.record_print(actor_id=str(actor.user_id), terminal_id=str(terminal_id), at=now())
    row.print_count, row.last_printed_at = document.print_count, record.printed_at
    session.add(DocumentPrintRow(document_id=row.id, print_number=record.print_number, is_reprint=record.is_reprint,
                                 actor_id=actor.user_id, terminal_id=terminal_id, printed_at=record.printed_at))
    session.flush()
    audit(system, actor, actor.business_id, "document.reprinted" if record.is_reprint else "document.printed",
          "document", row.id, after={"print_number": record.print_number})
    return document_dto(row, docs.prints(row.id))


_ = (UserRow, emit)
