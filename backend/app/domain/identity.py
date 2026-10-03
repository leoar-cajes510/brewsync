"""Identity & access: Business, SystemState, Role, Permission, RoleGrants (RolePermission),
User, Terminal, Session (PERMISSIONS.md; BUSINESS-RULES §13, §14, §18).

No hashing, tokens or HTTP here. Still ⚠ OPEN and not decided: credential policy
values (Q-AUTH-7 — ``CredentialPolicy`` has no defaults), setup-wizard protection
(Q-AUTH-8), first device (Q-TRM-8), concurrent sessions (Q-AUTH-6), terminal restriction
(Q-TRM-6), Admin elevation (Q-AUTH-3), username rename (Q-AUTH-5).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import StrEnum

from .errors import (
    AccountInactive,
    AccountLocked,
    AuthMethodNotAllowed,
    InvalidStateTransition,
    PermissionProtectionError,
    SessionExpired,
    SetupStateError,
    TerminalNotActive,
    ValidationError,
)

# --- business & setup ----------------------------------------------------------------------------------


@dataclass(slots=True)
class Business:
    """The single business of a deployment; created by the owner in the setup wizard (never seeded)."""

    id: str
    name: str
    currency_code: str
    timezone: str
    business_type: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValidationError("business name is required")
        if not re.fullmatch(r"[A-Z]{3}", self.currency_code):
            raise ValidationError("currency code must be 3 uppercase letters")
        if not self.timezone.strip():
            raise ValidationError("timezone is required")


class SetupStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


@dataclass(slots=True)
class SystemState:
    """First-run setup state (Q-AUTH-1): Business Setup → Create First Admin → Complete Setup."""

    setup_status: SetupStatus = SetupStatus.NOT_STARTED
    completed_at: datetime | None = None
    completed_by: str | None = None

    def begin(self) -> None:
        self.require_setup_open()
        self.setup_status = SetupStatus.IN_PROGRESS

    def complete(self, *, at: datetime, admin_user_id: str) -> None:
        if self.setup_status is not SetupStatus.IN_PROGRESS:
            raise SetupStateError(f"setup is {self.setup_status}; business and first Admin must be staged first")
        self.setup_status, self.completed_at, self.completed_by = SetupStatus.COMPLETED, at, admin_user_id

    def require_setup_open(self) -> None:
        if self.setup_status is SetupStatus.COMPLETED:
            raise SetupStateError("setup already completed")

    def require_setup_completed(self) -> None:
        if self.setup_status is not SetupStatus.COMPLETED:
            raise SetupStateError("setup required")


# --- roles & permissions -------------------------------------------------------------------------------


class RoleKey(StrEnum):
    ADMIN = "admin"
    CASHIER = "cashier"


@dataclass(frozen=True, slots=True)
class Role:
    key: RoleKey
    name: str
    is_system: bool = True


class PermissionKey(StrEnum):
    # view
    POS_VIEW = "pos.view"
    ORDERS_VIEW = "orders.view"
    RECEIPTS_VIEW = "receipts.view"
    HISTORY_VIEW = "history.view"
    PRODUCTS_VIEW = "products.view"
    INVENTORY_VIEW = "inventory.view"
    CHOICES_VIEW = "choices.view"
    INGREDIENTS_VIEW = "ingredients.view"
    EXPENSES_VIEW = "expenses.view"
    ANALYTICS_VIEW = "analytics.view"
    ANALYTICS_INSIGHTS = "analytics.insights"
    STAFF_VIEW = "staff.view"
    SETTINGS_VIEW = "settings.view"
    # create
    POS_CREATE_ORDERS = "pos.createOrders"
    PRODUCTS_CREATE = "products.create"
    EXPENSES_RECORD = "expenses.record"
    STAFF_ADD = "staff.add"
    # edit
    POS_EDIT_ORDERS = "pos.editOrders"
    PRODUCTS_EDIT = "products.edit"
    EXPENSES_EDIT = "expenses.edit"
    STAFF_EDIT = "staff.edit"
    CHOICES_MANAGE = "choices.manage"
    INGREDIENTS_RECIPES = "ingredients.recipes"
    # delete
    PRODUCTS_DELETE = "products.delete"
    EXPENSES_DELETE = "expenses.delete"
    STAFF_DEACTIVATE = "staff.deactivate"
    # process
    POS_PROCESS_PAYMENTS = "pos.processPayments"
    POS_APPLY_DISCOUNTS = "pos.applyDiscounts"
    POS_CANCEL_ORDERS = "pos.cancelOrders"
    ORDERS_CHANGE_STATUS = "orders.changeStatus"
    ORDERS_COMPLETE = "orders.complete"
    RECEIPTS_REPRINT = "receipts.reprint"
    POS_PROCESS_REFUNDS = "pos.processRefunds"
    # stock
    INVENTORY_RESTOCK = "inventory.restock"
    INVENTORY_ADJUST = "inventory.adjust"
    INGREDIENTS_ADJUST = "ingredients.adjust"
    # staff / permissions
    STAFF_RESET_PASSWORDS = "staff.resetPasswords"
    STAFF_MANAGE_PERMISSIONS = "staff.managePermissions"
    # settings
    SETTINGS_BUSINESS = "settings.business"
    SETTINGS_BRANDING = "settings.branding"
    SETTINGS_FEATURES = "settings.features"
    SETTINGS_TAX = "settings.tax"
    SETTINGS_PAYMENTS = "settings.payments"
    SETTINGS_DISCOUNTS = "settings.discounts"
    SETTINGS_RECEIPTS = "settings.receipts"
    SETTINGS_STAFFING = "settings.staffing"
    SETTINGS_PREFERENCES = "settings.preferences"
    SETTINGS_ACCOUNT = "settings.account"
    # gap keys — Admin-only until Q-SET-3 (PERMISSIONS §2.1)
    ARCHIVE_MANAGE = "archive.manage"
    HISTORY_EXPORT = "history.export"
    SETTINGS_TERMINOLOGY = "settings.terminology"
    TERMINALS_MANAGE = "terminals.manage"
    SETTINGS_SECURITY = "settings.security"
    SETTINGS_ARCHIVING = "settings.archiving"
    SETTINGS_OFFLINE = "settings.offline"
    SETTINGS_COMPLIANCE = "settings.compliance"
    SYNC_REVIEW = "sync.review"
    AUDIT_VIEW = "audit.view"


P = PermissionKey

GAP_KEYS: frozenset[PermissionKey] = frozenset({
    P.ARCHIVE_MANAGE, P.HISTORY_EXPORT, P.SETTINGS_TERMINOLOGY, P.TERMINALS_MANAGE, P.SETTINGS_SECURITY,
    P.SETTINGS_ARCHIVING, P.SETTINGS_OFFLINE, P.SETTINGS_COMPLIANCE, P.SYNC_REVIEW, P.AUDIT_VIEW,
})

CASHIER_DEFAULT_GRANTS: frozenset[PermissionKey] = frozenset({
    P.POS_VIEW, P.POS_CREATE_ORDERS, P.POS_EDIT_ORDERS, P.POS_APPLY_DISCOUNTS, P.POS_PROCESS_PAYMENTS,
    P.ORDERS_VIEW, P.ORDERS_CHANGE_STATUS, P.ORDERS_COMPLETE, P.RECEIPTS_VIEW, P.RECEIPTS_REPRINT,
    P.HISTORY_VIEW, P.PRODUCTS_VIEW, P.INVENTORY_VIEW, P.CHOICES_VIEW,
})

# Protected = management functions; never granted to Cashier by default (PERMISSIONS §1/§3).
PROTECTED: frozenset[PermissionKey] = frozenset(PermissionKey) - CASHIER_DEFAULT_GRANTS

ADMIN_LOCKOUT_GUARD: frozenset[PermissionKey] = frozenset({P.STAFF_MANAGE_PERMISSIONS, P.SETTINGS_VIEW})

CONFIGURABLE_KEYS: frozenset[PermissionKey] = frozenset(PermissionKey) - GAP_KEYS  # the 48 UI keys


@dataclass(frozen=True, slots=True)
class Permission:
    key: PermissionKey
    group: str
    label: str

    @property
    def protected(self) -> bool:
        return self.key in PROTECTED


class RoleGrants:
    """The granted permission keys of one role (RolePermission rows), with the
    non-configurable protections of PERMISSIONS §4."""

    def __init__(self, role: RoleKey, granted: set[PermissionKey] | frozenset[PermissionKey]) -> None:
        self.role = role
        self._granted = set(granted)
        if role is RoleKey.CASHIER and self._granted & GAP_KEYS:
            raise PermissionProtectionError("gap keys cannot be granted to Cashier")
        if role is RoleKey.ADMIN and not ADMIN_LOCKOUT_GUARD <= self._granted:
            raise PermissionProtectionError("Admin must keep staff.managePermissions and settings.view")

    @classmethod
    def defaults(cls, role: RoleKey) -> RoleGrants:
        return cls(role, frozenset(PermissionKey) if role is RoleKey.ADMIN else CASHIER_DEFAULT_GRANTS)

    @property
    def granted(self) -> frozenset[PermissionKey]:
        return frozenset(self._granted)

    def has(self, key: PermissionKey) -> bool:
        return key in self._granted

    def grant(self, key: PermissionKey, *, confirmed: bool = False) -> None:
        if self.role is RoleKey.CASHIER:
            if key in GAP_KEYS:
                raise PermissionProtectionError(f"{key} is Admin-only until Q-SET-3")
            if key in PROTECTED and not confirmed:
                raise PermissionProtectionError(f"granting protected {key} to Cashier needs explicit confirmation")
        self._granted.add(key)

    def revoke(self, key: PermissionKey) -> None:
        if self.role is RoleKey.ADMIN and (key in ADMIN_LOCKOUT_GUARD or key in GAP_KEYS):
            raise PermissionProtectionError(f"Admin cannot lose {key}")
        self._granted.discard(key)


# --- users ---------------------------------------------------------------------------------------------------


class AuthMethod(StrEnum):
    PASSWORD = "password"
    PIN = "pin"


class UserStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]{3,20}$")


@dataclass(frozen=True, slots=True)
class CredentialPolicy:
    """Server-enforced credential policy. Values are ⚠ OPEN (Q-AUTH-7): no defaults."""

    max_failed_attempts: int
    lockout_duration: timedelta

    def __post_init__(self) -> None:
        if self.max_failed_attempts < 1 or self.lockout_duration <= timedelta(0):
            raise ValidationError("credential policy values must be positive")


@dataclass(slots=True)
class User:
    """A staff account. Credentials (hashes) are handled by the security layer, not here."""

    id: str
    code: str
    username: str
    full_name: str
    role: RoleKey
    auth_method: AuthMethod
    status: UserStatus = UserStatus.ACTIVE
    default_terminal_id: str | None = None  # a preference, not a restriction (Q-TRM-6 open)
    must_change_credential: bool = False
    failed_attempts: int = 0
    locked_until: datetime | None = None

    def __post_init__(self) -> None:
        if not USERNAME_PATTERN.fullmatch(self.username):
            raise ValidationError("username must match ^[a-z0-9._-]{3,20}$")
        if not self.full_name.strip():
            raise ValidationError("full name is required")
        self._check_method(self.role, self.auth_method)

    @staticmethod
    def _check_method(role: RoleKey, method: AuthMethod) -> None:
        if role is RoleKey.ADMIN and method is not AuthMethod.PASSWORD:
            raise AuthMethodNotAllowed("Admin accounts must use password authentication (Q-AUTH-2)")

    @property
    def is_active(self) -> bool:
        return self.status is UserStatus.ACTIVE

    def change_auth_method(self, method: AuthMethod, *, changed_by: str) -> None:
        """Requires staff.edit (service); a user cannot change their own method."""
        if changed_by == self.id:
            raise PermissionProtectionError("users cannot change their own auth method")
        self._check_method(self.role, method)
        self.auth_method = method
        self.must_change_credential = True  # a new credential of the new type must be set

    def change_role(self, role: RoleKey, *, changed_by: str) -> None:
        if changed_by == self.id:
            raise PermissionProtectionError("users cannot change their own role")
        self._check_method(role, self.auth_method)
        self.role = role

    def is_locked(self, now: datetime) -> bool:
        return self.locked_until is not None and now < self.locked_until

    def ensure_can_sign_in(self, now: datetime, method: AuthMethod) -> None:
        if not self.is_active:
            raise AccountInactive("account inactive")
        if self.is_locked(now):
            raise AccountLocked(f"locked until {self.locked_until}")
        if method is not self.auth_method:
            # Same generic outcome as a wrong credential; the method is not revealed.
            raise AuthMethodNotAllowed("sign-in method does not match the account")

    def record_failed_sign_in(self, now: datetime, policy: CredentialPolicy) -> bool:
        """Count a failure; returns True if the account is now locked."""
        self.failed_attempts += 1
        if self.failed_attempts >= policy.max_failed_attempts:
            self.locked_until = now + policy.lockout_duration
            self.failed_attempts = 0
            return True
        return False

    def record_successful_sign_in(self) -> None:
        self.failed_attempts = 0
        self.locked_until = None

    def deactivate(self) -> None:
        self.status = UserStatus.INACTIVE

    def activate(self) -> None:
        self.status = UserStatus.ACTIVE


def ensure_admin_remains(users: list[User], *, after_change: User) -> None:
    """At least one active Admin must always exist (PERMISSIONS §4 item 1)."""
    admins = [u for u in users if u.id != after_change.id and u.role is RoleKey.ADMIN and u.is_active]
    if after_change.role is RoleKey.ADMIN and after_change.is_active:
        admins.append(after_change)
    if not admins:
        raise PermissionProtectionError("the system must keep at least one active Admin")


# --- terminals ------------------------------------------------------------------------------------------------


class TerminalStatus(StrEnum):
    PENDING_ACTIVATION = "pending_activation"
    ACTIVE = "active"
    INACTIVE = "inactive"
    REVOKED = "revoked"  # trigger not specified in the docs; no transition modelled


@dataclass(slots=True)
class Terminal:
    """Admin registers; the physical device activates with a one-time code (Q-TRM-1).
    Codes and device credentials are verified/stored hashed by the security layer."""

    id: str
    code: str
    name: str
    status: TerminalStatus = TerminalStatus.PENDING_ACTIVATION
    activated_at: datetime | None = None
    activated_by: str | None = None
    last_seen_at: datetime | None = None

    def activate(self, *, at: datetime, by: str | None) -> None:
        if self.status is not TerminalStatus.PENDING_ACTIVATION:
            raise InvalidStateTransition(f"terminal is {self.status}, not awaiting activation")
        self.status, self.activated_at, self.activated_by = TerminalStatus.ACTIVE, at, by

    def deactivate(self) -> None:
        if self.status is not TerminalStatus.ACTIVE:
            raise InvalidStateTransition(f"terminal is {self.status}")
        self.status = TerminalStatus.INACTIVE

    def reactivate(self) -> None:
        if self.status is not TerminalStatus.INACTIVE:
            raise InvalidStateTransition(f"terminal is {self.status}")
        self.status = TerminalStatus.ACTIVE

    def reset_activation(self) -> None:
        """Revokes the device binding; a new one-time code must be issued."""
        if self.status is TerminalStatus.REVOKED:
            raise InvalidStateTransition("terminal is revoked")
        self.status, self.activated_at, self.activated_by = TerminalStatus.PENDING_ACTIVATION, None, None

    def require_active(self) -> None:
        if self.status is not TerminalStatus.ACTIVE:
            raise TerminalNotActive(f"terminal {self.code} is {self.status}")


def ensure_terminal_limit(active_count: int, max_active_terminals: int) -> None:
    """Staffing → Maximum Active Terminals, enforced at activation/reactivation (R14.4)."""
    if active_count >= max_active_terminals:
        raise ValidationError("maximum active terminals reached")


# --- sessions ------------------------------------------------------------------------------------------------------


class SessionEndReason(StrEnum):
    LOGOUT = "logout"
    LOCK = "lock"
    IDLE_TIMEOUT = "idle_timeout"
    FORCED = "forced"
    USER_DEACTIVATED = "user_deactivated"
    TERMINAL_REVOKED = "terminal_revoked"


@dataclass(slots=True)
class Session:
    id: str
    user_id: str
    terminal_id: str
    started_at: datetime
    last_activity_at: datetime = field(default=None)  # type: ignore[assignment]
    ended_at: datetime | None = None
    end_reason: SessionEndReason | None = None

    def __post_init__(self) -> None:
        if self.last_activity_at is None:
            self.last_activity_at = self.started_at

    @property
    def is_active(self) -> bool:
        return self.ended_at is None

    def is_idle_expired(self, now: datetime, idle_timeout_minutes: int) -> bool:
        return now - self.last_activity_at > timedelta(minutes=idle_timeout_minutes)

    def touch(self, now: datetime, idle_timeout_minutes: int, *, user_initiated: bool) -> None:
        """Server-side idle enforcement (Q-AUTH-4). Only user-initiated requests count as
        activity; heartbeats/background refresh never extend the session."""
        if not self.is_active:
            raise SessionExpired(f"session ended ({self.end_reason})")
        if self.is_idle_expired(now, idle_timeout_minutes):
            self.end(SessionEndReason.IDLE_TIMEOUT, now)
            raise SessionExpired("idle timeout")
        if user_initiated:
            self.last_activity_at = now

    def end(self, reason: SessionEndReason, at: datetime) -> None:
        if not self.is_active:
            raise InvalidStateTransition("session already ended")
        self.ended_at, self.end_reason = at, reason
