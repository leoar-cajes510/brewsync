"""Archiving configuration (Q-ARC-1, Q-ARC-2, Q-ARC-4; BUSINESS-RULES §12).

Durations are configuration; their defaults are ⚠ OPEN (Q-SET-4), so none are provided.
The scheduled job itself belongs to the service layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import StrEnum

from .errors import ValidationError


class ArchiveMethod(StrEnum):
    AUTO = "auto"
    MANUAL = "manual"


@dataclass(frozen=True, slots=True)
class ArchivePolicy:
    auto_archive_after: timedelta  # after completed_at, completed orders only
    restore_window: timedelta      # counted from archived_at

    def __post_init__(self) -> None:
        if self.auto_archive_after <= timedelta(0) or self.restore_window <= timedelta(0):
            raise ValidationError("archive durations must be positive")
