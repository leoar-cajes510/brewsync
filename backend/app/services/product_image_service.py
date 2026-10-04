"""Product images (Q-ARCH-2): validate, store in object storage, keep only the public URL on the product.

The browser downsizes and re-encodes images before upload; the server still validates independently
(declared type, magic bytes, basic structure, size) so a modified client cannot store SVG/HTML or
oversized files. Storage runs inside the request's transaction: an upload made before a failure is
removed again by the caller, and the previous object is deleted only after the new URL committed.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError, not_found, validation
from app.domain.identity import PermissionKey
from app.models import ProductRow
from app.repositories.product_repository import ProductRepository
from app.repositories.system_repository import SystemRepository
from app.services.base import Actor, audit, now, parse_uuid
from app.services.product_service import product_dto
from app.services.storage_service import ObjectStorage

StorageFactory = Callable[[], ObjectStorage]

MAX_IMAGE_BYTES = 2 * 1024 * 1024
EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}


def detect_image_type(data: bytes) -> str | None:
    """MIME type from the file's own bytes (PNG / JPEG / WEBP only), with a basic structure check."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR" and b"IEND" in data[-16:]:
        return "image/png"
    if data[:3] == b"\xff\xd8\xff" and b"\xff\xd9" in data[-16:]:
        return "image/jpeg"
    if (data[:4] == b"RIFF" and data[8:12] == b"WEBP" and data[12:16] in (b"VP8 ", b"VP8L", b"VP8X")
            and int.from_bytes(data[4:8], "little") + 8 <= len(data)):
        return "image/webp"
    return None


def validate_image(data: bytes, content_type: str | None) -> str:
    declared = (content_type or "").split(";")[0].strip().lower()
    if declared == "image/jpg":
        declared = "image/jpeg"
    if declared not in EXTENSIONS:
        raise AppError("UNSUPPORTED_MEDIA_TYPE", 415, "Use a PNG, JPG or WEBP image.")
    if not data:
        raise validation("The image file is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise AppError("PAYLOAD_TOO_LARGE", 413, "The image must be 2 MB or smaller after optimization.")
    detected = detect_image_type(data)
    if detected is None:
        raise validation("The file is not a valid PNG, JPG or WEBP image.")
    if detected != declared:
        raise validation("The file content does not match its image type.")
    return detected


def _product(session: Session, actor: Actor, product_id: str) -> ProductRow:
    actor.require(PermissionKey.PRODUCTS_EDIT)
    row = ProductRepository(session).product(parse_uuid(product_id, "product"))
    if row is None or row.business_id != actor.business_id or row.deleted_at is not None:
        raise not_found("product")
    return row


def set_image(session: Session, actor: Actor, product_id: str, data: bytes, content_type: str | None,
              get_storage: StorageFactory, uploaded: list[str]) -> tuple[dict[str, Any], str | None]:
    """Store a new image and point the product at it. Returns (product, previous object path to delete
    after commit). Every object stored here is appended to ``uploaded`` so the caller can remove it if
    the transaction fails."""
    row = _product(session, actor, product_id)
    mime = validate_image(data, content_type)
    storage = get_storage()  # after auth/permission/validation: storage config is not revealed to callers
    path = f"{row.business_id}/{row.id}/{uuid.uuid4()}.{EXTENSIONS[mime]}"
    url = storage.upload(path, data, mime)
    uploaded.append(path)
    previous_url = row.image_url
    row.image_url = url
    row.updated_at = now()
    session.flush()
    audit(SystemRepository(session), actor, actor.business_id, "product.image_updated", "product", row.id,
          before={"image_url": previous_url}, after={"image_url": url})
    return product_dto(row), storage.path_from_url(previous_url)


def clear_image(session: Session, actor: Actor, product_id: str,
                get_storage: StorageFactory) -> tuple[dict[str, Any], str | None]:
    """Remove the product's image. Returns (product, object path to delete after commit)."""
    row = _product(session, actor, product_id)
    storage = get_storage()
    previous_url = row.image_url
    if previous_url is not None:
        row.image_url = None
        row.updated_at = now()
        session.flush()
        audit(SystemRepository(session), actor, actor.business_id, "product.image_removed", "product", row.id,
              before={"image_url": previous_url}, after={"image_url": None})
    return product_dto(row), storage.path_from_url(previous_url)
