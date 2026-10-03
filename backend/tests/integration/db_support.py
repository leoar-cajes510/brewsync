"""Integration-test harness against a REAL PostgreSQL database.

- Uses DATABASE_URL from the environment / .env; tests are skipped (not faked) without it.
- Everything runs in a separate schema (TEST_DB_SCHEMA, default ``brewsync_test``) created by
  the real Alembic migration, so the application schema and any other tables are untouched.
- Each test starts from an EMPTY database (tables truncated); data is created through the API,
  starting with the real setup wizard. No seed data exists.
"""

from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("INTERIM_ADMIN_LOGIN_WITHOUT_TERMINAL", "true")  # back-office scenario tests only
os.environ.setdefault("SETUP_TOKEN", "integration-test-setup-token")  # Q-AUTH-8, tests only

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()
SETTINGS = get_settings()
SCHEMA = os.environ.get("TEST_DB_SCHEMA", "brewsync_test")
DB_URL = SETTINGS.database_url

_migrated = False


def migrate_fresh() -> None:
    """Drop and recreate the test schema with the real migration (once per test run)."""
    global _migrated
    if _migrated:
        return
    from sqlalchemy import create_engine
    engine = create_engine(DB_URL)
    with engine.begin() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'))
    engine.dispose()
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.cmd_opts = type("o", (), {"x": [f"url={DB_URL}", f"schema={SCHEMA}"]})()  # type: ignore[assignment]
    command.upgrade(cfg, "head")
    _migrated = True


@unittest.skipUnless(DB_URL, "DATABASE_URL not configured — integration tests need a real PostgreSQL")
class DbTestCase(unittest.TestCase):
    engine: Any

    @classmethod
    def setUpClass(cls) -> None:
        migrate_fresh()
        from app.database.connection import make_engine
        from app.database.session import make_session_factory
        from app.main import app
        from app.routers.api import set_session_factory
        cls.engine = make_engine(DB_URL, SCHEMA)
        cls.factory = make_session_factory(cls.engine)
        set_session_factory(cls.factory)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.engine.dispose()

    def setUp(self) -> None:
        import app.models  # noqa: F401
        from app.database.base import Base
        names = ", ".join(f'"{SCHEMA}"."{t.name}"' for t in Base.metadata.sorted_tables)
        with self.engine.begin() as conn:
            conn.execute(text(f"TRUNCATE {names} CASCADE"))
        from app.services.setup_service import reset_setup_cache
        reset_setup_cache()  # the database was emptied outside the app

    # --- SQL helpers ----------------------------------------------------------------------------------------
    def scalar(self, sql: str, **params: Any) -> Any:
        with self.engine.connect() as conn:
            return conn.execute(text(sql.replace("{s}", f'"{SCHEMA}"')), params).scalar()

    def execute(self, sql: str, **params: Any) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(sql.replace("{s}", f'"{SCHEMA}"')), params)

    # --- API helpers --------------------------------------------------------------------------------------------
    def call(self, method: str, path: str, token: str | None = None, json: Any = None, key: str | None = None,
             device: str | None = None, expect: int | None = None) -> Any:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if key:
            headers["Idempotency-Key"] = key
        if device:
            headers["X-Device-Credential"] = device
        response = self.client.request(method, f"/api/v1{path}", headers=headers, json=json)
        if expect is not None:
            self.assertEqual(response.status_code, expect, response.text)
        return response

    def error_code(self, response: Any) -> str:
        return response.json()["error"]["code"]

    # --- scenario builders (test data created through the real API) --------------------------------------------
    SETUP = {
        "business": {"name": "Test Café", "business_type": "Café", "currency_code": "PHP", "timezone": "Asia/Manila"},
        "admin": {"full_name": "Owner Admin", "username": "owner", "password": "correct-horse-1"},
        "security": {"idle_timeout_minutes": 15, "credential_policy": {"min_password_length": 10, "pin_length": 4,
                                                                      "max_failed_attempts": 3, "lockout_minutes": 15}},
        "settings": {
            "features": {"inventory": True, "analytics": True, "expenses": True, "refunds": True, "discounts": True,
                         "ingredients": True, "lowStockAlerts": True, "orderAlerts": True, "liveUpdates": True,
                         "soundEffects": False},
            "staffing": {"max_admins": 2, "max_staff": 10, "max_terminals": 5, "low_stock_threshold": 5,
                         "order_waiting_minutes": 10},
            "payments": {"enabled_methods": ["cash", "gcash", "card", "bank_transfer"],
                         "options": {"cash": {"require_cash_received": True}, "gcash": {"require_reference": True}},
                         "cash_rounding": {"enabled": False}},
            "archiving": {"auto_archive_after_hours": 24, "restore_window_hours": 48},
        },
    }

    def complete_setup(self) -> dict:
        """Setup with the installer token; returns the first terminal and its one-time code (Q-TRM-8)."""
        r = self.client.post("/api/v1/setup/complete", json=self.SETUP,
                             headers={"X-Setup-Token": os.environ["SETUP_TOKEN"]})
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()["first_terminal"]

    def admin_backoffice_token(self) -> str:
        r = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"}, expect=200)
        return r.json()["token"]

    def register_and_activate(self, admin: str, code: str = "REG-01") -> str:
        r = self.call("POST", "/terminals", admin, {"code": code, "name": "Front Counter", "activation_code_minutes": 30},
                      expect=201)
        r = self.call("POST", "/terminals/activate", json={"terminal_code": code,
                                                           "activation_code": r.json()["activation_code"]}, expect=200)
        return r.json()["device_credential"]

    def bootstrap(self) -> dict[str, str]:
        """Setup wizard (token) → first-terminal activation → Admin POS login (+ back-office token)."""
        first = self.complete_setup()
        backoffice = self.admin_backoffice_token()
        device = self.call("POST", "/terminals/activate", json={"terminal_code": first["code"],
                           "activation_code": first["activation_code"]}, expect=200).json()["device_credential"]
        admin = self.call("POST", "/auth/login", json={"username": "owner", "credential": "correct-horse-1"},
                          device=device, expect=200).json()["token"]
        return {"admin": admin, "device": device, "backoffice": backoffice}

    def make_cashier(self, admin: str, device: str) -> str:
        self.call("POST", "/staff", admin, {"full_name": "Maria Cruz", "username": "maria", "role": "cashier",
                                            "auth_method": "pin", "credential": "1234"}, expect=201)
        token = self.call("POST", "/auth/login", json={"username": "maria", "credential": "1234"}, device=device,
                          expect=200).json()["token"]
        self.call("POST", "/auth/change-pin", token, {"current": "1234", "new": "5678"}, expect=200)
        return token

    def catalog(self, admin: str, *, stock: int = 10) -> dict[str, str]:
        cat = self.call("POST", "/categories", admin, {"name": "Coffee", "code_prefix": "COF"}, expect=201).json()["id"]
        latte = self.call("POST", "/products", admin, {
            "code": "LATTE", "name": "Latte", "category_id": cat, "price": "250.00", "tax_class": "taxable",
            "track_units": True, "initial_stock": stock, "low_stock_threshold": 2}, expect=201).json()["id"]
        cookie = self.call("POST", "/products", admin, {
            "code": "COOKIE", "name": "Cookie", "category_id": cat, "price": "100.00", "tax_class": "non_taxable"},
            expect=201).json()["id"]
        return {"category": cat, "latte": latte, "cookie": cookie}

    def order(self, token: str, lines: list[dict], key: str | None = None, expect: int = 201, **extra: Any) -> Any:
        body = {"order_type": "takeout", "lines": lines, **extra}
        return self.call("POST", "/orders", token, body, key=key or str(uuid.uuid4()), expect=expect)

    def pay(self, token: str, order_id: str, body: dict, key: str | None = None, expect: int = 201) -> Any:
        return self.call("POST", f"/orders/{order_id}/payments", token, body, key=key or str(uuid.uuid4()),
                         expect=expect)

    def status(self, token: str, order_id: str, target: str, expect: int = 200, key: str | None = None) -> Any:
        return self.call("POST", f"/orders/{order_id}/status", token, {"target": target},
                         key=key or str(uuid.uuid4()), expect=expect)
