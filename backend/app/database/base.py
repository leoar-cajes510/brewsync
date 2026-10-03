"""Declarative base and column helpers. Tables are schema-less here; the connection maps
them into the configured schema (``DB_SCHEMA``) via ``schema_translate_map``."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import JSON, DateTime, MetaData, Numeric, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(Uuid, primary_key=True, default=uuid.uuid4)


def money(nullable: bool = False) -> Mapped[Decimal]:
    return mapped_column(Numeric(12, 2), nullable=nullable)


def quantity(nullable: bool = False) -> Mapped[Decimal]:
    return mapped_column(Numeric(12, 3), nullable=nullable)


def ts(nullable: bool = True, default_now: bool = False) -> Mapped[datetime]:
    if default_now:
        return mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    return mapped_column(DateTime(timezone=True), nullable=nullable)


def text(length: int = 120, nullable: bool = False) -> Mapped[str]:
    return mapped_column(String(length), nullable=nullable)
