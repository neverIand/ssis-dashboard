"""Execute checked-in legacy page SQL against connection-local sources.

Catalog views are replaced by temporary tables with the same column names; no
catalog objects, data or permissions change.
"""
import os
from pathlib import Path
import unittest

import pyodbc

from dashboard import create_app
from dashboard.db import load_query


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
SOURCES = (('[catalog].executions', '#legacy_executions'), ('catalog.executions', '#legacy_executions'),
           ('[catalog].event_messages', '#legacy_events'),
           ('[catalog].[execution_parameter_values]', '#legacy_parameters'))
FIXTURE = """
SET NOCOUNT ON;
CREATE TABLE #legacy_executions (
    execution_id bigint PRIMARY KEY, folder_name nvarchar(128) COLLATE DATABASE_DEFAULT,
    project_name nvarchar(128) COLLATE DATABASE_DEFAULT, package_name nvarchar(260) COLLATE DATABASE_DEFAULT,
    project_lsn bigint, environment_folder_name nvarchar(128) COLLATE DATABASE_DEFAULT,
    environment_name nvarchar(128) COLLATE DATABASE_DEFAULT, status int,
    created_time datetimeoffset(7), start_time datetimeoffset(7), end_time datetimeoffset(7));
CREATE TABLE #legacy_events (operation_id bigint, event_name nvarchar(1024) COLLATE DATABASE_DEFAULT);
CREATE TABLE #legacy_parameters (execution_id bigint, object_type smallint,
    parameter_name nvarchar(128) COLLATE DATABASE_DEFAULT, parameter_value sql_variant);
INSERT #legacy_executions VALUES
 (1, N'F', N'P', N'Text.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', '2026-10-01T09:01:00Z'),
 (2, N'F', N'P', N'Integer.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', '2026-10-01T09:01:00Z'),
 (3, N'F', N'P', N'Missing.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', '2026-10-01T09:01:00Z'),
 (4, N'F', N'P', N'Custom.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', '2026-10-01T09:01:00Z'),
 (10, N'F', N'P', N'Quick.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z',
  '2026-10-01T09:00:00.1000000Z', '2026-10-01T09:00:00.4000000Z'),
 (11, N'F', N'P', N'Quick.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:05:00Z',
  '2026-10-01T09:05:00.1000000Z', '2026-10-01T09:05:00.6000000Z'),
 (12, N'F', N'P', N'Quick.dtsx', 1, NULL, NULL, 2, '2026-10-01T09:10:00Z', '2026-10-01T09:10:00Z', NULL),
 (20, N'F', N'P', N'Slow.dtsx', 1, NULL, NULL, 7, '2026-10-01T09:00:00Z', '2026-10-01T09:00:00Z', '2026-10-01T09:02:00Z'),
 (21, N'F', N'P', N'Slow.dtsx', 1, NULL, NULL, 2, '2026-10-01T09:10:00Z', '2026-10-01T09:10:00Z', NULL);
INSERT #legacy_parameters VALUES
 (1, 50, N'LOGGING_LEVEL', CONVERT(sql_variant, 1)),
 (1, 30, N'LOGGING_LEVEL', CONVERT(sql_variant, N'not an integer')),
 (2, 50, N'LOGGING_LEVEL', CONVERT(sql_variant, 3)),
 (2, 20, N'LOGGING_LEVEL', CONVERT(sql_variant, 2)),
 (4, 50, N'LOGGING_LEVEL', CONVERT(sql_variant, 100)),
 (4, 30, N'DUMP_LEVEL', CONVERT(sql_variant, N'text'));
"""


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class LegacySQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.cursor.execute(FIXTURE)
        while self.cursor.nextset():
            pass

    def rows(self, resource, parameters):
        sql = load_query(resource)
        for source, target in SOURCES:
            sql = sql.replace(source, target)
        self.assertNotIn('catalog]', sql)
        self.assertNotIn('catalog.', sql)
        self.cursor.execute(sql, parameters)
        names = [c[0] for c in self.cursor.description]
        return [dict(zip(names, row)) for row in self.cursor.fetchall()]

    def test_overview_reads_only_the_system_logging_level_once_per_execution(self):
        rows = self.rows('package-list.sql', (48, '2026-10-02 00:00:00', 'F', 'P', 7, 1000))
        levels = {row['execution_id']: row['logging_level'] for row in rows}
        self.assertEqual(len(rows), len(levels))
        self.assertEqual({key: levels[key] for key in (1, 2, 3, 4)}, {1: 1, 2: 3, 3: None, 4: 100})

    def test_history_estimates_skip_zero_mean_and_completed_rows(self):
        quick = self.rows('package-history.sql', ('F', 'P', 'Quick.dtsx'))
        self.assertEqual([row['execution_id'] for row in quick], [12, 11, 10])
        self.assertEqual([row['percent_complete'] for row in quick], [None, None, None])
        self.assertEqual([row['has_expected_values'] for row in quick], [1, 0, 0])
        slow = self.rows('package-history.sql', ('F', 'P', 'Slow.dtsx'))
        self.assertEqual([row['execution_id'] for row in slow], [21, 20])
        self.assertIsNotNone(slow[0]['percent_complete'])
        self.assertIsNone(slow[1]['percent_complete'])
