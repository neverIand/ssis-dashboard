"""Execute checked-in legacy page SQL against connection-local sources.

Catalog views are replaced by temporary tables with the same column names; no
catalog objects, data or permissions change.
"""
from datetime import date
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
INSERT #legacy_events VALUES (1, N'OnError'), (1, N'OnError'), (1, N'OnWarning'), (2, N'OnWarning'),
 (2, N'OnWarning'), (2, N'OnWarning'), (4, N'OnInformation'), (10, N'OnError'), (99, N'OnError');
-- Statistics: local created dates near midnight at extreme offsets (UTC-14..UTC+14).
INSERT #legacy_executions VALUES
 (30, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 7, '2026-09-30T23:30:00-10:00', '2026-10-01T09:30:00Z', NULL),
 (31, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 7, '2026-10-01T00:30:00+14:00', '2026-09-30T10:30:00Z', NULL),
 (32, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 4, '2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z', NULL),
 (33, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 7, '2026-10-02T08:00:00+05:45', '2026-10-02T02:15:00Z', NULL),
 (34, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 2, '2026-10-02T23:59:59.9999999-14:00', '2026-10-03T14:00:00Z', NULL),
 (35, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 4, '2026-10-03T23:30:00-14:00', '2026-10-04T13:30:00Z', NULL),
 (36, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 7, '2026-10-04T00:00:00+14:00', '2026-10-03T10:00:00Z', NULL),
 (37, N'S', N'P', N'A.dtsx', 1, NULL, NULL, 1, '2026-10-02T10:00:00Z', NULL, NULL),
 (38, N'X', N'P', N'A.dtsx', 1, NULL, NULL, 7, '2026-10-02T10:00:00Z', '2026-10-02T10:00:00Z', NULL);
"""
# Per local created date: created, executed (started), succeeded (7), failed (4).
STATISTICS = {date(2026, 10, 1): (2, 2, 1, 1), date(2026, 10, 2): (3, 2, 1, 0), date(2026, 10, 3): (1, 1, 0, 1)}


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
        # Query-local tables live until the connection closes; the app opens one per query.
        self.cursor.execute('DROP TABLE IF EXISTS #listed, #listed_events, #listed_levels, #created_dates;')
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

    def test_overview_counts_events_of_the_listed_page_with_null_for_none(self):
        rows = self.rows('package-list.sql', (48, '2026-10-02 00:00:00', 'F', 'P', 7, 1000))
        counts = {row['execution_id']: (row['errors'], row['warnings']) for row in rows}
        self.assertEqual(sorted(counts), [1, 2, 3, 4, 10, 11, 20])
        self.assertEqual({key: counts[key] for key in (1, 2, 3, 4, 10)},
                         {1: (2, 1), 2: (None, 3), 3: (None, None), 4: (None, None), 10: (1, None)})
        top = self.rows('package-list.sql', (48, '2026-10-02 00:00:00', 'F', 'P', 0, 2))
        self.assertEqual([row['execution_id'] for row in top], [21, 20])

    def test_statistics_count_whole_local_dates_at_every_offset(self):
        rows = self.rows('executions-statistics.sql', (48, '2026-10-03 06:00:00', 'S', '%', 0))
        actual = {row['calendar_date']: (row['created_packages'], row['executed_packages'],
                                         row['succeeded_packages'], row['failed_packages']) for row in rows}
        self.assertEqual(actual, STATISTICS)
        succeeded = self.rows('executions-statistics.sql', (48, '2026-10-03 06:00:00', 'S', '%', 7))
        self.assertEqual({row['calendar_date']: row['created_packages'] for row in succeeded},
                         {date(2026, 10, 1): 1, date(2026, 10, 2): 1, date(2026, 10, 3): 0})
        one_hour = self.rows('executions-statistics.sql', (1, '2026-10-02 12:00:00', 'S', '%', 0))
        self.assertEqual([(row['calendar_date'], row['created_packages']) for row in one_hour],
                         [(date(2026, 10, 2), 3)])

    def test_history_estimates_skip_zero_mean_and_completed_rows(self):
        quick = self.rows('package-history.sql', ('F', 'P', 'Quick.dtsx'))
        self.assertEqual([row['execution_id'] for row in quick], [12, 11, 10])
        self.assertEqual([row['percent_complete'] for row in quick], [None, None, None])
        self.assertEqual([row['has_expected_values'] for row in quick], [1, 0, 0])
        slow = self.rows('package-history.sql', ('F', 'P', 'Slow.dtsx'))
        self.assertEqual([row['execution_id'] for row in slow], [21, 20])
        self.assertIsNotNone(slow[0]['percent_complete'])
        self.assertIsNone(slow[1]['percent_complete'])
