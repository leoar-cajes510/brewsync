"""Offline sync service boundary (SR-4, Q-TRM-2…5). The persistence model exists
(offline_submissions, pos_snapshots, idempotency, outbox); the protocol is a later phase and
its exact scope is ⚠ OPEN (Q-TRM-7). Offline sales-document numbering is ⚠ OPEN (Q-RCP-5)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.services.base import Actor


def submit_offline_transactions(session: Session, actor: Actor, submissions: list[dict[str, Any]]) -> None:
    raise AppError("DECISION_PENDING", 409,
                   "Offline sync is not enabled: exact offline scope (Q-TRM-7) and offline document numbering "
                   "(Q-RCP-5) are OPEN", {"question_id": "Q-TRM-7"})
