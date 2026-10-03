"""Identity & access tables (DATABASE.md §Identity & access)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, text, ts, uuid_pk


class BusinessRow(Base):
    __tablename__ = "businesses"
    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = text(120)
    business_type: Mapped[str] = text(60)
    address: Mapped[str] = text(255)
    phone: Mapped[str] = text(40)
    email: Mapped[str] = text(120)
    currency_code: Mapped[str] = text(3)
    timezone: Mapped[str] = text(64)
    created_at: Mapped[datetime] = ts(default_now=True)


class SystemStateRow(Base):
    __tablename__ = "system_state"
    __table_args__ = (
        CheckConstraint("id = 1", name="singleton"),
        CheckConstraint("setup_status in ('not_started','in_progress','completed')", name="setup_status"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    setup_status: Mapped[str] = text(20)
    completed_at: Mapped[datetime | None] = ts()
    completed_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)


class RoleRow(Base):
    __tablename__ = "roles"
    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = text(40)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True)


class PermissionRow(Base):
    __tablename__ = "permissions"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    group: Mapped[str] = text(40)
    label: Mapped[str] = text(80)
    protected: Mapped[bool] = mapped_column(Boolean)


class RolePermissionRow(Base):
    __tablename__ = "role_permissions"
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), primary_key=True)
    permission_key: Mapped[str] = mapped_column(ForeignKey("permissions.key", ondelete="RESTRICT"), primary_key=True)
    granted: Mapped[bool] = mapped_column(Boolean)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_at: Mapped[datetime] = ts(default_now=True)


class UserRow(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("business_id", "username"),
        UniqueConstraint("business_id", "code"),
        CheckConstraint("auth_method in ('password','pin')", name="auth_method"),
        CheckConstraint("status in ('active','inactive')", name="status"),
        CheckConstraint("failed_attempts >= 0", name="failed_attempts"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"))
    code: Mapped[str] = text(20)
    username: Mapped[str] = text(20)
    full_name: Mapped[str] = text(120)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"))
    auth_method: Mapped[str] = text(10)
    password_hash: Mapped[str | None] = text(255, nullable=True)
    pin_hash: Mapped[str | None] = text(255, nullable=True)
    status: Mapped[str] = text(10)
    default_terminal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("terminals.id"), nullable=True)
    must_change_credential: Mapped[bool] = mapped_column(Boolean, default=False)
    credential_set_at: Mapped[datetime | None] = ts()
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = ts()
    last_active_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = ts(default_now=True)


class TerminalRow(Base):
    __tablename__ = "terminals"
    __table_args__ = (
        UniqueConstraint("business_id", "code"),
        CheckConstraint("status in ('pending_activation','active','inactive','revoked')", name="status"),
    )
    id: Mapped[uuid.UUID] = uuid_pk()
    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id", ondelete="RESTRICT"))
    code: Mapped[str] = text(20)
    name: Mapped[str] = text(80)
    status: Mapped[str] = text(20)
    activation_code_hash: Mapped[str | None] = text(255, nullable=True)
    activation_expires_at: Mapped[datetime | None] = ts()
    device_credential_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    activated_at: Mapped[datetime | None] = ts()
    activated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    last_seen_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = ts(default_now=True)


class SessionRow(Base):
    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_ended", "user_id", "ended_at"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    terminal_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("terminals.id", ondelete="RESTRICT"), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    started_at: Mapped[datetime] = ts(nullable=False)
    last_activity_at: Mapped[datetime] = ts(nullable=False)
    ended_at: Mapped[datetime | None] = ts()
    end_reason: Mapped[str | None] = text(20, nullable=True)
