"""AUTH-05 (Q-TRM-8 option c + Q-AUTH-8 setup token): secure first-terminal bootstrap rules."""
import unittest
from types import SimpleNamespace
from unittest import mock

from app.core.exceptions import AppError
from app.domain.identity import SetupStatus
from app.services import setup_service

TOKEN = "a-long-installer-setup-token"


def settings(token):
    return SimpleNamespace(setup_token=token, first_terminal_code_minutes=15)


class SetupTokenTests(unittest.TestCase):
    def check(self, configured, presented):
        with mock.patch.object(setup_service, "get_settings", return_value=settings(configured)):
            setup_service.require_setup_token(presented)

    def assert_refused(self, configured, presented, status, code):
        with self.assertRaises(AppError) as ctx:
            self.check(configured, presented)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (status, code))

    def test_not_configured_locks_setup(self):
        self.assert_refused(None, TOKEN, 503, "SETUP_TOKEN_NOT_CONFIGURED")

    def test_short_token_counts_as_not_configured(self):
        self.assert_refused("short", "short", 503, "SETUP_TOKEN_NOT_CONFIGURED")

    def test_missing_or_wrong_token_refused(self):
        self.assert_refused(TOKEN, None, 403, "SETUP_TOKEN_INVALID")
        self.assert_refused(TOKEN, TOKEN + "x", 403, "SETUP_TOKEN_INVALID")

    def test_correct_token_accepted(self):
        self.check(TOKEN, TOKEN)


class ReissueFirstTerminalTests(unittest.TestCase):
    def run_reissue(self, *, status, active):
        system = mock.Mock(system_state=mock.Mock(return_value=SimpleNamespace(setup_status=status)),
                           business=mock.Mock(return_value=SimpleNamespace(id="b1")))
        staff = mock.Mock(count_active_terminals=mock.Mock(return_value=active))
        with mock.patch.object(setup_service, "SystemRepository", return_value=system), \
                mock.patch("app.repositories.staff_repository.StaffRepository", return_value=staff), \
                mock.patch.object(setup_service, "_first_terminal", return_value={"code": "REG-01"}) as first:
            return setup_service.reissue_first_terminal(mock.Mock(), {}), first

    def test_refused_before_setup(self):
        with self.assertRaises(AppError) as ctx:
            self.run_reissue(status=SetupStatus.NOT_STARTED.value, active=0)
        self.assertEqual(ctx.exception.code, "SETUP_REQUIRED")

    def test_refused_once_any_terminal_is_active(self):
        with self.assertRaises(AppError) as ctx:
            self.run_reissue(status=SetupStatus.COMPLETED.value, active=1)
        self.assertEqual((ctx.exception.status, ctx.exception.code), (409, "INVALID_TRANSITION"))

    def test_issues_code_while_no_terminal_is_active(self):
        result, first = self.run_reissue(status=SetupStatus.COMPLETED.value, active=0)
        self.assertEqual(result["code"], "REG-01")
        first.assert_called_once()


if __name__ == "__main__":
    unittest.main()
