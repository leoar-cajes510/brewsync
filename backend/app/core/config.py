from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application configuration loaded from environment variables / .env.

    The project-root .env and backend/.env are both read (later wins). No credentials
    are hard-coded here.
    """

    model_config = SettingsConfigDict(
        env_file=(_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env"),
        extra="ignore",
    )

    app_name: str = "BrewSync API"
    app_version: str = "0.1.0"
    environment: str = "development"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # PostgreSQL (Supabase or self-hosted — hosting is OPEN Q-ARCH-1).
    # e.g. postgresql+psycopg://user:password@host:5432/postgres
    database_url: str | None = None
    # Dedicated schema so BrewSync never touches other tables in the same database.
    db_schema: str = "brewsync"

    # Q-TRM-8 is OPEN (how the first device becomes a terminal / Admin access without a
    # terminal). Interim: every sign-in requires an activated terminal. This explicit
    # deployment flag allows Admin back-office sign-in without a device credential so a
    # fresh install can register its first terminal. Off unless set in the environment.
    interim_admin_login_without_terminal: bool = False

    # Automatic archive of completed orders (Q-ARC-4) runs in-process every interval once the
    # Admin has configured Settings → archiving. Opt-in per deployment: off unless set.
    auto_archive_enabled: bool = False

    # Q-AUTH-8 (approved option: setup token). A deployment secret the installer sets; the setup
    # wizard must present it (X-Setup-Token) to complete setup or to re-issue the first-terminal
    # code. Without it, setup is refused, so a network-reachable fresh install cannot be claimed.
    setup_token: str | None = None
    # Q-TRM-8 (approved option c): lifetime of the one-time first-terminal activation code.
    first_terminal_code_minutes: int = 15
    auto_archive_interval_seconds: int = 900


@lru_cache
def get_settings() -> Settings:
    return Settings()
