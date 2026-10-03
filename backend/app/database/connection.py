"""Engine creation from ``DATABASE_URL``. No credentials live in code."""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.core.config import get_settings


class DatabaseNotConfigured(RuntimeError):
    pass


def make_engine(url: str, schema: str) -> Engine:
    return create_engine(
        url,
        pool_pre_ping=False,  # saves a round trip per request; stale connections are recycled instead
        pool_recycle=300,
        future=True,
        execution_options={"schema_translate_map": {None: schema}},
    )


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if not settings.database_url:
        raise DatabaseNotConfigured("DATABASE_URL is not set (see .env.example)")
    return make_engine(settings.database_url, settings.db_schema)
