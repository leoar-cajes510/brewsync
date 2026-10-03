"""Expenses (BUSINESS-RULES §15). Custom categories (Q-EXP-2) and delete-vs-void
(Q-EXP-1) are ⚠ OPEN: the category list is the fixed UI list and no delete/void
behaviour is modelled.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

from .errors import UndecidedPolicy, ValidationError
from .money import Money

MAX_DESCRIPTION = 120
MAX_NOTES = 500


class ExpenseCategory(StrEnum):
    SUPPLIES = "Supplies"
    INGREDIENTS = "Ingredients"
    UTILITIES = "Utilities"
    RENT = "Rent"
    EQUIPMENT = "Equipment"
    MAINTENANCE = "Maintenance"
    TRANSPORTATION = "Transportation"
    MARKETING = "Marketing"
    OTHER = "Other"


class ExpensePaymentMethod(StrEnum):
    CASH = "Cash"
    GCASH = "GCash"
    CARD = "Card"
    BANK_TRANSFER = "Bank Transfer"
    OTHER = "Other"


def format_expense_code(year: int, sequence_value: int) -> str:
    """``EXP-YYYY-NNN`` from a yearly sequence (R15.4)."""
    if sequence_value < 1:
        raise ValidationError("sequence value must be ≥ 1")
    return f"EXP-{year:04d}-{sequence_value:03d}"


@dataclass(slots=True)
class Expense:
    code: str
    category: ExpenseCategory
    description: str
    amount: Money
    expense_date: date
    payment_method: ExpensePaymentMethod
    recorded_by: str  # the authenticated user id, never free text
    created_at: datetime
    notes: str = ""

    def __post_init__(self) -> None:
        self.description = self.description.strip()
        if not self.description or len(self.description) > MAX_DESCRIPTION:
            raise ValidationError(f"description is required (≤ {MAX_DESCRIPTION} characters)")
        if len(self.notes) > MAX_NOTES:
            raise ValidationError(f"notes must be ≤ {MAX_NOTES} characters")
        self.amount.require_positive("expense amount")
        if not self.recorded_by:
            raise ValidationError("recorded_by is required")

    def validate_date(self, today: date) -> None:
        """Not later than today in the business timezone (the caller supplies ``today``)."""
        if self.expense_date > today:
            raise ValidationError("expense date cannot be in the future")

    def remove(self) -> None:
        raise UndecidedPolicy("Q-EXP-1", "whether expenses are deleted or voided")
