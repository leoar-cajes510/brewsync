"""Business-wide, versioned settings sections (Q-SET-1; BUSINESS-RULES §17).

Sections that drive business rules are validated through the domain objects. No default
values are invented for new settings (Q-SET-4): a missing section is reported as
SETTINGS_REQUIRED by the services that need it.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, validation
from app.core.permissions import SETTINGS_SECTION_PERMISSION
from app.domain.compliance import RetentionSettings
from app.domain.errors import DomainError
from app.domain.identity import CredentialPolicy, PermissionKey
from app.domain.payment import CashRoundingMode, CashRoundingPolicy, MethodOptions, PaymentMethod, PaymentSettings
from app.domain.settings import Feature, SecuritySettings, SettingsSection
from app.domain.tax import TaxMode, TaxSettings
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, flag, text

STAFFING_RANGES = {"max_admins": (1, 10), "max_staff": (1, 100), "max_terminals": (1, 25),
                   "low_stock_threshold": (0, 10000), "order_waiting_minutes": (1, 240)}


# --- section → domain parsers (also used by other services) ----------------------------------------------
def tax_settings(data: dict) -> TaxSettings:
    return TaxSettings(enabled=flag(data.get("enabled"), "enabled"), mode=TaxMode(data.get("mode", "included")),
                       name=text(data.get("name", ""), "name"),
                       rate=Decimal(str(data["rate"])) if data.get("rate") not in (None, "") else None,
                       registration_number=text(data.get("registration_number", ""), "registration_number"))


def payment_settings(data: dict) -> PaymentSettings:
    options = {}
    for method, opts in (data.get("options") or {}).items():
        options[PaymentMethod(method)] = MethodOptions(
            require_cash_received=flag(opts.get("require_cash_received"), "require_cash_received"),
            require_reference=flag(opts.get("require_reference"), "require_reference"),
            require_confirmation=flag(opts.get("require_confirmation"), "require_confirmation"))
    rounding = data.get("cash_rounding") or {}
    if "enabled" not in rounding:
        raise validation("payments.cash_rounding.enabled must be set explicitly (Q-PAY-2)")
    policy = CashRoundingPolicy(
        enabled=flag(rounding["enabled"], "cash_rounding.enabled"),
        increment=Decimal(str(rounding["increment"])) if rounding.get("increment") not in (None, "") else None,
        mode=CashRoundingMode(rounding["mode"]) if rounding.get("mode") else None)
    return PaymentSettings(frozenset(PaymentMethod(m) for m in data.get("enabled_methods", [])), options, policy)


def security_settings(data: dict) -> tuple[SecuritySettings, CredentialPolicy, dict]:
    policy = data.get("credential_policy") or {}
    try:
        min_password = int(policy["min_password_length"])
        pin_length = int(policy["pin_length"])
        cred = CredentialPolicy(max_failed_attempts=int(policy["max_failed_attempts"]),
                                lockout_duration=timedelta(minutes=int(policy["lockout_minutes"])))
    except (KeyError, TypeError, ValueError) as exc:
        raise validation("security.credential_policy needs min_password_length, pin_length, max_failed_attempts, "
                         "lockout_minutes (values are the owner's choice — Q-AUTH-7)") from exc
    if min_password < 1 or pin_length < 1:
        raise validation("credential lengths must be ≥ 1")
    return (SecuritySettings(idle_timeout_minutes=int(data.get("idle_timeout_minutes", 0))), cred,
            {"min_password_length": min_password, "pin_length": pin_length})


def _validate(system: SystemRepository, business_id: Any, section: SettingsSection, data: dict) -> dict:
    if not isinstance(data, dict):
        raise validation("settings data must be an object")
    try:
        return _validate_section(system, business_id, section, data)
    except (ValueError, KeyError, TypeError) as exc:  # e.g. an unknown enum value such as tax.mode
        raise validation(f"invalid {section.value} settings: {exc}") from exc


def _validate_section(system: SystemRepository, business_id: Any, section: SettingsSection, data: dict) -> dict:
    with domain_errors():
        if section is SettingsSection.TAX:
            tax_settings(data)
        elif section is SettingsSection.PAYMENTS:
            payment_settings(data)
        elif section is SettingsSection.SECURITY:
            security_settings(data)
        elif section is SettingsSection.FEATURES:
            missing = {f.value for f in Feature} - set(data)
            if missing:
                raise validation("every feature flag must be set explicitly", missing=sorted(missing))
            if any(not isinstance(v, bool) for v in data.values()):
                raise validation("feature flags are booleans")
        elif section is SettingsSection.STAFFING:
            for key, (low, high) in STAFFING_RANGES.items():
                value = data.get(key)
                if not isinstance(value, int) or not low <= value <= high:
                    raise validation(f"staffing.{key} must be an integer {low}–{high}")
        elif section is SettingsSection.BUSINESS:
            if not text(data.get("name", ""), "name").strip():
                raise validation("business.name is required")
            for key, limit in (("name", 120), ("business_type", 60), ("address", 255), ("phone", 40), ("email", 120)):
                if len(text(data.get(key), f"business.{key}")) > limit:
                    raise validation(f"business.{key} is longer than {limit} characters")
            current = _business_identity(system)
            for key in BUSINESS_FIXED:
                if key in data and data[key] != current[key]:
                    raise AppError("CONFLICT", 409, f"business.{key} is set in the setup wizard and cannot be changed here")
        elif section is SettingsSection.ARCHIVING:
            for key in ("auto_archive_after_hours", "restore_window_hours"):
                if not isinstance(data.get(key), int) or data[key] <= 0:
                    raise validation(f"archiving.{key} must be a positive integer")
            compliance = system.settings(business_id, "compliance")
            minimum = (compliance.data if compliance else {}).get("retention_minimum_days")
            period = data.get("retention_period_days")
            RetentionSettings(timedelta(days=period) if period else None,
                              timedelta(days=minimum) if minimum else None)
    return data


BUSINESS_IDENTITY = ("name", "business_type", "address", "phone", "email")
BUSINESS_FIXED = ("currency_code", "timezone")  # chosen in the setup wizard; no change rule is defined


def _business_identity(system: SystemRepository) -> dict:
    business = system.business()
    assert business is not None
    return {key: getattr(business, key) for key in BUSINESS_IDENTITY + BUSINESS_FIXED}


def get_section(session: Session, actor: Actor, name: str) -> dict:
    actor.require(PermissionKey.SETTINGS_VIEW)
    section = _section(name)
    system = SystemRepository(session)
    row = system.settings(actor.business_id, section.value)
    if section is SettingsSection.BUSINESS:
        # The business record (created by the setup wizard) is the source of the identity fields.
        data = {**(dict(row.data) if row else {}), **_business_identity(system)}
        return {"section": section.value, "configured": row is not None, "version": row.version if row else 0,
                "data": data}
    if row is None:
        return {"section": section.value, "configured": False, "version": 0, "data": None}
    return {"section": section.value, "configured": True, "version": row.version, "data": row.data}


def list_sections(session: Session, actor: Actor) -> list[dict]:
    actor.require(PermissionKey.SETTINGS_VIEW)
    rows = {r.section: r for r in SystemRepository(session).all_settings(actor.business_id)}
    return [{"section": s.value, "configured": s.value in rows, "version": rows[s.value].version if s.value in rows else 0}
            for s in SettingsSection if s is not SettingsSection.PERMISSIONS and s is not SettingsSection.DISCOUNTS]


def _section(name: str) -> SettingsSection:
    try:
        section = SettingsSection(name)
    except ValueError as exc:
        raise AppError("NOT_FOUND", 404, f"settings section {name} not found") from exc
    if section in (SettingsSection.PERMISSIONS, SettingsSection.DISCOUNTS):
        raise AppError("NOT_FOUND", 404, f"{name} are managed through their own endpoints")
    return section


def put_section(session: Session, actor: Actor, name: str, data: dict, expected_version: int) -> dict:
    section = _section(name)
    actor.require(SETTINGS_SECTION_PERMISSION[section.value])
    system = SystemRepository(session)
    current = system.settings(actor.business_id, section.value, lock=True)
    current_version = current.version if current else 0
    if expected_version != current_version:
        raise AppError("VERSION_CONFLICT", 409, f"{section.value} is at version {current_version}")
    try:
        _validate(system, actor.business_id, section, data)
    except DomainError as exc:  # pragma: no cover - domain_errors covers most
        raise AppError("VALIDATION_ERROR", 422, str(exc)) from exc
    row = system.save_settings(actor.business_id, section.value, data, current_version + 1, actor.user_id)
    if section is SettingsSection.BUSINESS:
        business = system.business()
        assert business is not None
        for key in BUSINESS_IDENTITY:
            if key in data:
                setattr(business, key, text(data[key], key).strip())
        session.flush()
    audit(system, actor, actor.business_id, "settings.changed", "settings", section.value,
          before={"version": current_version}, after={"version": row.version})
    emit(system, actor, actor.business_id, "settings.changed", "settings", section.value, row.version,
         {"section": section.value, "version": row.version})
    return {"section": section.value, "configured": True, "version": row.version, "data": row.data}


def save_initial(system: SystemRepository, business_id: Any, section: SettingsSection, data: dict,
                 by: Any) -> None:
    """Used by setup completion (owner-entered values only)."""
    _validate(system, business_id, section, data)
    system.save_settings(business_id, section.value, data, 1, by)


# Display/operational sections every signed-in session needs (API.md: "operational values every
# session needs arrive via login and /pos/catalog"). Read-only; never security, staffing, archiving,
# offline or compliance data, and no permission beyond a valid session.
OPERATIONAL_SECTIONS = (SettingsSection.FEATURES, SettingsSection.PAYMENTS, SettingsSection.BRANDING,
                        SettingsSection.TERMINOLOGY, SettingsSection.PREFERENCES)
OPERATIONAL_STAFFING_KEYS = ("order_waiting_minutes",)


def operational(session: Session, actor: Actor) -> dict:
    system = SystemRepository(session)
    result: dict[str, Any] = {}
    for s in OPERATIONAL_SECTIONS:
        row = system.settings(actor.business_id, s.value)
        result[s.value] = {"section": s.value, "configured": row is not None, "version": row.version if row else 0,
                           "data": row.data if row else None}
    # Staffing limits stay private; only the display threshold the Orders board needs is shared.
    row = system.settings(actor.business_id, SettingsSection.STAFFING.value)
    data = {k: row.data[k] for k in OPERATIONAL_STAFFING_KEYS if k in row.data} if row else None
    result[SettingsSection.STAFFING.value] = {"section": SettingsSection.STAFFING.value, "configured": row is not None,
                                              "version": row.version if row else 0, "data": data}
    return result
