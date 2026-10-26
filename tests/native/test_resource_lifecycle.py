"""Opt-in real-driver timeout/recovery; no catalog changes or injected driver."""

import os
from pathlib import Path
import unittest
from unittest.mock import patch

import pyodbc

from dashboard import create_app
from dashboard.db import execute_query


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class ResourceLifecycleSQLTests(unittest.TestCase):
    def test_query_timeout_reports_cleanup_then_a_fresh_query_recovers(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        reports = []
        options = {'connection_string': app.config['CONNECTION_STRING']['main'],
                   'login_timeout': 5, 'query_timeout': 1, 'one_row': True,
                   'on_complete': reports.append}
        with patch('dashboard.db.load_query', return_value=
                   "SET NOCOUNT ON; WAITFOR DELAY '00:00:05'; SELECT CAST(1 AS bit) ready;"):
            with self.assertRaises(pyodbc.Error) as failure:
                execute_query('api-readiness.sql', **options)
        self.assertIn(failure.exception.args[0], ('HYT00', 'HYT01'))
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]['outcome'], 'error')
        self.assertEqual(reports[0]['failure_stage'], 'execute')
        self.assertFalse(reports[0]['cleanup_failed'])
        self.assertIsNone(reports[0]['rows'])
        self.assertEqual(execute_query('api-readiness.sql', **options), {'ready': True})
        self.assertEqual(len(reports), 2)
        self.assertEqual(reports[1]['outcome'], 'ok')
        self.assertFalse(reports[1]['cleanup_failed'])


if __name__ == '__main__':
    unittest.main()
