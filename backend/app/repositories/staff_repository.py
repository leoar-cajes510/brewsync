"""Identity persistence: roles, permissions, users, terminals, sessions."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.identity import AuthMethod, RoleKey, Session as DomainSession, SessionEndReason, Terminal, \
    TerminalStatus, User, UserStatus
from app.models import BusinessRow, PermissionRow, RolePermissionRow, RoleRow, SessionRow, SettingsDocumentRow, \
    TerminalRow, UserRow


class StaffRepository:
    def __init__(self, session: Session) -> None:
        self.s = session

    # --- roles & permissions ---------------------------------------------------------------------
    def role(self, key: RoleKey) -> RoleRow | None:
        return self.s.scalars(select(RoleRow).where(RoleRow.key == key.value)).first()

    def role_by_id(self, role_id: uuid.UUID) -> RoleRow:
        return self.s.get_one(RoleRow, role_id)

    def granted_keys(self, role_id: uuid.UUID) -> set[str]:
        rows = self.s.scalars(select(RolePermissionRow.permission_key).where(
            RolePermissionRow.role_id == role_id, RolePermissionRow.granted.is_(True)))
        return set(rows)

    def role_grants(self, role_id: uuid.UUID, *, lock: bool = False) -> dict[str, RolePermissionRow]:
        stmt = select(RolePermissionRow).where(RolePermissionRow.role_id == role_id)
        return {r.permission_key: r for r in self.s.scalars(stmt.with_for_update() if lock else stmt)}

    def set_grant(self, role_id: uuid.UUID, key: str, granted: bool, actor_id: uuid.UUID, at) -> None:  # type: ignore[no-untyped-def]
        row = self.s.get(RolePermissionRow, (role_id, key))
        if row is None:
            self.s.add(RolePermissionRow(role_id=role_id, permission_key=key, granted=granted, updated_by=actor_id,
                                         updated_at=at))
        else:
            row.granted, row.updated_by, row.updated_at = granted, actor_id, at
        self.s.flush()

    def permission_count(self) -> int:
        return int(self.s.scalar(select(func.count()).select_from(PermissionRow)) or 0)

    # --- users ----------------------------------------------------------------------------------------
    def user(self, user_id: uuid.UUID, *, lock: bool = False) -> UserRow | None:
        stmt = select(UserRow).where(UserRow.id == user_id)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def user_by_username(self, business_id: uuid.UUID, username: str, *, lock: bool = False) -> UserRow | None:
        stmt = select(UserRow).where(UserRow.business_id == business_id, UserRow.username == username)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def users(self, business_id: uuid.UUID) -> list[UserRow]:
        return list(self.s.scalars(select(UserRow).where(UserRow.business_id == business_id).order_by(UserRow.code)))

    def count_users(self, business_id: uuid.UUID, role_id: uuid.UUID | None = None, active_only: bool = True) -> int:
        stmt = select(func.count()).select_from(UserRow).where(UserRow.business_id == business_id)
        if role_id is not None:
            stmt = stmt.where(UserRow.role_id == role_id)
        if active_only:
            stmt = stmt.where(UserRow.status == "active")
        return int(self.s.scalar(stmt) or 0)

    def to_domain_user(self, row: UserRow) -> User:
        role = self.role_by_id(row.role_id)
        return User(id=str(row.id), code=row.code, username=row.username, full_name=row.full_name,
                    role=RoleKey(role.key), auth_method=AuthMethod(row.auth_method), status=UserStatus(row.status),
                    default_terminal_id=str(row.default_terminal_id) if row.default_terminal_id else None,
                    must_change_credential=row.must_change_credential, failed_attempts=row.failed_attempts,
                    locked_until=row.locked_until)

    def apply_user(self, row: UserRow, user: User) -> None:
        role = self.role(user.role)
        assert role is not None
        row.role_id, row.auth_method, row.status = role.id, user.auth_method.value, user.status.value
        row.must_change_credential, row.failed_attempts = user.must_change_credential, user.failed_attempts
        row.locked_until = user.locked_until
        self.s.flush()

    # --- terminals ---------------------------------------------------------------------------------------
    def terminal(self, terminal_id: uuid.UUID, *, lock: bool = False) -> TerminalRow | None:
        stmt = select(TerminalRow).where(TerminalRow.id == terminal_id)
        if lock:
            stmt = stmt.with_for_update().execution_options(populate_existing=True)
        return self.s.scalars(stmt).first()

    def terminal_by_code(self, business_id: uuid.UUID, code: str, *, lock: bool = False) -> TerminalRow | None:
        stmt = select(TerminalRow).where(TerminalRow.business_id == business_id, TerminalRow.code == code)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def terminal_by_credential(self, digest: str) -> TerminalRow | None:
        return self.s.scalars(select(TerminalRow).where(TerminalRow.device_credential_hash == digest)).first()

    def terminals(self, business_id: uuid.UUID) -> list[TerminalRow]:
        return list(self.s.scalars(select(TerminalRow).where(TerminalRow.business_id == business_id)
                                   .order_by(TerminalRow.code)))

    def count_active_terminals(self, business_id: uuid.UUID) -> int:
        return int(self.s.scalar(select(func.count()).select_from(TerminalRow).where(
            TerminalRow.business_id == business_id, TerminalRow.status == "active")) or 0)

    @staticmethod
    def to_domain_terminal(row: TerminalRow) -> Terminal:
        return Terminal(id=str(row.id), code=row.code, name=row.name, status=TerminalStatus(row.status),
                        activated_at=row.activated_at, activated_by=str(row.activated_by) if row.activated_by else None,
                        last_seen_at=row.last_seen_at)

    @staticmethod
    def apply_terminal(row: TerminalRow, terminal: Terminal) -> None:
        row.status, row.activated_at = terminal.status.value, terminal.activated_at
        row.activated_by = uuid.UUID(terminal.activated_by) if terminal.activated_by else None

    # --- sessions ------------------------------------------------------------------------------------------
    def session_by_token(self, digest: str, *, lock: bool = False) -> SessionRow | None:
        stmt = select(SessionRow).where(SessionRow.token_hash == digest)
        return self.s.scalars(stmt.with_for_update() if lock else stmt).first()

    def auth_context(self, digest: str) -> tuple | None:
        """One round trip for a bearer request: the session (row-locked, as session_by_token(lock=True)),
        its user, role, business, terminal, the live security settings and the role's granted keys.
        Returns (session, user, role, business, terminal | None, security data | None, keys) or None."""
        granted = (select(func.array_agg(RolePermissionRow.permission_key))
                   .where(RolePermissionRow.role_id == RoleRow.id, RolePermissionRow.granted.is_(True))
                   .scalar_subquery())
        stmt = (select(SessionRow, UserRow, RoleRow, BusinessRow, TerminalRow, SettingsDocumentRow.data, granted)
                .join(UserRow, UserRow.id == SessionRow.user_id)
                .join(RoleRow, RoleRow.id == UserRow.role_id)
                .join(BusinessRow, BusinessRow.id == UserRow.business_id)
                .outerjoin(TerminalRow, TerminalRow.id == SessionRow.terminal_id)
                .outerjoin(SettingsDocumentRow, (SettingsDocumentRow.business_id == BusinessRow.id)
                           & (SettingsDocumentRow.section == "security"))
                .where(SessionRow.token_hash == digest)
                .with_for_update(of=SessionRow))
        row = self.s.execute(stmt).first()
        if row is None:
            return None
        return (*row[:6], frozenset(row[6] or ()))

    def active_sessions_for_user(self, user_id: uuid.UUID) -> list[SessionRow]:
        return list(self.s.scalars(select(SessionRow).where(SessionRow.user_id == user_id,
                                                            SessionRow.ended_at.is_(None)).with_for_update()))

    def active_sessions_for_terminal(self, terminal_id: uuid.UUID) -> list[SessionRow]:
        return list(self.s.scalars(select(SessionRow).where(SessionRow.terminal_id == terminal_id,
                                                            SessionRow.ended_at.is_(None))
                                   .order_by(SessionRow.id).with_for_update()))

    @staticmethod
    def to_domain_session(row: SessionRow) -> DomainSession:
        return DomainSession(id=str(row.id), user_id=str(row.user_id),
                             terminal_id=str(row.terminal_id) if row.terminal_id else "",
                             started_at=row.started_at, last_activity_at=row.last_activity_at,
                             ended_at=row.ended_at,
                             end_reason=SessionEndReason(row.end_reason) if row.end_reason else None)

    @staticmethod
    def apply_session(row: SessionRow, session: DomainSession) -> None:
        row.last_activity_at, row.ended_at = session.last_activity_at, session.ended_at
        row.end_reason = session.end_reason.value if session.end_reason else None
