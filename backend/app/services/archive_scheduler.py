"""In-process scheduler for the automatic archive job (Q-ARC-4; API.md §4.11).

Opt-in per deployment (``AUTO_ARCHIVE_ENABLED``). Each tick archives completed orders whose
``completed_at + archiving.auto_archive_after`` has passed. Nothing happens until setup is
complete and the Admin has configured Settings → archiving (no default timing — Q-SET-4).
"""

from __future__ import annotations

import logging
import threading

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.repositories.system_repository import SystemRepository
from app.services.archive_service import run_auto_archive
from app.services.base import section
from app.domain.identity import SetupStatus

log = logging.getLogger("brewsync.archive")


def tick(session: Session) -> int:
    """One pass; returns the number of orders archived (0 when not configured)."""
    system = SystemRepository(session)
    state, business = system.system_state(), system.business()
    if state is None or state.setup_status != SetupStatus.COMPLETED.value or business is None:
        return 0
    data = section(system, business.id, "archiving", required=False) or {}
    if not data.get("auto_archive_after_hours") or not data.get("restore_window_hours"):
        return 0
    return run_auto_archive(session, business.id)


def start() -> threading.Event | None:
    """Starts the background loop when enabled; returns its stop event."""
    settings = get_settings()
    if not settings.auto_archive_enabled:
        return None
    from app.routers.api import tx  # late import: avoids a cycle at module load

    stop = threading.Event()
    interval = max(60, settings.auto_archive_interval_seconds)

    def loop() -> None:
        while not stop.wait(interval):
            try:
                count = tx(tick)
                if count:
                    log.info("auto-archived %s completed order(s)", count)
            except AppError as exc:  # a misconfigured section must not kill the loop
                log.warning("auto-archive skipped: %s", exc.message)
            except Exception:  # noqa: BLE001 - keep the scheduler alive; next tick retries
                log.exception("auto-archive tick failed")

    threading.Thread(target=loop, name="auto-archive", daemon=True).start()
    log.info("auto-archive scheduler started (every %ss)", interval)
    return stop
