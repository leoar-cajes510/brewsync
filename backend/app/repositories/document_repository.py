"""Sales/refund documents, series and prints."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.document import Document, DocumentSeries, DocumentStatus, DocumentType, SeriesScope
from app.models import DocumentPrintRow, DocumentRow, DocumentSeriesRow


class DocumentRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    @staticmethod
    def series_to_domain(row: DocumentSeriesRow) -> DocumentSeries:
        return DocumentSeries(id=str(row.id), document_type=DocumentType(row.document_type), scope=SeriesScope(row.scope),
                              format_template=row.format_template, start_number=row.start_number,
                              next_number=row.next_number, range_end=row.range_end,
                              terminal_id=str(row.terminal_id) if row.terminal_id else None, active=row.active)

    def insert(self, business_id: uuid.UUID, series_row: DocumentSeriesRow, series: DocumentSeries,
               document: Document) -> DocumentRow:
        series_row.next_number = series.next_number
        row = DocumentRow(id=uuid.UUID(document.id), business_id=business_id,
                          document_type=document.document_type.value, series_id=series_row.id, number=document.number,
                          order_id=uuid.UUID(document.order_id) if document.order_id else None,
                          refund_id=uuid.UUID(document.refund_id) if document.refund_id else None,
                          issued_at=document.issued_at, issued_by=uuid.UUID(document._issued_by),
                          terminal_id=uuid.UUID(document._terminal_id), status=document.status.value,
                          print_count=document.print_count, snapshot=dict(_thaw(document.snapshot)))
        self.s.add(row)
        self.s.flush()
        return row

    def row(self, document_id: uuid.UUID, *, lock: bool = False) -> DocumentRow | None:
        stmt = select(DocumentRow).where(DocumentRow.id == document_id)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def for_order(self, order_id: uuid.UUID, document_type: str = "sales") -> DocumentRow | None:
        return self.s.scalars(select(DocumentRow).where(DocumentRow.order_id == order_id,
                                                        DocumentRow.document_type == document_type)).first()

    def for_orders(self, order_ids: list[uuid.UUID], document_type: str = "sales") -> dict[uuid.UUID, DocumentRow]:
        """Batched ``for_order``: one query for many orders, keyed by order id."""
        if not order_ids:
            return {}
        rows = self.s.scalars(select(DocumentRow).where(DocumentRow.order_id.in_(order_ids),
                                                        DocumentRow.document_type == document_type))
        found: dict[uuid.UUID, DocumentRow] = {}
        for row in rows:
            found.setdefault(row.order_id, row)
        return found

    def list(self, business_id: uuid.UUID, limit: int = 100) -> list[DocumentRow]:
        return list(self.s.scalars(select(DocumentRow).where(DocumentRow.business_id == business_id)
                                   .order_by(DocumentRow.issued_at.desc()).limit(limit)))

    @staticmethod
    def to_domain(row: DocumentRow) -> Document:
        doc = Document(id=str(row.id), document_type=DocumentType(row.document_type), series_id=str(row.series_id),
                       number=row.number, issued_at=row.issued_at, issued_by=str(row.issued_by),
                       terminal_id=str(row.terminal_id), snapshot=row.snapshot,
                       order_id=str(row.order_id) if row.order_id else None,
                       refund_id=str(row.refund_id) if row.refund_id else None)
        doc.status, doc.print_count = DocumentStatus(row.status), row.print_count
        return doc

    def prints(self, document_id: uuid.UUID) -> list[DocumentPrintRow]:
        return list(self.s.scalars(select(DocumentPrintRow).where(DocumentPrintRow.document_id == document_id)
                                   .order_by(DocumentPrintRow.print_number)))


def _thaw(value):  # type: ignore[no-untyped-def]
    """Frozen snapshot (MappingProxy/tuples) → plain JSON-compatible structures."""
    from collections.abc import Mapping
    if isinstance(value, Mapping):
        return {k: _thaw(v) for k, v in value.items()}
    if isinstance(value, tuple):
        return [_thaw(v) for v in value]
    return value
