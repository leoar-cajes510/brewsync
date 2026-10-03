import unittest
from datetime import timedelta

from domain_support import T0
from app.domain.errors import (
    AccountInactive, AccountLocked, AuthMethodNotAllowed, InvalidStateTransition, PermissionProtectionError,
    SessionExpired, SetupStateError, TerminalNotActive, ValidationError,
)
from app.domain.identity import (
    CASHIER_DEFAULT_GRANTS, CONFIGURABLE_KEYS, GAP_KEYS, AuthMethod, CredentialPolicy, PermissionKey, RoleGrants,
    RoleKey, Session, SessionEndReason, SetupStatus, SystemState, Terminal, TerminalStatus, User,
    ensure_admin_remains,
)
from app.domain.settings import SecuritySettings


def user(uid="u-1", role=RoleKey.CASHIER, method=AuthMethod.PIN):
    return User(id=uid, code="STF-01", username="maria.c", full_name="Maria C", role=role, auth_method=method)


class PermissionCatalogueTests(unittest.TestCase):
    def test_catalogue_sizes_match_permissions_doc(self):
        self.assertEqual((len(CONFIGURABLE_KEYS), len(GAP_KEYS), len(CASHIER_DEFAULT_GRANTS)), (48, 10, 14))
        self.assertEqual(len(RoleGrants.defaults(RoleKey.ADMIN).granted), 58)

    def test_protections(self):
        cashier = RoleGrants.defaults(RoleKey.CASHIER)
        with self.assertRaises(PermissionProtectionError):
            cashier.grant(PermissionKey.ARCHIVE_MANAGE, confirmed=True)  # gap key
        with self.assertRaises(PermissionProtectionError):
            cashier.grant(PermissionKey.POS_PROCESS_REFUNDS)  # protected, unconfirmed
        cashier.grant(PermissionKey.POS_PROCESS_REFUNDS, confirmed=True)
        self.assertTrue(cashier.has(PermissionKey.POS_PROCESS_REFUNDS))
        admin = RoleGrants.defaults(RoleKey.ADMIN)
        with self.assertRaises(PermissionProtectionError):
            admin.revoke(PermissionKey.STAFF_MANAGE_PERMISSIONS)


class UserTests(unittest.TestCase):
    def test_admin_must_use_password_cashier_may_use_pin(self):
        with self.assertRaises(AuthMethodNotAllowed):
            user(role=RoleKey.ADMIN, method=AuthMethod.PIN)
        cashier = user()
        with self.assertRaises(PermissionProtectionError):
            cashier.change_auth_method(AuthMethod.PASSWORD, changed_by=cashier.id)
        cashier.change_auth_method(AuthMethod.PASSWORD, changed_by="u-admin")
        self.assertTrue(cashier.must_change_credential)
        with self.assertRaises(AuthMethodNotAllowed):
            user(role=RoleKey.CASHIER, method=AuthMethod.PIN).change_role(RoleKey.ADMIN, changed_by="u-admin")
        with self.assertRaises(ValidationError):
            User(id="x", code="c", username="No Spaces", full_name="X", role=RoleKey.CASHIER,
                 auth_method=AuthMethod.PIN)

    def test_lockout_uses_configured_policy(self):
        policy = CredentialPolicy(max_failed_attempts=3, lockout_duration=timedelta(minutes=15))
        u = user()
        self.assertFalse(u.record_failed_sign_in(T0, policy))
        self.assertFalse(u.record_failed_sign_in(T0, policy))
        self.assertTrue(u.record_failed_sign_in(T0, policy))
        with self.assertRaises(AccountLocked):
            u.ensure_can_sign_in(T0 + timedelta(minutes=5), AuthMethod.PIN)
        u.ensure_can_sign_in(T0 + timedelta(minutes=16), AuthMethod.PIN)
        with self.assertRaises(AuthMethodNotAllowed):
            u.ensure_can_sign_in(T0 + timedelta(minutes=16), AuthMethod.PASSWORD)
        u.deactivate()
        with self.assertRaises(AccountInactive):
            u.ensure_can_sign_in(T0 + timedelta(minutes=16), AuthMethod.PIN)

    def test_last_active_admin_protected(self):
        admin = user("u-a", RoleKey.ADMIN, AuthMethod.PASSWORD)
        admin.deactivate()
        with self.assertRaises(PermissionProtectionError):
            ensure_admin_remains([admin, user()], after_change=admin)


class SessionTerminalSetupTests(unittest.TestCase):
    def test_idle_timeout_enforced_on_user_activity_only(self):
        s = Session("s-1", "u-1", "t-1", started_at=T0)
        s.touch(T0 + timedelta(minutes=4), 5, user_initiated=True)
        s.touch(T0 + timedelta(minutes=8), 5, user_initiated=False)  # heartbeat does not extend
        with self.assertRaises(SessionExpired):
            s.touch(T0 + timedelta(minutes=9, seconds=1), 5, user_initiated=True)
        self.assertEqual(s.end_reason, SessionEndReason.IDLE_TIMEOUT)
        with self.assertRaises(ValidationError):
            SecuritySettings(idle_timeout_minutes=7)
        self.assertEqual(SecuritySettings(idle_timeout_minutes=15).idle_timeout_minutes, 15)

    def test_terminal_registration_and_activation(self):
        t = Terminal("t-1", "REG-01", "Front Counter")
        with self.assertRaises(TerminalNotActive):
            t.require_active()
        t.activate(at=T0, by="u-admin")
        t.require_active()
        with self.assertRaises(InvalidStateTransition):
            t.activate(at=T0, by="u-admin")  # cannot be claimed twice
        t.reset_activation()
        self.assertEqual(t.status, TerminalStatus.PENDING_ACTIVATION)

    def test_first_run_setup_state(self):
        state = SystemState()
        with self.assertRaises(SetupStateError):
            state.require_setup_completed()
        with self.assertRaises(SetupStateError):
            state.complete(at=T0, admin_user_id="u-admin")
        state.begin()
        state.complete(at=T0, admin_user_id="u-admin")
        self.assertEqual(state.setup_status, SetupStatus.COMPLETED)
        with self.assertRaises(SetupStateError):
            state.begin()


if __name__ == "__main__":
    unittest.main()
