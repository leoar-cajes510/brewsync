"""Shared service infrastructure: the authenticated actor, permission checks, domain-error
translation, settings access and idempotency. One service method = one use case, run
inside one transaction owned by the caller (router dependency / unit of work)."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TypeVar

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, from_domain, permission_denied, settings_required
from app.domain.errors import DomainError
from app.domain.identity import PermissionKey, RoleKey
from app.repositories.system_repository import SystemRepository

T = TypeVar("T")


def now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Actor:
    """The caller, resolved from the session token by auth_service.authenticate()."""

    user_id: uuid.UUID
    business_id: uuid.UUID
    currency: str
    role: RoleKey
    permissions: frozenset[str]
    session_id: uuid.UUID
    terminal_id: uuid.UUID | None
    full_name: str = ""
    must_change_credential: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def require(self, *keys: PermissionKey) -> None:
        """Server-side permission enforcement (PERMISSIONS §5)."""
        for key in keys:
            if key.value not in self.permissions:
                raise permission_denied(key.value)

    def require_terminal(self) -> uuid.UUID:
        if self.terminal_id is None:
            raise AppError("TERMINAL_NOT_ACTIVATED", 403, "This action requires a session on an activated terminal")
        return self.terminal_id


@contextmanager
def domain_errors() -> Iterator[None]:
    """Translate domain rule violations into application errors."""
    try:
        yield
    except DomainError as exc:
        raise from_domain(exc) from exc


def section(system: SystemRepository, business_id: uuid.UUID, name: str, *, required: bool = True) -> dict | None:
    row = system.settings(business_id, name)
    if row is None:
        if required:
            raise settings_required(name)
        return None
    return dict(row.data)


def feature_on(system: SystemRepository, business_id: uuid.UUID, feature: str) -> bool:
    flags = section(system, business_id, "features")
    assert flags is not None
    return bool(flags.get(feature, False))


def request_hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


def idempotent(session: Session, business_id: uuid.UUID, scope: str, key: str | None, payload: Any,
               action: Callable[[], tuple[int, dict]]) -> tuple[int, dict]:
    """Run ``action`` once per (scope, key). Same key + same request → stored response;
    same key + different request → IDEMPOTENCY_KEY_REUSED. The record is written in the same
    transaction as the effect (R0.9)."""
    if not key or not key.strip() or len(key) > 80:
        raise AppError("VALIDATION_ERROR", 422, "Idempotency-Key header is required (≤ 80 characters)")
    system = SystemRepository(session)
    digest = request_hash(payload)
    existing = system.idempotency(business_id, scope, key)
    if existing is not None:
        if existing.request_hash != digest:
            raise AppError("IDEMPOTENCY_KEY_REUSED", 422, "Idempotency-Key was already used with a different request")
        return existing.status_code, dict(existing.response)
    status, response = action()
    system.save_idempotency(business_id, scope, key, digest, _jsonable(response), status)
    return status, response


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def emit(system: SystemRepository, actor: Actor | None, business_id: uuid.UUID, type: str, entity_type: str,
         entity_id: Any, entity_version: int, payload: dict | None = None) -> None:
    """Write a domain event to the outbox (published after commit in a later phase)."""
    system.append_event(business_id=business_id, type=type, entity_type=entity_type, entity_id=str(entity_id),
                        entity_version=entity_version, actor_id=actor.user_id if actor else None,
                        terminal_id=actor.terminal_id if actor else None, payload=payload or {}, at=now())


def audit(system: SystemRepository, actor: Actor | None, business_id: uuid.UUID | None, action: str,
          entity_type: str, entity_id: Any, *, before: dict | None = None, after: dict | None = None) -> None:
    system.audit(business_id=business_id, actor_id=actor.user_id if actor else None,
                 terminal_id=actor.terminal_id if actor else None, action=action, entity_type=entity_type,
                 entity_id=str(entity_id) if entity_id is not None else None, before=before, after=after, at=now())


def parse_uuid(value: str, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise AppError("NOT_FOUND", 404, f"{what} not found") from exc
