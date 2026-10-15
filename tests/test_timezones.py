import os
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfoNotFoundError

from dashboard import create_app


PROJECT_ROOT = Path(__file__).resolve().parent.parent


class DisplayTimezoneTests(unittest.TestCase):
    def setUp(self):
        guard = patch('pyodbc.connect', side_effect=AssertionError('Unexpected DB access'))
        self.connect = guard.start()
        self.addCleanup(guard.stop)

    def test_default_and_explicit_timezone_load_without_database_access(self):
        self.assertEqual(create_app({}).config['DISPLAY_TIMEZONE'], 'Europe/London')
        self.assertEqual(create_app({'DISPLAY_TIMEZONE': 'UTC'}).config['DISPLAY_TIMEZONE'], 'UTC')
        self.connect.assert_not_called()

    def test_invalid_timezone_fails_at_startup(self):
        for key in (None, True, 42, '', ' ' * 129, 'NoSuch/Timezone', '../Europe/London'):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'DISPLAY_TIMEZONE'):
                create_app({'DISPLAY_TIMEZONE': key})
        self.connect.assert_not_called()

    def test_missing_timezone_data_fails_at_startup_with_safe_guidance(self):
        with patch('dashboard.timezones.ZoneInfo', side_effect=ZoneInfoNotFoundError('private diagnostic')):
            with self.assertRaises(ValueError) as caught:
                create_app({})
        self.assertIn('pinned runtime requirements', str(caught.exception))
        self.assertNotIn('private diagnostic', str(caught.exception))
        self.connect.assert_not_called()

    def test_packaged_data_handles_london_dst_without_a_system_database(self):
        code = textwrap.dedent('''\
            from datetime import datetime, timezone
            from zoneinfo import ZoneInfo, TZPATH
            from unittest.mock import patch
            from dashboard import create_app

            assert TZPATH == ()
            with patch('pyodbc.connect', side_effect=AssertionError('Unexpected DB access')):
                app = create_app({})
            london = ZoneInfo(app.config['DISPLAY_TIMEZONE'])
            spring_before = datetime(2026, 3, 29, 0, 30, tzinfo=timezone.utc).astimezone(london)
            spring_after = datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc).astimezone(london)
            assert (spring_before.hour, spring_after.hour) == (0, 2)
            assert (spring_before.utcoffset().total_seconds(), spring_after.utcoffset().total_seconds()) == (0, 3600)
            autumn_first = datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc).astimezone(london)
            autumn_second = datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc).astimezone(london)
            assert (autumn_first.hour, autumn_second.hour) == (1, 1)
            assert (autumn_first.fold, autumn_second.fold) == (0, 1)
            assert (autumn_first.utcoffset().total_seconds(), autumn_second.utcoffset().total_seconds()) == (3600, 0)
            print('packaged timezone data OK')
        ''')
        result = subprocess.run(
            [sys.executable, '-B', '-c', code], cwd=PROJECT_ROOT,
            env=dict(os.environ, PYTHONTZPATH=''), capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'packaged timezone data OK')
