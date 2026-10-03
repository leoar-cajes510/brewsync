"""Application errors and the domain → API error-code mapping (API.md conventions).

The domain layer has no HTTP knowledge; this module translates domain errors into
``AppError(code, status, message)``. ``DECISION_PENDING`` (409) is used when a behaviour
depends on an OPEN question in DECISIONS.md; ``SETTINGS_REQUIRED`` (409) when a
required business setting has not been configured yet (no invented defaults, Q-SET-4).
"""

from __future__ import annotations

from typing import Any

from app.domain import errors as d


class AppError(Exception):
    def __init__(self, code: str, status: int, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.details = details or {}


def validation(message: str, **details: Any) -> AppError:
    return AppError("VALIDATION_ERROR", 422, message, details)


def not_found(what: str) -> AppError:
    return AppError("NOT_FOUND", 404, f"{what} not found")


def conflict(message: str) -> AppError:
    return AppError("CONFLICT", 409, message)


def settings_required(section: str) -> AppError:
    return AppError("SETTINGS_REQUIRED", 409, f"Settings section '{section}' must be configured first",
                    {"section": section})


def permission_denied(permission: str) -> AppError:
    return AppError("PERMISSION_DENIED", 403, f"Missing permission {permission}", {"permission": permission})


# Ordered: more specific classes first.
_MAP: list[tuple[type[d.DomainError], str, int]] = [
    (d.UndecidedPolicy, "DECISION_PENDING", 409),
    (d.InsufficientStock, "INSUFFICIENT_STOCK", 409),
    (d.StockReserved, "STOCK_RESERVED", 409),
    (d.NegativeStockError, "INSUFFICIENT_STOCK", 409),
    (d.VersionConflict, "VERSION_CONFLICT", 409),
    (d.InvalidStateTransition, "INVALID_TRANSITION", 409),
    (d.OrderNotSettled, "ORDER_NOT_SETTLED", 409),
    (d.DiscountAlreadyApplied, "DISCOUNT_ALREADY_APPLIED", 409),
    (d.DiscountMinOrderNotMet, "DISCOUNT_MIN_ORDER", 422),
    (d.IdentificationRequired, "IDENTIFICATION_REQUIRED", 422),
    (d.EmptyOrder, "EMPTY_CART", 400),
    (d.Overpayment, "OVERPAYMENT", 422),
    (d.InsufficientTender, "INSUFFICIENT_TENDER", 422),
    (d.ReferenceRequired, "REFERENCE_REQUIRED", 422),
    (d.PaymentMethodNotEnabled, "METHOD_NOT_ENABLED", 422),
    (d.RefundExceedsPayment, "REFUND_EXCEEDS_REFUNDABLE", 422),
    (d.RefundNotAllowed, "INVALID_TRANSITION", 409),
    (d.FeatureDisabled, "FEATURE_DISABLED", 403),
    (d.AuthMethodNotAllowed, "AUTH_METHOD_NOT_ALLOWED", 422),
    (d.AccountLocked, "ACCOUNT_LOCKED", 423),
    (d.SessionExpired, "SESSION_EXPIRED", 401),
    (d.TerminalNotActive, "TERMINAL_NOT_ACTIVATED", 403),
    (d.SetupStateError, "SETUP_REQUIRED", 409),
    (d.RestoreWindowExpired, "RESTORE_WINDOW_EXPIRED", 409),
    (d.RetentionBelowMinimum, "RETENTION_BELOW_MINIMUM", 422),
    (d.IdempotencyKeyReused, "IDEMPOTENCY_KEY_REUSED", 422),
    (d.DuplicateOperation, "CONFLICT", 409),
    (d.PermissionProtectionError, "PERMISSION_DENIED", 403),
    (d.ImmutableRecordError, "CONFLICT", 409),
    (d.DocumentSeriesExhausted, "CONFLICT", 409),
    (d.CurrencyMismatch, "VALIDATION_ERROR", 422),
    (d.ValidationError, "VALIDATION_ERROR", 422),
    (d.DomainError, "CONFLICT", 409),
]


def from_domain(error: d.DomainError) -> AppError:
    for cls, code, status in _MAP:
        if isinstance(error, cls):
            details: dict[str, Any] = {}
            if isinstance(error, d.UndecidedPolicy):
                details["question_id"] = error.question_id
            if isinstance(error, d.InsufficientStock):
                details["shortfalls"] = {f"{k.subject_type}:{k.subject_id}" if hasattr(k, "subject_id") else str(k):
                                         str(v) for k, v in error.shortfalls.items()}
            if isinstance(error, d.IdentificationRequired):
                details["missing"] = list(error.missing)
            if isinstance(error, d.SetupStateError) and "already" in str(error):
                return AppError("SETUP_ALREADY_COMPLETED", 409, str(error))
            return AppError(code, status, str(error), details)
    return AppError("CONFLICT", 409, str(error))
