"""Router plumbing: one transaction per request, bearer authentication, error envelope."""

from __future__ import annotations

import logging

from collections.abc import Callable
from typing import Any, TypeVar

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session, sessionmaker

from app.core.exceptions import AppError
from app.database.connection import DatabaseNotConfigured, get_engine
from app.database.session import make_session_factory, unit_of_work
from app.services.auth_service import authenticate
from app.services.base import Actor

T = TypeVar("T")
_factory: sessionmaker[Session] | None = None


def set_session_factory(factory: sessionmaker[Session] | None) -> None:
    """Tests inject a factory bound to the test schema."""
    global _factory
    _factory = factory


def session_factory() -> sessionmaker[Session]:
    global _factory
    if _factory is None:
        _factory = make_session_factory(get_engine())
    return _factory


def tx(fn: Callable[[Session], T]) -> T:
    """Run a use case in one database transaction (commit on success, rollback on error)."""
    try:
        with unit_of_work(session_factory()) as session:
            return fn(session)
    except DataError as exc:  # a request value PostgreSQL cannot store (NUL byte, numeric overflow…) → 422, not 500
        raise AppError("VALIDATION_ERROR", 422, "A value in the request cannot be stored (invalid character or out of range)") from exc


# Endpoints reachable without a session (setup is guarded by the installer token, activation by
# the one-time code, login by the credentials themselves).
PUBLIC_API_PATHS = frozenset({
    "/api/v1/setup/status", "/api/v1/setup/complete", "/api/v1/setup/first-terminal",
    "/api/v1/auth/login", "/api/v1/terminals/activate",
})


def bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.lower().startswith("bearer ") else None


def authed(request: Request, fn: Callable[[Session, Actor], T], *, allow_credential_change: bool = False) -> T:
    token = bearer(request)
    # Background polling (live updates, auto refresh) marks itself so it never extends the idle
    # timeout (Q-AUTH-4): an unattended terminal still signs out on schedule.
    user_initiated = request.headers.get("x-brewsync-background") != "1"

    def run(session: Session) -> T:
        actor = authenticate(session, token, user_initiated=user_initiated)
        if actor.must_change_credential and not allow_credential_change:
            raise AppError("CREDENTIAL_CHANGE_REQUIRED", 403, "The temporary credential must be changed first")
        return fn(session, actor)

    return tx(run)


def respond(result: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content=jsonable_encoder(result))


def respond_pair(pair: tuple[int, dict]) -> JSONResponse:
    return respond(pair[1], pair[0])


def idem_key(request: Request) -> str | None:
    return request.headers.get("idempotency-key")


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.status,
                        content={"error": {"code": exc.code, "message": exc.message,
                                           "details": jsonable_encoder(exc.details)}})


async def db_not_configured_handler(_: Request, exc: DatabaseNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": {"code": "DATABASE_NOT_CONFIGURED", "message": str(exc),
                                                            "details": {}}})


async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Body/query shape errors use the same envelope as every other error (API.md §1: VALIDATION_ERROR 422).
    Only field locations and messages are returned — never the submitted values (they may hold credentials)."""
    fields = [{"field": ".".join(str(p) for p in e.get("loc", ()) if p != "body"), "message": e.get("msg", "")}
              for e in exc.errors()]
    first = fields[0] if fields else {"field": "", "message": "invalid request"}
    message = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return JSONResponse(status_code=422, content={"error": {"code": "VALIDATION_ERROR", "message": message,
                                                            "details": {"fields": fields}}})


_log = logging.getLogger("brewsync")


async def database_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """A database failure (deadlock, lock/statement timeout, dropped connection). Usually rolled back, but a
    connection lost during COMMIT is a genuinely unknown outcome, so the client resolves it by retrying
    the SAME request (same Idempotency-Key). No SQL is exposed."""
    _log.warning("database error: %s", type(getattr(exc, "orig", exc)).__name__)
    return JSONResponse(status_code=503, content={"error": {
        "code": "SERVICE_BUSY", "message": "The server was busy and the change may not have been saved. Check before trying again (a retry of the same request is safe).", "details": {}}})


async def conflict_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """A uniqueness/reference rule refused the write (usually two people changing the same thing at
    once). Rolled back; the constraint name and SQL are not exposed."""
    _log.warning("integrity error: %s", type(getattr(exc, "orig", exc)).__name__)
    return JSONResponse(status_code=409, content={"error": {
        "code": "CONFLICT", "message": "This change conflicts with another change made at the same time. "
                                       "Reload and try again.", "details": {}}})


async def unexpected_error_handler(_: Request, exc: Exception) -> JSONResponse:
    _log.exception("unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"error": {
        "code": "INTERNAL_ERROR", "message": "Something went wrong on the server; the change may not have been saved. Check before trying again.", "details": {}}})
