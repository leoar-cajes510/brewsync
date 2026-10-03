"""Payments (Q-PAY-1, Q-PAY-2; BUSINESS-RULES §7). Order row locked while the remaining balance
is computed; Idempotency-Key required; the settling payment issues the sales document in the
same transaction. Payment confirmation MEANING is ⚠ OPEN (Q-PAY-3): only the mechanics
(pending → completed / voided, ✱pos.processPayments) are implemented."""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import validation
from app.domain.identity import PermissionKey
from app.domain.money import Money
from app.domain.payment import PaymentMethod, PaymentRequest, build_payment
from app.repositories.order_repository import OrderRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, domain_errors, emit, idempotent, now, section
from app.services.document_service import issue_sales_document
from app.services.order_service import _load, order_dto
from app.services.settings_service import payment_settings


def _money(value: Any, currency: str, field: str) -> Money:
    if isinstance(value, (float, bool)):
        raise validation(f"{field} must be a decimal string")
    try:
        return Money.of(Decimal(str(value)), currency)
    except (InvalidOperation, ValueError, Exception) as exc:
        raise validation(f"{field} must be a decimal with at most 2 places") from exc


def record_payment(session: Session, actor: Actor, order_id: str, data: dict[str, Any],
                   idempotency_key: str | None) -> tuple[int, dict]:
    actor.require(PermissionKey.POS_PROCESS_PAYMENTS)
    terminal_id = actor.require_terminal()

    def run() -> tuple[int, dict]:
        system = SystemRepository(session)
        settings = payment_settings(section(system, actor.business_id, "payments") or {})
        row, order = _load(session, actor, order_id, lock=True)
        try:
            method = PaymentMethod(data.get("method"))
        except ValueError as exc:
            raise validation("method must be cash, gcash, card or bank_transfer") from exc
        request = PaymentRequest(method=method, amount=_money(data.get("amount"), actor.currency, "amount"),
                                 tendered=_money(data["tendered"], actor.currency, "tendered")
                                 if data.get("tendered") not in (None, "") else None,
                                 reference=data.get("reference"))
        with domain_errors():
            payment = build_payment(request, remaining_balance=order.remaining_balance, settings=settings,
                                    payment_id=str(uuid.uuid4()), order_id=order.id, idempotency_key=idempotency_key or "",
                                    terminal_id=str(terminal_id), user_id=str(actor.user_id), at=now())
            became_paid = order.add_payment(payment)
        OrderRepository(session).save(row, order)
        emit(system, actor, actor.business_id, "payment.recorded", "payment", payment.id, 1,
             {"order_id": order.id, "method": method.value, "status": payment.status.value})
        emit(system, actor, actor.business_id, "order.payment_status_changed", "order", order.id, order.version,
             {"payment_status": order.payment_status.value})
        dto = order_dto(order)
        dto["payment"] = {"id": payment.id, "status": payment.status.value, "amount": str(payment.amount.amount),
                          "change_given": str(payment.change_given.amount) if payment.change_given else None,
                          "rounding_adjustment": str(payment.rounding_adjustment.amount)}
        if became_paid:
            doc = issue_sales_document(session, actor, order)
            dto["document"] = {"id": str(doc.id), "number": doc.number}
        return 201, dto

    return idempotent(session, actor.business_id, f"payment:{order_id}", idempotency_key, data, run)


def confirm_payment(session: Session, actor: Actor, order_id: str, payment_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.POS_PROCESS_PAYMENTS)
    actor.require_terminal()
    row, order = _load(session, actor, order_id, lock=True)
    with domain_errors():
        became_paid = order.confirm_payment(payment_id, str(actor.user_id), now())
    OrderRepository(session).save(row, order)
    system = SystemRepository(session)
    emit(system, actor, actor.business_id, "payment.confirmed", "payment", payment_id, 2, {"order_id": order.id})
    dto = order_dto(order)
    if became_paid:
        doc = issue_sales_document(session, actor, order)
        dto["document"] = {"id": str(doc.id), "number": doc.number}
    return dto


def void_payment(session: Session, actor: Actor, order_id: str, payment_id: str) -> dict[str, Any]:
    actor.require(PermissionKey.POS_PROCESS_PAYMENTS)
    row, order = _load(session, actor, order_id, lock=True)
    with domain_errors():
        order.void_payment(payment_id)
    OrderRepository(session).save(row, order)
    emit(SystemRepository(session), actor, actor.business_id, "payment.voided", "payment", payment_id, 2,
         {"order_id": order.id})
    return order_dto(order)
