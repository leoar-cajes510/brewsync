"""Permission catalogue re-exported from the domain (single definition, PERMISSIONS.md)."""

from app.domain.identity import (  # noqa: F401
    CASHIER_DEFAULT_GRANTS,
    CONFIGURABLE_KEYS,
    GAP_KEYS,
    PROTECTED,
    PermissionKey,
    RoleKey,
)

SETTINGS_SECTION_PERMISSION: dict[str, PermissionKey] = {
    "business": PermissionKey.SETTINGS_BUSINESS,
    "branding": PermissionKey.SETTINGS_BRANDING,
    "terminology": PermissionKey.SETTINGS_TERMINOLOGY,
    "features": PermissionKey.SETTINGS_FEATURES,
    "tax": PermissionKey.SETTINGS_TAX,
    "payments": PermissionKey.SETTINGS_PAYMENTS,
    "receipts": PermissionKey.SETTINGS_RECEIPTS,
    "staffing": PermissionKey.SETTINGS_STAFFING,
    "preferences": PermissionKey.SETTINGS_PREFERENCES,
    "security": PermissionKey.SETTINGS_SECURITY,
    "archiving": PermissionKey.SETTINGS_ARCHIVING,
    "offline": PermissionKey.SETTINGS_OFFLINE,
    "compliance": PermissionKey.SETTINGS_COMPLIANCE,
}
