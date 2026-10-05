"""Product image validation (declared type, magic bytes, full decode, size) and the Supabase Storage
client. No network: httpx calls are mocked."""

from __future__ import annotations

import io
import struct
import unittest
import zlib
from unittest import mock

import httpx
from PIL import Image

from app.core.exceptions import AppError
from app.services import storage_service
from app.services.product_image_service import MAX_IMAGE_BYTES, detect_image_type, validate_image
from app.services.storage_service import SupabaseStorage


def encode(fmt: str, size: tuple[int, int] = (8, 6), mode: str = "RGB", **params) -> bytes:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    Image.new(mode, size, (200, 120, 40, 128) if mode == "RGBA" else (200, 120, 40)).save(buf, fmt, **params)
    return buf.getvalue()


def png_chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


PNG = encode("PNG")
JPEG = encode("JPEG")
WEBP = encode("WEBP", quality=92)
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

    def test_correct_signature_but_undecodable_content_rejected(self) -> None:
        # Passes the magic-byte/structure check, but the pixel data is garbage: only decoding catches it.
        ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
        fake_png = b"\x89PNG\r\n\x1a\n" + ihdr + png_chunk(b"IDAT", b"not zlib data") + png_chunk(b"IEND", b"")
        self.assertEqual(detect_image_type(fake_png), "image/png")
        self.assertEqual(code(lambda: validate_image(fake_png, "image/png")), "VALIDATION_ERROR")
        fake_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 32 + b"\xff\xd9"
        self.assertEqual(detect_image_type(fake_jpeg), "image/jpeg")
        self.assertEqual(code(lambda: validate_image(fake_jpeg, "image/jpeg")), "VALIDATION_ERROR")
        webp = encode("WEBP", (64, 64), quality=92)
        cut = webp[:-20]
        cut = cut[:4] + (len(cut) - 8).to_bytes(4, "little") + cut[8:]  # consistent RIFF size, truncated bitstream
        self.assertEqual(detect_image_type(cut), "image/webp")
        self.assertEqual(code(lambda: validate_image(cut, "image/webp")), "VALIDATION_ERROR")

    def test_decompression_bomb_rejected_before_decoding(self) -> None:
        ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 50_000, 50_000, 8, 2, 0, 0, 0))
        bomb = b"\x89PNG\r\n\x1a\n" + ihdr + png_chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + png_chunk(b"IEND", b"")
        self.assertEqual(detect_image_type(bomb), "image/png")
        self.assertEqual(code(lambda: validate_image(bomb, "image/png")), "VALIDATION_ERROR")

    def test_transparent_webp_and_1600px_image_accepted(self) -> None:
        alpha = encode("WEBP", (40, 30), "RGBA", quality=92)
        self.assertEqual(validate_image(alpha, "image/webp"), "image/webp")
        with Image.open(io.BytesIO(alpha)) as img:
            self.assertEqual(img.mode, "RGBA")
        self.assertEqual(validate_image(encode("WEBP", (1600, 1200), quality=92), "image/webp"), "image/webp")

    def test_oversized_file_rejected(self) -> None:
        self.assertEqual(MAX_IMAGE_BYTES, 3 * 1024 * 1024)
        big = PNG[:-12] + b"\x00" * MAX_IMAGE_BYTES + PNG[-12:]
        self.assertEqual(code(lambda: validate_image(big, "image/png")), "PAYLOAD_TOO_LARGE")
        under = PNG[:-12] + b"\x00" * (MAX_IMAGE_BYTES - len(PNG)) + PNG[-12:]
        self.assertNotEqual(code(lambda: validate_image(under, "image/png")), "PAYLOAD_TOO_LARGE")


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
