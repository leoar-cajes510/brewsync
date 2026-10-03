"""Sales / refund documents, series and prints (BUSINESS-RULES §8; Q-RCP-1, Q-RCP-2).

"Sales document" is the neutral term (UI label "Receipt"); the title/type is configured
in compliance settings and "Official Receipt" is not assumed. No BIR/legal compliance is
claimed (⚖ VR-3). Offline document numbering is ⚠ OPEN (Q-RCP-5); series reset policy
and void rules depend on verification and are not implemented.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from .errors import DocumentSeriesExhausted, ImmutableRecordError, UndecidedPolicy, ValidationError
from .records import freeze


class DocumentType(StrEnum):
    SALES = "sales"
    REFUND = "refund"


class DocumentStatus(StrEnum):
    ISSUED = "issued"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"
    VOID = "void"


class SeriesScope(StrEnum):
    BUSINESS = "business"
    TERMINAL = "terminal"


class DocumentSeries:
    """A configurable numbering series. Allocation happens inside the issuing transaction
    with a row lock (service layer); gap-free within a series is a design goal."""

    def __init__(self, *, id: str, document_type: DocumentType, scope: SeriesScope, format_template: str,
                 start_number: int, next_number: int | None = None, range_end: int | None = None,
                 terminal_id: str | None = None, active: bool = True) -> None:
        if "{number" not in format_template:
            raise ValidationError("format template must contain {number}")
        try:
            format_template.format(number=start_number)
        except (KeyError, ValueError, IndexError) as exc:
            raise ValidationError(f"invalid format template: {exc}") from exc
        if start_number < 1:
            raise ValidationError("start number must be ≥ 1")
        if range_end is not None and range_end < start_number:
            raise ValidationError("range end must be ≥ start number")
        if (scope is SeriesScope.TERMINAL) != (terminal_id is not None):
            raise ValidationError("terminal-scoped series need a terminal_id (and only they)")
        self.id = id
        self.document_type = document_type
        self.scope = scope
        self.format_template = format_template
        self.start_number = start_number
        self.next_number = start_number if next_number is None else next_number
        self.range_end = range_end
        self.terminal_id = terminal_id
        self.active = active

    def allocate(self) -> tuple[int, str]:
        if not self.active:
            raise ValidationError("document series is inactive")
        if self.range_end is not None and self.next_number > self.range_end:
            raise DocumentSeriesExhausted(f"series {self.id} reached {self.range_end}")
        number = self.next_number
        self.next_number += 1
        return number, self.format_template.format(number=number)


@dataclass(frozen=True, slots=True)
class DocumentPrint:
    """One print or reprint of a document (never creates a new number or transaction)."""

    document_id: str
    print_number: int
    is_reprint: bool
    actor_id: str
    terminal_id: str
    printed_at: datetime


class Document:
    def __init__(self, *, id: str, document_type: DocumentType, series_id: str, number: str,
                 issued_at: datetime, issued_by: str, terminal_id: str, snapshot: Mapping[str, object],
                 order_id: str | None = None, refund_id: str | None = None) -> None:
        if document_type is DocumentType.SALES and (not order_id or refund_id):
            raise ValidationError("a sales document belongs to one order")
        if document_type is DocumentType.REFUND and not refund_id:
            raise ValidationError("a refund document belongs to one refund")
        self._id = id
        self._document_type = document_type
        self._series_id = series_id
        self._number = number
        self._issued_at = issued_at
        self._issued_by = issued_by
        self._terminal_id = terminal_id
        self._order_id = order_id
        self._refund_id = refund_id
        self._snapshot: Mapping[str, object] = freeze(copy.deepcopy(dict(snapshot)))
        self.status = DocumentStatus.ISSUED
        self.print_count = 0

    @classmethod
    def issue(cls, series: DocumentSeries, *, id: str, issued_at: datetime, issued_by: str, terminal_id: str,
              snapshot: Mapping[str, object], order_id: str | None = None,
              refund_id: str | None = None) -> Document:
        if series.document_type is DocumentType.SALES and order_id is None:
            raise ValidationError("sales documents need an order")
        if series.scope is SeriesScope.TERMINAL and series.terminal_id != terminal_id:
            raise ValidationError("terminal-scoped series belongs to another terminal")
        _, number = series.allocate()
        return cls(id=id, document_type=series.document_type, series_id=series.id, number=number,
                   issued_at=issued_at, issued_by=issued_by, terminal_id=terminal_id, snapshot=snapshot,
                   order_id=order_id, refund_id=refund_id)

    # read-only identity and content
    id = property(lambda self: self._id)
    document_type = property(lambda self: self._document_type)
    series_id = property(lambda self: self._series_id)
    number = property(lambda self: self._number)
    issued_at = property(lambda self: self._issued_at)
    order_id = property(lambda self: self._order_id)
    refund_id = property(lambda self: self._refund_id)
    snapshot = property(lambda self: self._snapshot)

    def record_print(self, *, actor_id: str, terminal_id: str, at: datetime) -> DocumentPrint:
        """Print/reprint: same number and content; print_count += 1 (R8.7)."""
        is_reprint = self.print_count > 0
        self.print_count += 1
        return DocumentPrint(self._id, self.print_count, is_reprint, actor_id, terminal_id, at)

    def mark_refunded(self, *, fully: bool) -> None:
        if self.status is DocumentStatus.VOID:
            raise ImmutableRecordError("void documents cannot change")
        if self.status is DocumentStatus.REFUNDED:
            raise ImmutableRecordError("document is already fully refunded")
        self.status = DocumentStatus.REFUNDED if fully else DocumentStatus.PARTIALLY_REFUNDED

    def void(self) -> None:
        raise UndecidedPolicy("VR-3", "voiding a sales document depends on verified document rules")

