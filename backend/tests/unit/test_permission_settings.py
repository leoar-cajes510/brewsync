"""SET-PRM-01: role grants are persisted through PUT /settings/permissions, with the
non-configurable protections of PERMISSIONS §4 enforced in the service."""
import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from app.core.exceptions import AppError
from app.domain.identity import CASHIER_DEFAULT_GRANTS, CONFIGURABLE_KEYS, PermissionKey, RoleKey
from app.services import permission_service

ADMIN_ID, CASHIER_ID = uuid.uuid4(), uuid.uuid4()


class FakeStaff:
    def __init__(self):
        self.roles = {RoleKey.ADMIN: SimpleNamespace(id=ADMIN_ID), RoleKey.CASHIER: SimpleNamespace(id=CASHIER_ID)}
        self.grants = {
            ADMIN_ID: {k.value: True for k in CONFIGURABLE_KEYS},
            CASHIER_ID: {k.value: k in CASHIER_DEFAULT_GRANTS for k in CONFIGURABLE_KEYS},
        }
        self.writes = []

    def role(self, key):
        return self.roles[key]

    def role_grants(self, role_id, lock=False):
        return {k: SimpleNamespace(granted=v) for k, v in self.grants[role_id].items()}

    def set_grant(self, role_id, key, granted, actor_id, at):
        self.grants[role_id][key] = granted
        self.writes.append((role_id, key, granted))


def actor(role=RoleKey.ADMIN, perms=None):
    perms = {k.value for k in CONFIGURABLE_KEYS} if perms is None else perms
    return SimpleNamespace(role=role, permissions=frozenset(perms), user_id=uuid.uuid4(), business_id=uuid.uuid4(),
                           require=lambda *keys: [_require(perms, k) for k in keys])


def _require(perms, key):
    if key.value not in perms:
        raise AppError("PERMISSION_DENIED", 403, f"Missing permission {key.value}")


class PermissionSettingsTests(unittest.TestCase):
    def setUp(self):
        self.staff = FakeStaff()
        self.audit = mock.Mock()
        for target, value in (("StaffRepository", mock.Mock(return_value=self.staff)), ("SystemRepository", mock.Mock()),
                              ("audit", self.audit)):
            p = mock.patch.object(permission_service, target, value)
            p.start()
            self.addCleanup(p.stop)

    def put(self, roles, who=None):
        return permission_service.put_permissions(mock.Mock(), who or actor(), {"roles": roles})

    def assert_error(self, status, code, roles, who=None):
        with self.assertRaises(AppError) as ctx:
            self.put(roles, who)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (status, code))
        self.assertEqual(self.staff.writes, [])

    def test_get_returns_48_configurable_keys_per_role(self):
        result = permission_service.get_permissions(mock.Mock(), actor())
        self.assertEqual(set(result["roles"]), {"admin", "cashier"})
        self.assertEqual(len(result["roles"]["cashier"]), 48)
        self.assertTrue(result["roles"]["cashier"]["pos.processPayments"])

    def test_revoking_a_cashier_grant_is_persisted_and_audited(self):
        result = self.put({"cashier": {"pos.processPayments": False}})
        self.assertEqual(self.staff.writes, [(CASHIER_ID, "pos.processPayments", False)])
        self.assertFalse(result["roles"]["cashier"]["pos.processPayments"])
        self.audit.assert_called_once()

    def test_unchanged_values_write_nothing(self):
        self.put({"cashier": {"pos.processPayments": True}, "admin": {"settings.view": True}})
        self.assertEqual(self.staff.writes, [])
        self.audit.assert_not_called()

    def test_admin_cannot_change_own_role(self):
        self.assert_error(403, "PERMISSION_DENIED", {"admin": {"expenses.view": False}})

    def test_admin_keeps_lockout_guard(self):
        who = actor(role=RoleKey.CASHIER)  # a non-admin manager editing Admin
        self.assert_error(422, "VALIDATION_ERROR", {"admin": {"staff.managePermissions": False}}, who)

    def test_gap_and_unknown_keys_are_rejected(self):
        self.assert_error(422, "VALIDATION_ERROR", {"cashier": {PermissionKey.AUDIT_VIEW.value: True}})
        self.assert_error(422, "VALIDATION_ERROR", {"cashier": {"made.up": True}})
        self.assert_error(422, "VALIDATION_ERROR", {"owner": {"pos.view": True}})

    def test_caller_without_manage_permissions_is_denied_not_unauthenticated(self):
        cashier = actor(role=RoleKey.CASHIER, perms={k.value for k in CASHIER_DEFAULT_GRANTS})
        self.assert_error(403, "PERMISSION_DENIED", {"cashier": {"pos.view": False}}, cashier)
        with self.assertRaises(AppError) as ctx:
            permission_service.get_permissions(mock.Mock(), cashier)
        self.assertEqual(ctx.exception.status, 403)


if __name__ == "__main__":
    unittest.main()
