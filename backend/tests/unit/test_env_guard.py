"""Remote-database guard: local tools and tests never reach a remote PostgreSQL by accident.

Uses a fake ``.invalid`` host; nothing here opens a connection.
"""

from __future__ import annotations

import os
import unittest
from unittest import mock

from app.core.config import RemoteDatabaseRefused, Settings, ensure_database_allowed, is_local_database

REMOTE = "postgresql+psycopg://user:secret@db.example.invalid:5432/postgres"
LOCAL = "postgresql+psycopg://user:secret@localhost:5432/brewsync_dev"


def settings(**overrides: object) -> Settings:
    base = {"environment": "development", "brewsync_allow_remote_db": False, "database_url": None}
    return Settings(_env_file=None, **{**base, **overrides})  # type: ignore[call-arg]


class RemoteDatabaseGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        os.environ.pop("VERCEL_ENV", None)
        self.addCleanup(patcher.stop)

    def test_local_hosts_are_always_allowed(self) -> None:
        for url in (LOCAL, "postgresql+psycopg://u@127.0.0.1/x", "postgresql+psycopg://u@[::1]/x",
                    "postgresql+psycopg:///x"):
            self.assertTrue(is_local_database(url), url)
            ensure_database_allowed(url, settings())

    def test_remote_host_refused_in_development_and_test(self) -> None:
        for env in ("development", "test", ""):
            with self.assertRaises(RemoteDatabaseRefused) as ctx:
                ensure_database_allowed(REMOTE, settings(environment=env))
            self.assertNotIn("secret", str(ctx.exception))  # never echoes credentials
            self.assertIn("db.example.invalid", str(ctx.exception))

    def test_remote_host_allowed_in_production_or_with_explicit_override(self) -> None:
        ensure_database_allowed(REMOTE, settings(environment="production"))
        ensure_database_allowed(REMOTE, settings(environment="Production "))
        ensure_database_allowed(REMOTE, settings(brewsync_allow_remote_db=True))
        with mock.patch.dict(os.environ, {"VERCEL_ENV": "production"}):
            ensure_database_allowed(REMOTE, settings())
        with mock.patch.dict(os.environ, {"VERCEL_ENV": "preview"}):  # previews never reach a remote DB
            with self.assertRaises(RemoteDatabaseRefused):
                ensure_database_allowed(REMOTE, settings())

    def test_app_engine_refuses_before_connecting(self) -> None:
        from app.database import connection
        with mock.patch.object(connection, "get_settings", return_value=settings(database_url=REMOTE)), \
                mock.patch.object(connection, "make_engine") as make_engine:
            connection.get_engine.cache_clear()
            with self.assertRaises(connection.DatabaseNotConfigured) as ctx:
                connection.get_engine()
            connection.get_engine.cache_clear()
        make_engine.assert_not_called()
        self.assertNotIn("example.invalid", str(ctx.exception))  # host detail stays in the server log


if __name__ == "__main__":
    unittest.main()
