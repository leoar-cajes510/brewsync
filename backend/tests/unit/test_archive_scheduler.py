"""ARC-02: the automatic archive job is opt-in per deployment and does nothing until setup is
complete and Settings → archiving is configured (no default timing, Q-SET-4)."""
import unittest
from types import SimpleNamespace
from unittest import mock

from app.domain.identity import SetupStatus
from app.services import archive_scheduler


class ArchiveSchedulerTests(unittest.TestCase):
    def system(self, status=SetupStatus.COMPLETED.value, business=True):
        return mock.Mock(system_state=mock.Mock(return_value=SimpleNamespace(setup_status=status)),
                         business=mock.Mock(return_value=SimpleNamespace(id="b1") if business else None))

    def tick(self, system, archiving):
        with mock.patch.object(archive_scheduler, "SystemRepository", return_value=system), \
                mock.patch.object(archive_scheduler, "section", return_value=archiving), \
                mock.patch.object(archive_scheduler, "run_auto_archive", return_value=3) as run:
            return archive_scheduler.tick(mock.Mock()), run

    def test_disabled_by_default(self):
        with mock.patch.object(archive_scheduler, "get_settings",
                               return_value=SimpleNamespace(auto_archive_enabled=False)):
            self.assertIsNone(archive_scheduler.start())

    def test_skips_until_setup_completed(self):
        count, run = self.tick(self.system(status=SetupStatus.NOT_STARTED.value), {"auto_archive_after_hours": 24})
        self.assertEqual(count, 0)
        run.assert_not_called()

    def test_skips_without_archiving_settings(self):
        count, run = self.tick(self.system(), None)
        self.assertEqual(count, 0)
        run.assert_not_called()

    def test_runs_when_configured(self):
        count, run = self.tick(self.system(), {"auto_archive_after_hours": 24, "restore_window_hours": 48})
        self.assertEqual(count, 3)
        run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
