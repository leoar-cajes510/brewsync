"""Operational records: AuditLog, IdempotencyRecord, DomainEvent, OfflineSubmission,
PosSnapshot, Sequence (SR-4, SR-7, SYSTEM-LOGIC §10–§12).

Only the domain shape and invariants live here. The transactional outbox, event
transport, sync transport and local storage belong to later phases. Exact offline scope
is ⚠ OPEN (Q-TRM-7).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum
from types import MappingProxyType

from .errors import IdempotencyKeyReused, InvalidStateTransition, SensitiveDataError, ValidationError


def freeze(value: object) -> object:
    """Recursively convert dicts to read-only mappings and lists/sets to tuples."""
    if isinstance(value, Mapping):
        return MappingProxyType({k: freeze(v) for k, v in value.items()})
    if isinstance(value, (list, tuple, set, frozenset)):
        return tuple(freeze(v) for v in value)
    return value


_SENSITIVE_SUBSTRINGS = ("password", "credential", "activation_code", "id_number", "secret", "token")


def _is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return (any(marker in lowered for marker in _SENSITIVE_SUBSTRINGS) or lowered.endswith("_hash")
            or lowered == "pin" or lowered.startswith("pin_") or lowered.endswith("_pin"))


def _assert_no_sensitive(value: object, path: str = "") -> None:
    if isinstance(value, Mapping):
        for key, inner in value.items():
            if _is_sensitive_key(str(key)):
                raise SensitiveDataError(f"sensitive field '{path}{key}' must not be recorded")
            _assert_no_sensitive(inner, f"{path}{key}.")
    elif isinstance(value, (list, tuple)):
        for inner in value:
            _assert_no_sensitive(inner, path)


# --- audit -----------------------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class AuditLog:
    """Append-only audit record. Never contains credentials or identification values (SR-7)."""

    id: str
    action: str
    entity_type: str
    entity_id: str | None
    actor_id: str | None  # None = system actor (e.g. automatic archive)
    occurred_at: datetime
    terminal_id: str | None = None
    before: Mapping[str, object] = field(default_factory=dict)
    after: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.action.strip() or not self.entity_type.strip():
            raise ValidationError("audit action and entity type are required")
        _assert_no_sensitive(self.before)
        _assert_no_sensitive(self.after)
        object.__setattr__(self, "before", freeze(self.before))
        object.__setattr__(self, "after", freeze(self.after))


# --- idempotency -----------------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class IdempotencyRecord:
    """Stored outcome of a mutation; a retry with the same key replays it (R0.9)."""

    key: str
    scope: str
    request_hash: str
    response: Mapping[str, object]
    created_at: datetime

    def __post_init__(self) -> None:
        if not self.key or not self.scope or not self.request_hash:
            raise ValidationError("idempotency key, scope and request hash are required")
        object.__setattr__(self, "response", freeze(self.response))

    def replay(self, request_hash: str) -> Mapping[str, object]:
        if request_hash != self.request_hash:
            raise IdempotencyKeyReused(f"key {self.key} was used with a different request")
        return self.response


# --- domain events -----------------------------------------------------------------------------------

class EventType(StrEnum):
    ORDER_CREATED = "order.created"
    ORDER_STATUS_CHANGED = "order.status_changed"
    ORDER_CANCELLED = "order.cancelled"
    ORDER_COMPLETED = "order.completed"
    ORDER_ARCHIVED = "order.archived"
    ORDER_RESTORED = "order.restored"
    ORDER_PAYMENT_STATUS_CHANGED = "order.payment_status_changed"
    PAYMENT_RECORDED = "payment.recorded"
    PAYMENT_CONFIRMED = "payment.confirmed"
    PAYMENT_VOIDED = "payment.voided"
    REFUND_RECORDED = "refund.recorded"
    STOCK_CHANGED = "stock.changed"
    STOCK_LOW = "stock.low"
    STOCK_OUT = "stock.out"
    ALERT_ORDER_OVERDUE = "alert.order_overdue"
    SETTINGS_CHANGED = "settings.changed"
    TERMINAL_STATUS_CHANGED = "terminal.status_changed"
    SESSION_STARTED = "session.started"
    SESSION_ENDED = "session.ended"
    STAFF_STATUS_CHANGED = "staff.status_changed"
    SYNC_REVIEW_REQUIRED = "sync.review_required"


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """A committed business event; ``sequence`` is monotonic per business stream."""

    event_id: str
    business_id: str
    sequence: int
    type: EventType
    entity_type: str
    entity_id: str
    entity_version: int
    occurred_at: datetime
    actor_id: str | None = None
    terminal_id: str | None = None
    payload: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.sequence < 1 or self.entity_version < 1:
            raise ValidationError("sequence and entity_version must be ≥ 1")
        _assert_no_sensitive(self.payload)  # payloads are minimal; never IDs/credentials
        object.__setattr__(self, "payload", freeze(self.payload))

    def is_newer_than(self, known_version: int | None) -> bool:
        """Clients apply an event only if it is newer than their local entity version."""
        return known_version is None or self.entity_version > known_version


# --- sequences ------------------------------------------------------------------------------------------

@dataclass(slots=True)
class Sequence:
    """Per-business counter (order numbers, expense codes, …); locked by the service."""

    name: str
    next_value: int = 1

    def __post_init__(self) -> None:
        if self.next_value < 1:
            raise ValidationError("sequence values start at 1")

    def next(self) -> int:
        value = self.next_value
        self.next_value += 1
        return value


# --- offline --------------------------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class PosSnapshot:
    """POS bundle for one catalog_version, retained so offline totals can be recomputed."""

    catalog_version: int
    created_at: datetime
    data: Mapping[str, object]

    def __post_init__(self) -> None:
        if self.catalog_version < 1:
            raise ValidationError("catalog_version must be ≥ 1")
        object.__setattr__(self, "data", freeze(self.data))


class SubmissionStatus(StrEnum):
    RECEIVED = "received"
    COMMITTED = "committed"
    NEEDS_REVIEW = "needs_review"
    RESOLVED = "resolved"


class ConflictReason(StrEnum):
    INVALID_PAYLOAD = "invalid_payload"
    UNKNOWN_SNAPSHOT = "unknown_snapshot"
    PRICE_MISMATCH = "price_mismatch"
    DISCOUNT_INVALID = "discount_invalid"
    NON_CASH_PAYMENT = "non_cash_payment"
    INSUFFICIENT_STOCK = "insufficient_stock"
    USER_INVALID = "user_invalid"
    PERMISSION_REVOKED = "permission_revoked"
    TERMINAL_REVOKED = "terminal_revoked"
    REVIEW_THRESHOLD_EXCEEDED = "review_threshold_exceeded"


class OfflineSubmission:
    """A queued offline transaction as received by the server. The raw payload is immutable;
    processing status, attempts and resolution are recorded alongside it."""

    def __init__(self, *, client_txn_id: str, terminal_id: str, user_id: str, captured_at: datetime,
                 received_at: datetime, snapshot_version: int, payload: Mapping[str, object]) -> None:
        try:
            uuid.UUID(client_txn_id)
        except (ValueError, TypeError) as exc:
            raise ValidationError("client_txn_id must be a UUID") from exc
        self.client_txn_id = client_txn_id
        self.terminal_id = terminal_id
        self.user_id = user_id
        self.captured_at = captured_at  # device clock: stored, not trusted (AR-5)
        self.received_at = received_at  # server time
        self.snapshot_version = snapshot_version
        self._payload = freeze(dict(payload))
        self.status = SubmissionStatus.RECEIVED
        self.attempts = 0
        self.conflict_reasons: tuple[ConflictReason, ...] = ()
        self.order_id: str | None = None
        self.resolution: str | None = None
        self.resolved_by: str | None = None
        self.resolved_at: datetime | None = None

    @property
    def payload(self) -> Mapping[str, object]:
        return self._payload  # type: ignore[return-value]

    def record_attempt(self) -> None:
        if self.status is not SubmissionStatus.RECEIVED:
            raise InvalidStateTransition(f"submission is {self.status}")
        self.attempts += 1

    def mark_committed(self, order_id: str) -> None:
        if self.status is not SubmissionStatus.RECEIVED:
            raise InvalidStateTransition(f"submission is {self.status}")
        self.status, self.order_id = SubmissionStatus.COMMITTED, order_id

    def flag_for_review(self, reasons: tuple[ConflictReason, ...]) -> None:
        """Conflicts are never merged silently: nothing is applied until an Admin resolves."""
        if self.status is not SubmissionStatus.RECEIVED:
            raise InvalidStateTransition(f"submission is {self.status}")
        if not reasons:
            raise ValidationError("at least one conflict reason is required")
        self.status, self.conflict_reasons = SubmissionStatus.NEEDS_REVIEW, reasons

    def resolve(self, resolution: str, *, by: str, at: datetime, order_id: str | None = None) -> None:
        """Explicit Admin reconciliation (sync.review), audited by the service."""
        if self.status is not SubmissionStatus.NEEDS_REVIEW:
            raise InvalidStateTransition("only submissions needing review can be resolved")
        if not resolution.strip():
            raise ValidationError("a resolution note is required")
        self.status, self.resolution = SubmissionStatus.RESOLVED, resolution
        self.resolved_by, self.resolved_at, self.order_id = by, at, order_id or self.order_id

    def exceeds_review_threshold(self, now: datetime, *, max_age: timedelta | None,
                                 max_attempts: int | None) -> bool:
        """``offline.sync_review_threshold`` (time since capture and/or failed attempts).
        Threshold values are configuration (defaults ⚠ OPEN Q-SET-4)."""
        if max_age is None and max_attempts is None:
            raise ValidationError("a review threshold needs max_age and/or max_attempts")
        if self.status is not SubmissionStatus.RECEIVED:
            return False
        too_old = max_age is not None and now - self.captured_at >= max_age
        too_many = max_attempts is not None and self.attempts >= max_attempts
        return too_old or too_many
