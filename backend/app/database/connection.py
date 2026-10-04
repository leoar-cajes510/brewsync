"""Engine creation from ``DATABASE_URL``. No credentials live in code."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from sqlalchemy import Engine, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from app.core.config import RemoteDatabaseRefused, ensure_database_allowed, get_settings, is_production

# Supabase's transaction pooler (Supavisor) listens on 6543; it cannot keep server-side prepared statements.
TRANSACTION_POOLER_PORT = 6543


class DatabaseNotConfigured(RuntimeError):
    pass


def uses_transaction_pooler(url: str) -> bool:
    """psycopg through a transaction-mode pooler (port 6543): prepared statements must be disabled."""
    parsed = make_url(url)
    return parsed.get_driver_name() == "psycopg" and parsed.port == TRANSACTION_POOLER_PORT


def make_engine(url: str, schema: str, *, serverless: bool = False) -> Engine:
    """``serverless`` (Vercel/Production): no app-side pool — every short-lived function instance
    would otherwise hold its own idle connections and exhaust the external pooler (EMAXCONNSESSION).
    Locally a normal QueuePool is kept."""
    options: dict[str, Any] = {"poolclass": NullPool} if serverless else {
        "pool_pre_ping": False,  # saves a round trip per request; stale connections are recycled instead
        "pool_recycle": 300,
    }
    if uses_transaction_pooler(url):
        options["connect_args"] = {"prepare_threshold": None}
    return create_engine(
        url,
        future=True,
        execution_options={"schema_translate_map": {None: schema}},
        **options,
    )


def is_serverless(settings: Any) -> bool:
    return is_production(settings) or bool(os.environ.get("VERCEL"))


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if not settings.database_url:
        raise DatabaseNotConfigured("DATABASE_URL is not set (see .env.example)")
    try:
        ensure_database_allowed(settings.database_url, settings)
    except RemoteDatabaseRefused as exc:  # served as 503 DATABASE_NOT_CONFIGURED, never silently connected
        logging.getLogger(__name__).error("%s", exc)  # host detail stays in the server log
        raise DatabaseNotConfigured("Remote database refused outside production (see server log)") from exc
    return make_engine(settings.database_url, settings.db_schema, serverless=is_serverless(settings))
