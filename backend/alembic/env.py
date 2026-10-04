"""Alembic environment.

Tables are defined without a schema; every migration runs with
``schema_translate_map={None: <schema>}`` so BrewSync lives in its own Postgres schema
(``DB_SCHEMA``, default ``brewsync``) and never touches other tables in the same database.
The URL comes from ``DATABASE_URL`` (or ``-x url=...`` / ``-x schema=...`` for tests).

Safety: the target host/database/schema is printed before anything runs. A non-local host is refused
unless the URL is given explicitly with ``-x url=...`` AND confirmed with ``-x confirm_host=<host>``, and the
run is production (ENVIRONMENT=production) or deliberately allowed (BREWSYNC_ALLOW_REMOTE_DB=1). A plain
``alembic upgrade head`` therefore can only migrate a local database.
"""

from __future__ import annotations

import sys

from alembic import context
from sqlalchemy import create_engine, text

import app.models  # noqa: F401  (registers tables)
from app.core.config import database_target, ensure_database_allowed, get_settings, is_local_database
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


def _check_target() -> None:
    host, database = database_target(url)
    print(f"alembic target: host={host or 'local socket'} database={database} schema={schema} "
          f"ENVIRONMENT={settings.environment}", file=sys.stderr)
    if is_local_database(url):
        return
    if "url" not in x_args:
        raise SystemExit(f"Refusing to migrate remote host {host}: pass the URL explicitly with -x url=... "
                         f"and -x confirm_host={host} (no fallback to DATABASE_URL for remote databases).")
    if x_args.get("confirm_host", "").lower() != host:
        raise SystemExit(f"Refusing to migrate remote host {host}: add -x confirm_host={host} to confirm.")
    ensure_database_allowed(url, settings)


def run_migrations_online() -> None:
    if not url:
        raise RuntimeError("DATABASE_URL is not set (see .env.example)")
    _check_target()
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
