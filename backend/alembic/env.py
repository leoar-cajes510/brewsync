"""Alembic environment.

Tables are defined without a schema; every migration runs with
``schema_translate_map={None: <schema>}`` so BrewSync lives in its own Postgres schema
(``DB_SCHEMA``, default ``brewsync``) and never touches other tables in the same database.
The URL comes from ``DATABASE_URL`` (or ``-x url=...`` / ``-x schema=...`` for tests).
"""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine, text

import app.models  # noqa: F401  (registers tables)
from app.core.config import get_settings
from app.database.base import Base

config = context.config
x_args = context.get_x_argument(as_dictionary=True)
settings = get_settings()
url = x_args.get("url") or settings.database_url
schema = x_args.get("schema") or settings.db_schema
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=url or "postgresql+psycopg://", target_metadata=target_metadata, literal_binds=True,
                      version_table_schema=schema, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    if not url:
        raise RuntimeError("DATABASE_URL is not set (see .env.example)")
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
            connection.commit()
            connection = connection.execution_options(schema_translate_map={None: schema})
            context.configure(connection=connection, target_metadata=target_metadata, version_table_schema=schema)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()  # close the pooled connection now instead of leaving it to the garbage collector


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
