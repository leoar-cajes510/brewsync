"""SET-ACC-02: a wrong *current* credential while changing one's own credential must not be
reported as 401 UNAUTHENTICATED — that code ends the client session."""
import unittest
from types import SimpleNamespace
from unittest import mock

from app.core.exceptions import AppError
from app.core.security import hash_credential, verify_credential
from app.domain.identity import AuthMethod
from app.services import auth_service


class ChangeCredentialTests(unittest.TestCase):
    def setUp(self):
        self.row = SimpleNamespace(id="u1", password_hash=hash_credential("old-password-1"), pin_hash=None,
                                   must_change_credential=True, credential_set_at=None)
        staff = mock.Mock()
        staff.user.return_value = self.row
        staff.to_domain_user.return_value = SimpleNamespace(auth_method=AuthMethod.PASSWORD)
        self.actor = SimpleNamespace(user_id="u1", business_id="b1")
        patches = [
            mock.patch.object(auth_service, "StaffRepository", return_value=staff),
            mock.patch.object(auth_service, "SystemRepository"),
            mock.patch.object(auth_service, "section", return_value={}),
            mock.patch.object(auth_service, "security_settings", return_value=(None, None, {})),
            mock.patch.object(auth_service, "validate_credential"),
            mock.patch.object(auth_service, "audit"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def change(self, current, new="new-password-2"):
        auth_service.change_credential(mock.Mock(), self.actor, current, new, AuthMethod.PASSWORD)

    def test_wrong_current_credential_is_not_a_session_error(self):
        with self.assertRaises(AppError) as ctx:
            self.change("wrong-password")
        self.assertEqual((ctx.exception.status, ctx.exception.code), (422, "VALIDATION_ERROR"))
        self.assertNotEqual(ctx.exception.status, 401)
        self.assertTrue(verify_credential("old-password-1", self.row.password_hash))
        self.assertTrue(self.row.must_change_credential)

    def test_correct_current_credential_changes_it(self):
        self.change("old-password-1")
        self.assertTrue(verify_credential("new-password-2", self.row.password_hash))
        self.assertFalse(verify_credential("old-password-1", self.row.password_hash))
        self.assertFalse(self.row.must_change_credential)


if __name__ == "__main__":
    unittest.main()
