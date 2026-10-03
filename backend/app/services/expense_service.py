"""Expenses (BUSINESS-RULES §15). Delete vs void is ⚠ OPEN (Q-EXP-1) — not exposed."""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.domain.expense import Expense, ExpenseCategory, ExpensePaymentMethod, format_expense_code
from app.domain.identity import PermissionKey
from app.domain.money import Money
from app.models import ExpenseRow
from app.repositories.expense_repository import ExpenseRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, feature_on, now, parse_uuid


def expense_dto(r: ExpenseRow) -> dict[str, Any]:
    return {"id": str(r.id), "code": r.code, "category": r.category, "description": r.description,
            "amount": str(r.amount), "expense_date": r.expense_date.isoformat(), "payment_method": r.payment_method,
            "notes": r.notes, "recorded_by": str(r.recorded_by), "created_at": r.created_at}


def record_expense(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    actor.require(PermissionKey.EXPENSES_RECORD)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "expenses"):
        raise AppError("FEATURE_DISABLED", 403, "The Expenses feature is off")
    business = system.business()
    assert business is not None
    today = now().astimezone(ZoneInfo(business.timezone)).date()
    try:
        amount = Money.of(Decimal(str(data.get("amount"))), actor.currency)
        expense_date = date.fromisoformat(str(data.get("expense_date")))
        category, method = ExpenseCategory(data.get("category")), ExpensePaymentMethod(data.get("payment_method"))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise validation("invalid amount, date, category or payment method") from exc
    code = format_expense_code(expense_date.year, system.next_value(actor.business_id, f"expense:{expense_date.year}"))
    with domain_errors():
        expense = Expense(code=code, category=category, description=str(data.get("description", "")), amount=amount,
                          expense_date=expense_date, payment_method=method, recorded_by=str(actor.user_id),
                          created_at=now(), notes=str(data.get("notes", "")))
        expense.validate_date(today)
    row = ExpenseRepository(session).add(ExpenseRow(
        business_id=actor.business_id, code=code, category=category.value, description=expense.description,
        amount=amount.amount, expense_date=expense_date, payment_method=method.value, notes=expense.notes,
        recorded_by=actor.user_id))
    audit(system, actor, actor.business_id, "expense.recorded", "expense", row.id, after={"amount": str(row.amount)})
    return expense_dto(row)


def list_expenses(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.EXPENSES_VIEW)
    return [expense_dto(r) for r in ExpenseRepository(session).list(actor.business_id)]


def update_expense(session: Session, actor: Actor, expense_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Edit an expense (PATCH /expenses/{id}, ✱expenses.edit, audited). The code and the recorder
    never change; delete/void is ⚠ OPEN (Q-EXP-1) and not offered."""
    actor.require(PermissionKey.EXPENSES_EDIT)
    system = SystemRepository(session)
    if not feature_on(system, actor.business_id, "expenses"):
        raise AppError("FEATURE_DISABLED", 403, "The Expenses feature is off")
    row = session.get(ExpenseRow, parse_uuid(expense_id, "expense"))
    if row is None or row.business_id != actor.business_id:
        raise not_found("expense")
    business = system.business()
    assert business is not None
    today = now().astimezone(ZoneInfo(business.timezone)).date()
    before = expense_dto(row)
    try:
        amount = Money.of(Decimal(str(data.get("amount", row.amount))), actor.currency)
        expense_date = date.fromisoformat(str(data.get("expense_date", row.expense_date.isoformat())))
        category = ExpenseCategory(data.get("category", row.category))
        method = ExpensePaymentMethod(data.get("payment_method", row.payment_method))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise validation("invalid amount, date, category or payment method") from exc
    with domain_errors():
        expense = Expense(code=row.code, category=category, description=str(data.get("description", row.description)),
                          amount=amount, expense_date=expense_date, payment_method=method,
                          recorded_by=str(row.recorded_by), created_at=now(), notes=str(data.get("notes", row.notes)))
        expense.validate_date(today)
    row.category, row.description, row.amount = category.value, expense.description, amount.amount
    row.expense_date, row.payment_method, row.notes = expense_date, method.value, expense.notes
    session.flush()
    audit(system, actor, actor.business_id, "expense.updated", "expense", row.id,
          before={"amount": before["amount"]}, after={"amount": str(row.amount)})
    return expense_dto(row)
