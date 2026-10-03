import unittest

from domain_support import T0
from app.domain.document import Document, DocumentSeries, DocumentStatus, DocumentType, SeriesScope
from app.domain.errors import DocumentSeriesExhausted, ImmutableRecordError, UndecidedPolicy, ValidationError


def series(**kw):
    defaults = dict(id="ser-1", document_type=DocumentType.SALES, scope=SeriesScope.BUSINESS,
                    format_template="S-{number:06d}", start_number=1)
    defaults.update(kw)
    return DocumentSeries(**defaults)


def issue(s, order_id="o-1", snapshot=None, doc_id="doc-1"):
    return Document.issue(s, id=doc_id, issued_at=T0, issued_by="u-1", terminal_id="t-1",
                          snapshot=snapshot or {"order_number": "1045", "lines": [{"name": "Latte", "qty": 2}]},
                          order_id=order_id)


class DocumentTests(unittest.TestCase):
    def test_document_number_is_separate_from_order_number_and_sequential(self):
        s = series()
        first, second = issue(s), issue(s, "o-2", doc_id="doc-2")
        self.assertEqual((first.number, second.number), ("S-000001", "S-000002"))
        self.assertEqual(first.snapshot["order_number"], "1045")

    def test_snapshot_is_immutable_and_copied(self):
        source = {"total": "500.00", "lines": [{"name": "Latte"}]}
        doc = issue(series(), snapshot=source)
        source["total"] = "0.00"
        self.assertEqual(doc.snapshot["total"], "500.00")
        with self.assertRaises(TypeError):
            doc.snapshot["total"] = "1.00"  # type: ignore[index]
        with self.assertRaises(AttributeError):
            doc.number = "X"  # type: ignore[misc]

    def test_reprint_keeps_number_and_counts(self):
        doc = issue(series())
        original = doc.record_print(actor_id="u-1", terminal_id="t-1", at=T0)
        reprint = doc.record_print(actor_id="u-2", terminal_id="t-2", at=T0)
        self.assertEqual((original.is_reprint, reprint.is_reprint, doc.print_count), (False, True, 2))
        self.assertEqual(doc.number, "S-000001")

    def test_refund_status_and_void_is_verification_gated(self):
        doc = issue(series())
        doc.mark_refunded(fully=False)
        self.assertEqual(doc.status, DocumentStatus.PARTIALLY_REFUNDED)
        doc.mark_refunded(fully=True)
        with self.assertRaises(ImmutableRecordError):
            doc.mark_refunded(fully=True)
        with self.assertRaises(UndecidedPolicy):
            doc.void()

    def test_series_configuration_rules(self):
        with self.assertRaises(ValidationError):
            series(format_template="S-")
        with self.assertRaises(ValidationError):
            series(scope=SeriesScope.TERMINAL)  # needs terminal_id
        s = series(start_number=9, range_end=9)
        issue(s)
        with self.assertRaises(DocumentSeriesExhausted):
            issue(s, doc_id="doc-2")
        with self.assertRaises(ValidationError):
            issue(series(scope=SeriesScope.TERMINAL, terminal_id="t-9"))  # another terminal's series
        with self.assertRaises(ValidationError):
            Document.issue(series(document_type=DocumentType.REFUND), id="d", issued_at=T0, issued_by="u",
                           terminal_id="t-1", snapshot={}, order_id="o-1")  # refund docs need a refund


if __name__ == "__main__":
    unittest.main()
