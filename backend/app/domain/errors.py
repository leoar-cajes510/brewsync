"""Domain error hierarchy.

HTTP status codes are deliberately absent: the service/API layers translate these
errors into the canonical API error codes (API.md) later.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence


class DomainError(Exception):
    """Base class for every domain rule violation."""


class ValidationError(DomainError):
    """A value or combination of values breaks a domain rule (VALIDATION_ERROR)."""


class InvalidMoney(ValidationError):
    """Invalid monetary value (float, non-finite, too many decimals, wrong sign)."""


class CurrencyMismatch(DomainError):
    """Arithmetic or comparison between different currencies."""


class InvalidStateTransition(DomainError):
    """A state change not allowed by the state machine (INVALID_TRANSITION)."""


class VersionConflict(DomainError):
    """The caller's expected version is stale (VERSION_CONFLICT)."""


class ImmutableRecordError(DomainError):
    """Attempt to change a record that is immutable once created/completed/issued."""


class UndecidedPolicy(DomainError):
    """The behaviour depends on a decision that is still OPEN in DECISIONS.md.

    Raised instead of silently choosing a business policy.
    """

    def __init__(self, question_id: str, detail: str) -> None:
        self.question_id = question_id
        super().__init__(f"{question_id} is OPEN in DECISIONS.md: {detail}")


class FeatureDisabled(DomainError):
    """The business feature toggle for this module is off (FEATURE_DISABLED)."""


# --- inventory -----------------------------------------------------------------

class InsufficientStock(DomainError):
    """A reservation exceeds available stock (INSUFFICIENT_STOCK)."""

    def __init__(self, shortfalls: Mapping[object, object]) -> None:
        self.shortfalls = dict(shortfalls)
        super().__init__(f"insufficient stock for: {self.shortfalls}")


class StockReserved(DomainError):
    """A manual movement would push on_hand below reserved (STOCK_RESERVED)."""


class NegativeStockError(DomainError):
    """A movement would make on_hand or reserved negative (Q-INV-3)."""


# --- catalog / orders ------------------------------------------------------------

class InvalidChoiceSelection(ValidationError):
    """Choice selections break group rules (required/single/multi/min/max/active)."""


class EmptyOrder(ValidationError):
    """An order needs at least one line (EMPTY_CART)."""


class OrderNotSettled(DomainError):
    """Completion requires payment_status = paid (ORDER_NOT_SETTLED)."""


class DuplicateOperation(DomainError):
    """The same idempotency key was already applied to this aggregate."""


class IdempotencyKeyReused(DomainError):
    """Same idempotency key sent with a different request (IDEMPOTENCY_KEY_REUSED)."""


# --- discounts ---------------------------------------------------------------------

class DiscountAlreadyApplied(DomainError):
    """Only one discount per order (Q-DSC-1, DISCOUNT_ALREADY_APPLIED)."""


class DiscountMinOrderNotMet(DomainError):
    """Order subtotal is below the discount's min_order (DISCOUNT_MIN_ORDER)."""


class IdentificationRequired(DomainError):
    """A discount requiring identification is missing fields (IDENTIFICATION_REQUIRED)."""

    def __init__(self, missing: Sequence[str]) -> None:
        self.missing = tuple(missing)
        super().__init__(f"identification required: {', '.join(self.missing)}")


# --- payments / refunds -------------------------------------------------------------

class InvalidPayment(ValidationError):
    """A payment request is malformed."""


class PaymentMethodNotEnabled(DomainError):
    """The method is disabled, or unavailable offline (METHOD_NOT_ENABLED)."""


class Overpayment(DomainError):
    """The payment exceeds the remaining balance (OVERPAYMENT)."""


class InsufficientTender(DomainError):
    """Cash tendered is below the payment amount (INSUFFICIENT_TENDER)."""


class ReferenceRequired(DomainError):
    """A configured non-cash payment reference is missing/invalid (REFERENCE_REQUIRED)."""


class RefundNotAllowed(DomainError):
    """Refund attempted on an order that is not refundable (e.g. not completed)."""


class RefundExceedsPayment(DomainError):
    """Refunds would exceed completed payments (REFUND_EXCEEDS_REFUNDABLE)."""


# --- identity / sessions / setup ---------------------------------------------------

class AuthMethodNotAllowed(DomainError):
    """Admin accounts must use password authentication (AUTH_METHOD_NOT_ALLOWED)."""


class AccountLocked(DomainError):
    """Too many failed sign-ins (ACCOUNT_LOCKED)."""


class AccountInactive(DomainError):
    """Inactive users cannot sign in."""


class SessionExpired(DomainError):
    """The session exceeded the idle timeout or has ended (SESSION_EXPIRED)."""


class PermissionProtectionError(DomainError):
    """A non-configurable permission protection was violated (PERMISSIONS §4)."""


class SetupStateError(DomainError):
    """Setup-state guard (SETUP_REQUIRED / SETUP_ALREADY_COMPLETED)."""


class TerminalNotActive(DomainError):
    """The terminal is not activated (TERMINAL_NOT_ACTIVATED)."""


# --- archive / documents / records --------------------------------------------------

class RestoreWindowExpired(DomainError):
    """Restore requested after the configured restore window (RESTORE_WINDOW_EXPIRED)."""


class RetentionBelowMinimum(DomainError):
    """Retention period below the verified minimum (RETENTION_BELOW_MINIMUM)."""


class DocumentSeriesExhausted(DomainError):
    """The document series has no numbers left in its configured range."""


class SensitiveDataError(ValidationError):
    """Credentials or identification values must not be stored in this record."""
