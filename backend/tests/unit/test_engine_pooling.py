"""Serverless engine configuration: no app-side pool in Production, no prepared statements behind a
transaction pooler, unchanged local pooling. Engines are created but never connected (fake hosts)."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from sqlalchemy.pool import NullPool, QueuePool

from app.core.config import Settings
from app.database import connection
from app.database.connection import make_engine, uses_transaction_pooler

TX_POOLER = "postgresql+psycopg://user:secret@pooler.example.invalid:6543/postgres"
SESSION_POOLER = "postgresql+psycopg://user:secret@pooler.example.invalid:5432/postgres"
LOCAL = "postgresql+psycopg://user:secret@localhost:5432/brewsync_dev"


def settings(**overrides: object) -> Settings:
    base = {"environment": "development", "brewsync_allow_remote_db": False, "database_url": None}
    return Settings(_env_file=None, **{**base, **overrides})  # type: ignore[call-arg]


def connect_args(engine: object) -> dict:
    """Keyword arguments the engine would pass to psycopg.connect (the DBAPI call is mocked)."""
    with mock.patch.object(engine.dialect, "connect") as dbapi_connect:  # type: ignore[attr-defined]
        try:
            engine.raw_connection().close()  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 — on-connect hooks may trip over the mock; the call is recorded
            pass
    return dict(dbapi_connect.call_args.kwargs)


class EnginePoolingTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        for key in ("VERCEL", "VERCEL_ENV"):
            os.environ.pop(key, None)
        self.addCleanup(patcher.stop)
        self.addCleanup(connection.get_engine.cache_clear)
        connection.get_engine.cache_clear()

    def test_serverless_engine_uses_null_pool(self) -> None:
        engine = make_engine(TX_POOLER, "brewsync", serverless=True)
        self.assertIsInstance(engine.pool, NullPool)

    def test_transaction_pooler_disables_prepared_statements(self) -> None:
        self.assertTrue(uses_transaction_pooler(TX_POOLER))
        self.assertFalse(uses_transaction_pooler(SESSION_POOLER))
        self.assertFalse(uses_transaction_pooler(LOCAL))
        self.assertFalse(uses_transaction_pooler("postgresql+psycopg2://u:p@h.example.invalid:6543/x"))
        engine = make_engine(TX_POOLER, "brewsync", serverless=True)
        self.assertIn("prepare_threshold", connect_args(engine))
        self.assertIsNone(connect_args(engine)["prepare_threshold"])
        self.assertNotIn("prepare_threshold", connect_args(make_engine(SESSION_POOLER, "brewsync", serverless=True)))

    def test_local_engine_keeps_queue_pool_and_prepared_statements(self) -> None:
        engine = make_engine(LOCAL, "brewsync")
        self.assertIsInstance(engine.pool, QueuePool)
        self.assertNotIn("prepare_threshold", connect_args(engine))
        self.assertEqual(engine.get_execution_options()["schema_translate_map"], {None: "brewsync"})

    def test_get_engine_production_is_serverless(self) -> None:
        with mock.patch.object(connection, "get_settings",
                               return_value=settings(environment="production", database_url=TX_POOLER)):
            engine = connection.get_engine()
        self.assertIsInstance(engine.pool, NullPool)
        self.assertIsNone(connect_args(engine)["prepare_threshold"])

    def test_get_engine_on_vercel_is_serverless(self) -> None:
        with mock.patch.dict(os.environ, {"VERCEL": "1", "VERCEL_ENV": "production"}), \
                mock.patch.object(connection, "get_settings", return_value=settings(database_url=TX_POOLER)):
            engine = connection.get_engine()
        self.assertIsInstance(engine.pool, NullPool)

    def test_get_engine_local_development_keeps_queue_pool(self) -> None:
        with mock.patch.object(connection, "get_settings", return_value=settings(database_url=LOCAL)):
            engine = connection.get_engine()
        self.assertIsInstance(engine.pool, QueuePool)

    def test_remote_guard_still_refuses_before_engine_creation(self) -> None:
        with mock.patch.object(connection, "get_settings", return_value=settings(database_url=TX_POOLER)), \
                mock.patch.object(connection, "make_engine") as make:
            with self.assertRaises(connection.DatabaseNotConfigured):
                connection.get_engine()
        make.assert_not_called()


if __name__ == "__main__":
    unittest.main()
