"""Compliance configuration records (Q-RCP-2, Q-DSC-2, Q-ARC-3; SYSTEM-LOGIC §13).

BrewSync is compliance-ready, not compliant by default. Nothing here states a legal
requirement. Statutory rules are disabled by default and cannot be enabled without
recorded verification metadata; their calculation is not implemented (⚖ VR-1).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .discount import Eligibility
from .errors import RetentionBelowMinimum, UndecidedPolicy, ValidationError


@dataclass(frozen=True, slots=True)
class Verification:
    verified_by: str
    verified_at: datetime
    verification_reference: str

    def __post_init__(self) -> None:
        if not self.verified_by.strip() or not self.verification_reference.strip():
            raise ValidationError("verification requires verified_by and a reference")


@dataclass(frozen=True, slots=True)
class StatutoryRule:
    """A statutory treatment linked to discount eligibility types (e.g. senior/pwd)."""

    code: str
    eligibilities: frozenset[Eligibility]
    enabled: bool = False
    verification: Verification | None = None

    def __post_init__(self) -> None:
        if self.enabled and self.verification is None:
            raise ValidationError("a statutory rule cannot be enabled without verification metadata (⚖ VR-1)")

    def applies_to(self, eligibility: Eligibility) -> bool:
        return self.enabled and eligibility in self.eligibilities


def ensure_no_statutory_rule(eligibility: Eligibility, rules: tuple[StatutoryRule, ...]) -> None:
    """Ordinary pricing must not silently price an order covered by an enabled statutory rule."""
    for rule in rules:
        if rule.applies_to(eligibility):
            raise UndecidedPolicy(
                "VR-1", f"statutory rule {rule.code} is enabled but its pricing is not implemented"
            )


@dataclass(frozen=True, slots=True)
class RetentionSettings:
    """``archiving.retention_period`` vs the verified ``compliance.retention_minimum`` (Q-ARC-3)."""

    retention_period: timedelta | None = None
    retention_minimum: timedelta | None = field(default=None)  # entered only after verification ⚖ VR-6

    def __post_init__(self) -> None:
        if self.retention_period is not None and self.retention_period <= timedelta(0):
            raise ValidationError("retention period must be positive")
        if (self.retention_period is not None and self.retention_minimum is not None
                and self.retention_period < self.retention_minimum):
            raise RetentionBelowMinimum("retention period is below the verified minimum")

    def disposal_allowed(self) -> bool:
        """Nothing is disposed until a verified minimum exists; end-of-retention handling
        itself is ⚠ OPEN (Q-ARC-5)."""
        if self.retention_minimum is None:
            return False
        raise UndecidedPolicy("Q-ARC-5", "end-of-retention handling (keep / export-then-purge / anonymize)")
