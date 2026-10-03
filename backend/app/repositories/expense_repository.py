"""Expense persistence."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ExpenseRow


class ExpenseRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    def add(self, row: ExpenseRow) -> ExpenseRow:
        self.s.add(row)
        self.s.flush()
        return row

    def list(self, business_id: uuid.UUID, limit: int = 200) -> list[ExpenseRow]:
        return list(self.s.scalars(select(ExpenseRow).where(ExpenseRow.business_id == business_id)
                                   .order_by(ExpenseRow.expense_date.desc(), ExpenseRow.code.desc()).limit(limit)))
