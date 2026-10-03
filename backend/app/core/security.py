"""Credential hashing and opaque token helpers. Raw secrets are never stored or logged."""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()  # Argon2id, library defaults


def hash_credential(secret: str) -> str:
    """Adaptive hash for passwords, PINs and activation codes."""
    return _hasher.hash(secret)


def verify_credential(secret: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        _hasher.hash(secret)  # keep timing similar when there is no hash
        return False
    try:
        return _hasher.verify(stored_hash, secret)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_token(prefix: str) -> str:
    """High-entropy opaque token (session tokens, device credentials)."""
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def token_digest(token: str) -> str:
    """Lookup digest for high-entropy tokens (SHA-256 is sufficient at 256 bits of entropy)."""
    return hashlib.sha256(token.encode()).hexdigest()


def new_activation_code() -> str:
    """One-time terminal activation code (shown once, stored hashed)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(10))


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
