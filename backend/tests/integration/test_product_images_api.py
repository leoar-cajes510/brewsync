"""POST/DELETE /products/{id}/image against the real database, with object storage replaced by an
in-memory fake (Supabase is never contacted)."""

import dataclasses
import io
import unittest
import uuid

from db_support import DbTestCase
from PIL import Image

from app.core.exceptions import AppError
from app.services import storage_service


def encode(fmt: str, size: tuple[int, int] = (8, 6), **params) -> bytes:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 120, 40)).save(buf, fmt, **params)
    return buf.getvalue()


PNG = encode("PNG")
WEBP = encode("WEBP", quality=92)
JPEG = encode("JPEG")
PREFIX = "https://storage.example.invalid/storage/v1/object/public/product-images/"


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail_upload = False
        self.fail_delete = False

    def upload(self, path: str, data: bytes, content_type: str) -> str:
        if self.fail_upload:
            raise storage_service.storage_unavailable()
        assert path not in self.objects, "uploads never overwrite"
        self.objects[path] = (data, content_type)
        return PREFIX + path

    def delete(self, path: str) -> None:
        if self.fail_delete:
            raise storage_service.storage_unavailable()
        self.objects.pop(path, None)

    def path_from_url(self, url: str | None) -> str | None:
        return url[len(PREFIX):] if url and url.startswith(PREFIX) else None


class ProductImageApiTests(DbTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.storage = FakeStorage()
        storage_service.set_storage(self.storage)
        self.addCleanup(storage_service.set_storage, None)
        self.env = self.bootstrap()
        self.ids = self.catalog(self.env["admin"])

    def upload(self, product_id: str, data: bytes, content_type: str, token: str | None = None, expect: int = 200):
        headers = {"Authorization": f"Bearer {token or self.env['admin']}", "Content-Type": content_type}
        r = self.client.post(f"/api/v1/products/{product_id}/image", content=data, headers=headers)
        self.assertEqual(r.status_code, expect, r.text)
        return r

    def image_url(self, product_id: str):
        return self.scalar("SELECT image_url FROM {s}.products WHERE id = :id", id=product_id)

    def test_upload_saves_public_url_and_lists_it_for_admin_and_pos(self) -> None:
        latte = self.ids["latte"]
        body = self.upload(latte, WEBP, "image/webp").json()
        url = body["image_url"]
        self.assertTrue(url.startswith(PREFIX))
        path = url[len(PREFIX):]
        business = self.scalar("SELECT business_id FROM {s}.products WHERE id = :id", id=latte)
        self.assertRegex(path, rf"^{business}/{latte}/[0-9a-f-]{{36}}\.webp$")
        self.assertEqual(self.storage.objects[path], (WEBP, "image/webp"))
        self.assertEqual(self.image_url(latte), url)  # only the URL is stored in PostgreSQL
        admin_list = {p["id"]: p for p in self.call("GET", "/products", self.env["admin"], expect=200).json()}
        self.assertEqual(admin_list[latte]["image_url"], url)
        menu = self.call("GET", "/pos/menu", self.env["admin"], expect=200).json()
        self.assertIn(url, [p.get("image_url") for p in menu["products"]])
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.audit_logs WHERE action = 'product.image_updated'"), 1)

    def test_png_and_jpeg_accepted(self) -> None:
        self.assertTrue(self.upload(self.ids["latte"], PNG, "image/png").json()["image_url"].endswith(".png"))
        self.assertTrue(self.upload(self.ids["cookie"], JPEG, "image/jpeg").json()["image_url"].endswith(".jpg"))

    def test_high_resolution_webp_within_limit_accepted(self) -> None:
        hi = encode("WEBP", (1600, 1200), quality=92)
        url = self.upload(self.ids["latte"], hi, "image/webp").json()["image_url"]
        self.assertEqual(self.storage.objects[url[len(PREFIX):]][0], hi)

    def test_replacement_removes_previous_object(self) -> None:
        latte = self.ids["latte"]
        first = self.upload(latte, WEBP, "image/webp").json()["image_url"]
        second = self.upload(latte, PNG, "image/png").json()["image_url"]
        self.assertNotEqual(first, second)
        self.assertEqual(list(self.storage.objects), [second[len(PREFIX):]])
        self.assertEqual(self.image_url(latte), second)

    def test_delete_clears_url_and_object(self) -> None:
        latte = self.ids["latte"]
        self.upload(latte, WEBP, "image/webp")
        r = self.call("DELETE", f"/products/{latte}/image", self.env["admin"], expect=200).json()
        self.assertIsNone(r["image_url"])
        self.assertIsNone(self.image_url(latte))
        self.assertEqual(self.storage.objects, {})
        self.assertEqual(self.scalar("SELECT count(*) FROM {s}.audit_logs WHERE action = 'product.image_removed'"), 1)
        self.call("DELETE", f"/products/{latte}/image", self.env["admin"], expect=200)  # idempotent

    def test_invalid_files_rejected_without_storing(self) -> None:
        latte = self.ids["latte"]
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        self.assertEqual(self.error_code(self.upload(latte, svg, "image/svg+xml", expect=415)), "UNSUPPORTED_MEDIA_TYPE")
        self.assertEqual(self.error_code(self.upload(latte, svg, "image/png", expect=422)), "VALIDATION_ERROR")
        big = PNG[:-12] + b"\x00" * (3 * 1024 * 1024) + PNG[-12:]
        self.assertEqual(self.error_code(self.upload(latte, big, "image/png", expect=413)), "PAYLOAD_TOO_LARGE")
        malformed = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 32 + b"\xff\xd9"
        self.assertEqual(self.error_code(self.upload(latte, malformed, "image/jpeg", expect=422)), "VALIDATION_ERROR")
        self.assertEqual(self.storage.objects, {})
        self.assertIsNone(self.image_url(latte))

    def test_products_edit_permission_required(self) -> None:
        cashier = self.make_cashier(self.env["admin"], self.env["device"])
        latte = self.ids["latte"]
        r = self.upload(latte, WEBP, "image/webp", token=cashier, expect=403)
        self.assertEqual(self.error_code(r), "PERMISSION_DENIED")
        self.call("DELETE", f"/products/{latte}/image", cashier, expect=403)
        self.assertEqual(self.storage.objects, {})
        no_auth = self.client.post(f"/api/v1/products/{latte}/image", content=WEBP,
                                   headers={"Content-Type": "image/webp"})
        self.assertEqual(no_auth.status_code, 401)

    def test_wrong_business_or_unknown_product_rejected(self) -> None:
        self.upload(str(uuid.uuid4()), WEBP, "image/webp", expect=404)
        from app.services.auth_service import authenticate
        from app.services.product_image_service import set_image
        with self.factory() as session:
            actor = authenticate(session, self.env["admin"])
            other = dataclasses.replace(actor, business_id=uuid.uuid4())
            with self.assertRaises(AppError) as ctx:
                set_image(session, other, self.ids["latte"], WEBP, "image/webp", lambda: self.storage, [])
            self.assertEqual(ctx.exception.status, 404)
        self.assertEqual(self.storage.objects, {})

    def test_storage_failure_keeps_product_unchanged(self) -> None:
        latte = self.ids["latte"]
        original = self.upload(latte, WEBP, "image/webp").json()["image_url"]
        self.storage.fail_upload = True
        r = self.upload(latte, PNG, "image/png", expect=502)
        self.assertEqual(self.error_code(r), "STORAGE_UNAVAILABLE")
        self.assertEqual(self.image_url(latte), original)
        self.storage.fail_upload = False
        self.storage.fail_delete = True  # the old object cannot be removed: the change still commits
        newer = self.upload(latte, PNG, "image/png").json()["image_url"]
        self.assertEqual(self.image_url(latte), newer)
        r = self.call("DELETE", f"/products/{latte}/image", self.env["admin"], expect=200)
        self.assertIsNone(self.image_url(latte))
        self.assertEqual(self.call("GET", "/products", self.env["admin"], expect=200).status_code, 200)

    def test_failed_transaction_removes_new_object(self) -> None:
        from unittest import mock
        from app.services import product_image_service
        latte = self.ids["latte"]
        with mock.patch.object(product_image_service, "audit", side_effect=RuntimeError("db write failed")):
            with self.assertRaises(RuntimeError):
                self.client.post(f"/api/v1/products/{latte}/image", content=WEBP,
                                 headers={"Authorization": f"Bearer {self.env['admin']}", "Content-Type": "image/webp"})
        self.assertEqual(self.storage.objects, {})
        self.assertIsNone(self.image_url(latte))

    def test_create_ignores_client_supplied_image_url(self) -> None:
        cat = self.ids["category"]
        p = self.call("POST", "/products", self.env["admin"], {"name": "Mocha", "category_id": cat, "price": "150.00",
                      "tax_class": "taxable", "image_url": "https://evil.example/x.svg"}, expect=201).json()
        self.assertIsNone(p["image_url"])


if __name__ == "__main__":
    unittest.main()
