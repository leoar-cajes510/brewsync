import unittest
from datetime import date, timedelta

from domain_support import T0, m
from app.domain.compliance import RetentionSettings
from app.domain.errors import (
    IdempotencyKeyReused, InvalidStateTransition, RetentionBelowMinimum, SensitiveDataError, UndecidedPolicy,
    ValidationError, VersionConflict,
)
from app.domain.expense import Expense, ExpenseCategory, ExpensePaymentMethod, format_expense_code
from app.domain.records import (
    AuditLog, ConflictReason, DomainEvent, EventType, IdempotencyRecord, OfflineSubmission, PosSnapshot, Sequence,
    SubmissionStatus,
)
from app.domain.settings import SettingsDocument, SettingsSection

TXN = "0b7c1c34-7a52-4b4e-9d7e-6d2f5c3a9e11"


class AuditAndEventTests(unittest.TestCase):
    def test_audit_is_frozen_and_rejects_sensitive_values(self):
        log = AuditLog("a-1", "discount.applied", "order", "o-1", "u-1", T0,
                       after={"discount": "Senior Citizen", "identification_captured": True})
        with self.assertRaises(TypeError):
            log.after["discount"] = "x"  # type: ignore[index]
        for bad in ({"id_number": "123"}, {"user": {"pin": "1234"}}, {"password_hash": "x"}):
            with self.assertRaises(SensitiveDataError):
                AuditLog("a-2", "x", "y", None, None, T0, after=bad)

    def test_domain_event_ordering(self):
        e = DomainEvent("ev-1", "b-1", 42, EventType.ORDER_CREATED, "order", "o-1", 3, T0, payload={"number": "1045"})
        self.assertTrue(e.is_newer_than(2) and not e.is_newer_than(3) and e.is_newer_than(None))
        with self.assertRaises(ValidationError):
            DomainEvent("ev-2", "b-1", 0, EventType.ORDER_CREATED, "order", "o-1", 1, T0)

    def test_idempotency_replay_and_reuse(self):
        rec = IdempotencyRecord("k-1", "POST /orders/{id}/payments", "hash-a", {"payment_id": "pay-1"}, T0)
        self.assertEqual(rec.replay("hash-a")["payment_id"], "pay-1")
        with self.assertRaises(IdempotencyKeyReused):
            rec.replay("hash-b")

    def test_sequence_and_expense_code(self):
        seq = Sequence("expense:2026")
        self.assertEqual([seq.next(), seq.next()], [1, 2])
        self.assertEqual(format_expense_code(2026, 7), "EXP-2026-007")


class OfflineSubmissionTests(unittest.TestCase):
    def submission(self):
        return OfflineSubmission(client_txn_id=TXN, terminal_id="t-1", user_id="u-1", captured_at=T0,
                                 received_at=T0 + timedelta(hours=2), snapshot_version=7,
                                 payload={"lines": [{"product_id": "p-1", "qty": 1}], "payments": [{"method": "cash"}]})

    def test_payload_immutable_and_states(self):
        sub = self.submission()
        with self.assertRaises(TypeError):
            sub.payload["lines"] = []  # type: ignore[index]
        sub.record_attempt()
        sub.flag_for_review((ConflictReason.INSUFFICIENT_STOCK,))
        with self.assertRaises(InvalidStateTransition):
            sub.mark_committed("o-9")  # never silently merged
        sub.resolve("Counted stock, accepted with correction", by="u-admin", at=T0)
        self.assertEqual(sub.status, SubmissionStatus.RESOLVED)
        with self.assertRaises(ValidationError):
            OfflineSubmission(client_txn_id="not-a-uuid", terminal_id="t", user_id="u", captured_at=T0,
                              received_at=T0, snapshot_version=1, payload={})

    def test_review_threshold_is_configuration(self):
        sub = self.submission()
        with self.assertRaises(ValidationError):
            sub.exceeds_review_threshold(T0, max_age=None, max_attempts=None)
        self.assertTrue(sub.exceeds_review_threshold(T0 + timedelta(hours=3), max_age=timedelta(hours=2), max_attempts=None))
        sub.record_attempt()
        self.assertFalse(sub.exceeds_review_threshold(T0, max_age=None, max_attempts=2))
        sub.record_attempt()
        self.assertTrue(sub.exceeds_review_threshold(T0, max_age=None, max_attempts=2))

    def test_pos_snapshot_frozen(self):
        snap = PosSnapshot(3, T0, {"products": [{"id": "p-1", "price": "120.00"}]})
        with self.assertRaises(TypeError):
            snap.data["products"] = ()  # type: ignore[index]


class SettingsExpenseRetentionTests(unittest.TestCase):
    def test_settings_versioning(self):
        doc = SettingsDocument(SettingsSection.PREFERENCES, {"defaultOrderType": "takeout"}, 1, None, T0)
        new = doc.updated({"defaultOrderType": "dine_in"}, expected_version=1, by="u-admin", at=T0)
        self.assertEqual(new.version, 2)
        with self.assertRaises(VersionConflict):
            doc.updated({}, expected_version=5, by="u-admin", at=T0)

    def test_expense_validation(self):
        def expense(**kw):
            base = dict(code="EXP-2026-001", category=ExpenseCategory.SUPPLIES, description="Cups",
                        amount=m("350.00"), expense_date=date(2026, 9, 28), payment_method=ExpensePaymentMethod.CASH,
                        recorded_by="u-admin", created_at=T0)
            base.update(kw)
            return Expense(**base)
        with self.assertRaises(Exception):
            expense(amount=m("0.00"))
        with self.assertRaises(ValidationError):
            expense(description="x" * 121)
        with self.assertRaises(ValidationError):
            expense(expense_date=date(2026, 9, 29)).validate_date(today=date(2026, 9, 28))
        with self.assertRaises(UndecidedPolicy):
            expense().remove()

    def test_retention_never_below_verified_minimum_and_no_disposal_before_verification(self):
        with self.assertRaises(RetentionBelowMinimum):
            RetentionSettings(timedelta(days=100), timedelta(days=200))
        self.assertFalse(RetentionSettings(timedelta(days=100)).disposal_allowed())
        with self.assertRaises(UndecidedPolicy):
            RetentionSettings(timedelta(days=300), timedelta(days=200)).disposal_allowed()


if __name__ == "__main__":
    unittest.main()
