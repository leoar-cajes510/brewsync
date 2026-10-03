"""Terminal registration and device activation (Q-TRM-1; BUSINESS-RULES R14.1–R14.4)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, validation
from app.core.security import hash_credential, new_activation_code, new_token, token_digest, verify_credential
from app.domain.identity import PermissionKey, TerminalStatus
from app.models import TerminalRow
from app.repositories.staff_repository import StaffRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, domain_errors, emit, now, section
from app.services.setup_service import require_completed

MAX_ACTIVATION_MINUTES = 24 * 60


def terminal_dto(row: TerminalRow) -> dict[str, Any]:
    return {"id": str(row.id), "code": row.code, "name": row.name, "status": row.status,
            "activated_at": row.activated_at, "last_seen_at": row.last_seen_at}


def list_terminals(session: Session, actor: Actor) -> list[dict[str, Any]]:
    actor.require(PermissionKey.TERMINALS_MANAGE)
    return [terminal_dto(r) for r in StaffRepository(session).terminals(actor.business_id)]


def _issue_code(row: TerminalRow, minutes: int) -> str:
    if not isinstance(minutes, int) or not 1 <= minutes <= MAX_ACTIVATION_MINUTES:
        raise validation(f"activation_code_minutes must be 1–{MAX_ACTIVATION_MINUTES} (chosen by the Admin)")
    code = new_activation_code()
    row.activation_code_hash, row.activation_expires_at = hash_credential(code), now() + timedelta(minutes=minutes)
    return code


def register(session: Session, actor: Actor, data: dict[str, Any]) -> dict[str, Any]:
    """Admin registers a terminal; the one-time activation code is returned once."""
    actor.require(PermissionKey.TERMINALS_MANAGE)
    staff, system = StaffRepository(session), SystemRepository(session)
    code, name = str(data.get("code", "")).strip().upper(), str(data.get("name", "")).strip()
    if not code or not name:
        raise validation("terminal code and name are required")
    if staff.terminal_by_code(actor.business_id, code):
        raise AppError("CONFLICT", 409, "Terminal code already exists")
    row = TerminalRow(business_id=actor.business_id, code=code, name=name,
                      status=TerminalStatus.PENDING_ACTIVATION.value)
    activation_code = _issue_code(row, data.get("activation_code_minutes"))  # type: ignore[arg-type]
    session.add(row)
    session.flush()
    audit(system, actor, actor.business_id, "terminal.registered", "terminal", row.id, after={"code": code})
    emit(system, actor, actor.business_id, "terminal.status_changed", "terminal", row.id, 1, {"status": row.status})
    return {**terminal_dto(row), "activation_code": activation_code, "activation_expires_at": row.activation_expires_at}


def activate(session: Session, terminal_code: str, activation_code: str) -> dict[str, Any]:
    """The physical device claims its assigned terminal with the one-time code."""
    require_completed(session)
    staff, system = StaffRepository(session), SystemRepository(session)
    business = system.business()
    assert business is not None
    row = staff.terminal_by_code(business.id, str(terminal_code or "").strip().upper(), lock=True)
    invalid = AppError("ACTIVATION_CODE_INVALID", 400, "Invalid or expired activation code")
    if (row is None or row.activation_code_hash is None or row.activation_expires_at is None
            or row.activation_expires_at < now() or not verify_credential(activation_code or "", row.activation_code_hash)):
        raise invalid
    staffing = section(system, business.id, "staffing") or {}
    if staff.count_active_terminals(business.id) >= staffing["max_terminals"]:
        raise AppError("LIMIT_REACHED", 409, "Maximum active terminals reached")
    terminal = staff.to_domain_terminal(row)
    with domain_errors():
        terminal.activate(at=now(), by=None)
    staff.apply_terminal(row, terminal)
    credential = new_token("bsd")
    row.device_credential_hash = token_digest(credential)
    row.activation_code_hash = row.activation_expires_at = None  # single use
    audit(system, None, business.id, "terminal.activated", "terminal", row.id)
    emit(system, None, business.id, "terminal.status_changed", "terminal", row.id, 2, {"status": row.status})
    return {"terminal": terminal_dto(row), "device_credential": credential}


def reset_activation(session: Session, actor: Actor, terminal_id: Any, minutes: int) -> dict[str, Any]:
    actor.require(PermissionKey.TERMINALS_MANAGE)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = staff.terminal(terminal_id, lock=True)
    if row is None or row.business_id != actor.business_id:
        raise AppError("NOT_FOUND", 404, "terminal not found")
    terminal = staff.to_domain_terminal(row)
    with domain_errors():
        terminal.reset_activation()
    staff.apply_terminal(row, terminal)
    row.device_credential_hash = None
    for srow in staff.active_sessions_for_terminal(row.id):
        srow.ended_at, srow.end_reason = now(), "terminal_revoked"
    code = _issue_code(row, minutes)
    audit(system, actor, actor.business_id, "terminal.reset", "terminal", row.id)
    emit(system, actor, actor.business_id, "terminal.status_changed", "terminal", row.id, 3, {"status": row.status})
    return {**terminal_dto(row), "activation_code": code, "activation_expires_at": row.activation_expires_at}


def _owned(staff: StaffRepository, actor: Actor, terminal_id: Any) -> TerminalRow:
    row = staff.terminal(terminal_id, lock=True)
    if row is None or row.business_id != actor.business_id:
        raise AppError("NOT_FOUND", 404, "terminal not found")
    return row


def deactivate(session: Session, actor: Actor, terminal_id: Any) -> dict[str, Any]:
    """Revokes the device credential and ends the terminal's sessions (API.md terminals.py).
    The device can be brought back only with a new activation code (reset-activation)."""
    actor.require(PermissionKey.TERMINALS_MANAGE)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = _owned(staff, actor, terminal_id)
    if actor.terminal_id is not None and row.id == actor.terminal_id:
        # Self-lockout guard: the session doing this would end with it.
        raise AppError("INVALID_TRANSITION", 409, "You are signed in on this terminal; deactivate it from another terminal")
    terminal = staff.to_domain_terminal(row)
    with domain_errors():
        terminal.deactivate()
    staff.apply_terminal(row, terminal)
    row.device_credential_hash = None
    row.activation_code_hash = row.activation_expires_at = None
    for srow in staff.active_sessions_for_terminal(row.id):
        srow.ended_at, srow.end_reason = now(), "terminal_revoked"
    audit(system, actor, actor.business_id, "terminal.deactivated", "terminal", row.id)
    emit(system, actor, actor.business_id, "terminal.status_changed", "terminal", row.id, 4, {"status": row.status})
    return terminal_dto(row)


def rename(session: Session, actor: Actor, terminal_id: Any, data: dict[str, Any]) -> dict[str, Any]:
    actor.require(PermissionKey.TERMINALS_MANAGE)
    staff, system = StaffRepository(session), SystemRepository(session)
    row = _owned(staff, actor, terminal_id)
    name = str(data.get("name", "")).strip()
    if not name or len(name) > 80:
        raise validation("terminal name is required (≤ 80 characters)")
    before, row.name = row.name, name
    audit(system, actor, actor.business_id, "terminal.renamed", "terminal", row.id, before={"name": before}, after={"name": name})
    return terminal_dto(row)
