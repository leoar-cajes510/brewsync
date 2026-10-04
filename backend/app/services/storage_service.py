"""Server-only object storage for product images (Q-ARCH-2: Supabase Storage).

Talks to the Supabase Storage REST API with the service-role key from server settings; the key and
the upload path never reach the browser — the browser only ever sees the object's public URL.
Tests replace the client with ``set_storage``; nothing here runs at import time.
"""

from __future__ import annotations

import logging
from typing import Protocol
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.core.exceptions import AppError

log = logging.getLogger(__name__)


class ObjectStorage(Protocol):
    def upload(self, path: str, data: bytes, content_type: str) -> str:
        """Store ``data`` at ``path`` (never overwriting) and return its public URL."""

    def delete(self, path: str) -> None: ...

    def path_from_url(self, url: str | None) -> str | None:
        """The object path of a URL this storage issued, else None (foreign URLs are never deleted)."""


class SupabaseStorage:
    def __init__(self, base_url: str, service_key: str, bucket: str, *, timeout: float = 15.0) -> None:
        self.base = base_url.rstrip("/")
        self.bucket = bucket
        self._headers = {"Authorization": f"Bearer {service_key}", "apikey": service_key}
        self._timeout = timeout

    def _object_url(self, path: str) -> str:
        return f"{self.base}/storage/v1/object/{quote(self.bucket)}/{quote(path)}"

    def public_prefix(self) -> str:
        return f"{self.base}/storage/v1/object/public/{quote(self.bucket)}/"

    def upload(self, path: str, data: bytes, content_type: str) -> str:
        try:
            r = httpx.post(self._object_url(path), content=data, timeout=self._timeout,
                           headers={**self._headers, "Content-Type": content_type, "x-upsert": "false",
                                    "Cache-Control": "max-age=31536000"})
        except httpx.HTTPError as exc:
            log.error("Storage upload failed: %s", type(exc).__name__)
            raise storage_unavailable() from exc
        if r.status_code >= 300:
            log.error("Storage upload rejected: HTTP %s", r.status_code)  # body may echo request detail; not logged
            raise storage_unavailable()
        return self.public_prefix() + quote(path)

    def delete(self, path: str) -> None:
        try:
            r = httpx.delete(self._object_url(path), headers=self._headers, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise storage_unavailable() from exc
        if r.status_code >= 300 and r.status_code != 404:  # already gone is fine
            raise storage_unavailable()

    def path_from_url(self, url: str | None) -> str | None:
        prefix = self.public_prefix()
        if not url or not url.startswith(prefix):
            return None
        path = url[len(prefix):]
        return path or None


def storage_unavailable() -> AppError:
    return AppError("STORAGE_UNAVAILABLE", 502, "Image storage is unavailable. Try again later.")


_override: ObjectStorage | None = None


def set_storage(storage: ObjectStorage | None) -> None:
    """Tests inject a fake client (``None`` restores the configured one)."""
    global _override
    _override = storage


def get_storage() -> ObjectStorage:
    if _override is not None:
        return _override
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise AppError("STORAGE_NOT_CONFIGURED", 503, "Image storage is not configured on this server.")
    return SupabaseStorage(settings.supabase_url, settings.supabase_service_role_key, settings.product_image_bucket)


def delete_quietly(storage: ObjectStorage, path: str | None) -> None:
    """Best-effort cleanup after the database already committed; a leftover object is only an orphan."""
    if not path:
        return
    try:
        storage.delete(path)
    except Exception:  # noqa: BLE001 — never turn a committed change into an error
        log.warning("Could not delete stored object (left as orphan)")
