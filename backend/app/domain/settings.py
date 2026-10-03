"""Business-wide, versioned settings sections (Q-SET-1; BUSINESS-RULES §17).

Only the domain shape is defined; persistence is later. Default values for newly
configurable settings are ⚠ OPEN (Q-SET-4) and are not provided here.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum

from .errors import ValidationError, VersionConflict
from .records import freeze


class SettingsSection(StrEnum):
    BUSINESS = "business"
    BRANDING = "branding"
    TERMINOLOGY = "terminology"
    FEATURES = "features"
    PERMISSIONS = "permissions"
    TAX = "tax"
    PAYMENTS = "payments"
    DISCOUNTS = "discounts"
    RECEIPTS = "receipts"      # display settings only
    STAFFING = "staffing"
    PREFERENCES = "preferences"  # business-wide
    SECURITY = "security"
    ARCHIVING = "archiving"
    OFFLINE = "offline"
    COMPLIANCE = "compliance"  # every value ⚖ requires verification


class Feature(StrEnum):
    INVENTORY = "inventory"
    ANALYTICS = "analytics"
    EXPENSES = "expenses"
    REFUNDS = "refunds"
    DISCOUNTS = "discounts"
    INGREDIENTS = "ingredients"
    LOW_STOCK_ALERTS = "lowStockAlerts"
    ORDER_ALERTS = "orderAlerts"
    LIVE_UPDATES = "liveUpdates"
    SOUND_EFFECTS = "soundEffects"


@dataclass(frozen=True, slots=True)
class FeatureFlags:
    enabled: frozenset[Feature]

    def is_on(self, feature: Feature) -> bool:
        return feature in self.enabled


@dataclass(frozen=True, slots=True)
class SettingsDocument:
    """One section's data with an optimistic version (stale version → VersionConflict)."""

    section: SettingsSection
    data: Mapping[str, object]
    version: int
    updated_by: str | None
    updated_at: datetime

    def __post_init__(self) -> None:
        if self.version < 1:
            raise ValidationError("settings version starts at 1")
        object.__setattr__(self, "data", freeze(dict(self.data)))

    def updated(self, data: Mapping[str, object], *, expected_version: int, by: str,
                at: datetime) -> SettingsDocument:
        if expected_version != self.version:
            raise VersionConflict(f"{self.section} is at version {self.version}")
        return SettingsDocument(self.section, data, self.version + 1, by, at)


# Approved candidate idle-timeout values (Q-AUTH-4); the default is ⚠ OPEN (Q-SET-4).
ALLOWED_IDLE_TIMEOUT_MINUTES: frozenset[int] = frozenset({5, 10, 15, 30, 60})


@dataclass(frozen=True, slots=True)
class SecuritySettings:
    idle_timeout_minutes: int = field()

    def __post_init__(self) -> None:
        if self.idle_timeout_minutes not in ALLOWED_IDLE_TIMEOUT_MINUTES:
            raise ValidationError(f"idle timeout must be one of {sorted(ALLOWED_IDLE_TIMEOUT_MINUTES)}")
