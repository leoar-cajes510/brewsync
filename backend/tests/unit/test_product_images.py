"""Product image validation (magic bytes, declared type, size) and the Supabase Storage client.
No network: httpx calls are mocked."""

from __future__ import annotations

import base64
import unittest
from unittest import mock

import httpx

from app.core.exceptions import AppError
from app.services import storage_service
from app.services.product_image_service import MAX_IMAGE_BYTES, detect_image_type, validate_image
from app.services.storage_service import SupabaseStorage

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
WEBP = base64.b64decode("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==")
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 32 + b"\xff\xd9"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def code(fn) -> str:  # type: ignore[no-untyped-def]
    try:
        fn()
    except AppError as exc:
        return exc.code
    return "OK"


class ImageValidationTests(unittest.TestCase):
    def test_png_jpeg_webp_accepted(self) -> None:
        self.assertEqual(validate_image(PNG, "image/png"), "image/png")
        self.assertEqual(validate_image(JPEG, "image/jpeg"), "image/jpeg")
        self.assertEqual(validate_image(JPEG, "image/jpg"), "image/jpeg")
        self.assertEqual(validate_image(WEBP, "image/webp; charset=binary"), "image/webp")

    def test_svg_html_and_other_types_rejected(self) -> None:
        self.assertEqual(code(lambda: validate_image(SVG, "image/svg+xml")), "UNSUPPORTED_MEDIA_TYPE")
        self.assertEqual(code(lambda: validate_image(b"<html></html>", "text/html")), "UNSUPPORTED_MEDIA_TYPE")
        self.assertEqual(code(lambda: validate_image(PNG, None)), "UNSUPPORTED_MEDIA_TYPE")
        self.assertEqual(code(lambda: validate_image(PNG, "image/gif")), "UNSUPPORTED_MEDIA_TYPE")

    def test_invalid_magic_bytes_and_type_mismatch_rejected(self) -> None:
        self.assertEqual(code(lambda: validate_image(SVG, "image/png")), "VALIDATION_ERROR")  # SVG disguised as PNG
        self.assertEqual(code(lambda: validate_image(PNG, "image/webp")), "VALIDATION_ERROR")
        self.assertEqual(code(lambda: validate_image(b"", "image/png")), "VALIDATION_ERROR")

    def test_malformed_files_rejected(self) -> None:
        self.assertIsNone(detect_image_type(PNG[:-12]))   # truncated: no IEND
        self.assertIsNone(detect_image_type(JPEG[:-2]))   # no EOI marker
        broken = WEBP[:4] + (10_000).to_bytes(4, "little") + WEBP[8:]  # RIFF size beyond the data
        self.assertIsNone(detect_image_type(broken))
        self.assertIsNone(detect_image_type(b"RIFF\x04\x00\x00\x00WAVEfmt "))

    def test_oversized_file_rejected(self) -> None:
        big = PNG[:-12] + b"\x00" * MAX_IMAGE_BYTES + PNG[-12:]
        self.assertEqual(code(lambda: validate_image(big, "image/png")), "PAYLOAD_TOO_LARGE")


class SupabaseStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = SupabaseStorage("https://proj.example.invalid/", "service-key", "product-images")

    def test_upload_posts_with_server_key_and_returns_public_url(self) -> None:
        with mock.patch.object(httpx, "post", return_value=httpx.Response(200)) as post:
            url = self.storage.upload("biz/prod/abc.webp", WEBP, "image/webp")
        self.assertEqual(url, "https://proj.example.invalid/storage/v1/object/public/product-images/biz/prod/abc.webp")
        called_url = post.call_args.args[0]
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(called_url, "https://proj.example.invalid/storage/v1/object/product-images/biz/prod/abc.webp")
        self.assertEqual(headers["Authorization"], "Bearer service-key")
        self.assertEqual(headers["x-upsert"], "false")
        self.assertNotIn("service-key", url)  # the public URL never carries the credential

    def test_upload_failure_is_a_storage_error(self) -> None:
        with mock.patch.object(httpx, "post", return_value=httpx.Response(500, text="boom")):
            self.assertEqual(code(lambda: self.storage.upload("a/b/c.webp", WEBP, "image/webp")), "STORAGE_UNAVAILABLE")
        with mock.patch.object(httpx, "post", side_effect=httpx.ConnectError("down")):
            self.assertEqual(code(lambda: self.storage.upload("a/b/c.webp", WEBP, "image/webp")), "STORAGE_UNAVAILABLE")

    def test_delete_tolerates_missing_object(self) -> None:
        with mock.patch.object(httpx, "delete", return_value=httpx.Response(404)):
            self.storage.delete("a/b/c.webp")
        with mock.patch.object(httpx, "delete", return_value=httpx.Response(500)):
            self.assertEqual(code(lambda: self.storage.delete("a/b/c.webp")), "STORAGE_UNAVAILABLE")

    def test_path_from_url_only_for_own_bucket(self) -> None:
        own = "https://proj.example.invalid/storage/v1/object/public/product-images/biz/prod/x.webp"
        self.assertEqual(self.storage.path_from_url(own), "biz/prod/x.webp")
        self.assertIsNone(self.storage.path_from_url("https://elsewhere.example/x.webp"))
        self.assertIsNone(self.storage.path_from_url(None))

    def test_unconfigured_storage_is_503(self) -> None:
        from app.core.config import Settings
        bare = Settings(_env_file=None, supabase_url=None, supabase_service_role_key=None)  # type: ignore[call-arg]
        with mock.patch.object(storage_service, "get_settings", return_value=bare):
            self.assertEqual(code(storage_service.get_storage), "STORAGE_NOT_CONFIGURED")


if __name__ == "__main__":
    unittest.main()
