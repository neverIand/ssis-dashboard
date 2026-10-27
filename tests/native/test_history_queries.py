"""Execute the package-history page SQL against temporary sources.

Every page of both directions is compared with an independent Python estimate:
the five latest visible successes ending by the row's start, excluding itself.
"""
import os
from pathlib import Path
import unittest

import pyodbc

from dashboard import create_app
from dashboard.db import load_query
from dashboard.timestamps import (SQL_SS_TIMESTAMPOFFSET, Timestamp, decode_datetimeoffset, parse_timestamp,
                                  sql_timestamp)


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
BASE = parse_timestamp('2026-10-01T00:00:00Z').utc_ticks
SECOND = 10**7
SOURCES = """
CREATE TABLE #h_executions(execution_id bigint PRIMARY KEY,folder_name nvarchar(128),project_name nvarchar(128),
 package_name nvarchar(260),project_lsn bigint,environment_folder_name nvarchar(128),environment_name nvarchar(128),
 status int,created_time datetimeoffset(7),start_time datetimeoffset(7),end_time datetimeoffset(7));
CREATE TABLE #h_events(operation_id bigint,event_name nvarchar(1024));
CREATE TABLE #h_parameters(execution_id bigint,object_type smallint,parameter_name nvarchar(128),parameter_value sql_variant);
"""


def build_executions():
    """Repeated successes plus rows that sit exactly on the sampling floor."""
    rows = []

    def add(status, start, duration, *, package='Target.dtsx', folder='F'):
        identifier = len(rows) + 1
        started = None if start is None else BASE + start * SECOND
        ended = None if started is None or duration is None else started + duration
        rows.append(dict(execution_id=identifier, folder_name=folder, project_name='P', package_name=package,
                         status=status, created_time=BASE + (start or 0) * SECOND - SECOND,
                         start_time=started, end_time=ended))
    # A target page starts before any success: no earlier sample exists.
    add(2, 1, None)
    # Fewer than six successes before the earliest page rows.
    for index in range(4):
        add(7, 10 + index, 3 * SECOND)
    add(4, 20, 5 * SECOND)
    for index in range(300):
        start = 30 + index * 4
        status = (7, 7, 7, 4, 2, 6, 7, 3)[index % 8]
        duration = (2 * SECOND + index % 5, 0, 7 * SECOND, None)[index % 4] if status != 2 else None
        if index % 37 == 5:
            duration = 400 * SECOND  # ends long after later starts
        if index % 41 == 7 and status == 7:
            duration = -SECOND  # invalid, never sampled
        if index % 29 == 3:
            add(status, None, None)  # never started
        add(status, start, duration)
        if index % 11 == 0:
            # Same end time as the success just added: ties on the floor.
            previous = rows[-1]
            if previous['end_time'] is not None and previous['status'] == 7:
                add(7, (previous['end_time'] - BASE) // SECOND - 1, previous['end_time'] - (BASE + ((previous['end_time'] - BASE) // SECOND - 1) * SECOND))
        add(7, start + 1, SECOND, package='Other.dtsx')
        add(7, start + 2, SECOND, folder='G')
    return rows


def estimate(rows, row):
    if row['start_time'] is None:
        return 0, None
    candidates = [r for r in rows if r['execution_id'] != row['execution_id']
                  and all(r[key] == row[key] for key in ('folder_name', 'project_name', 'package_name')) and r['status'] == 7
                  and r['start_time'] is not None and r['end_time'] is not None
                  and r['start_time'] <= r['end_time'] <= row['start_time']]
    candidates.sort(key=lambda r: (r['end_time'], r['execution_id']), reverse=True)
    sample = candidates[:5]
    return len(sample), (sum(r['end_time'] - r['start_time'] for r in sample) if sample else None)


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class HistorySQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.connection.add_output_converter(SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset)
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.run_batch(SOURCES)
        self.rows = build_executions()
        stamp = lambda ticks: None if ticks is None else sql_timestamp(Timestamp(ticks))
        self.cursor.executemany(
            'INSERT #h_executions VALUES(?,?,?,?,NULL,NULL,NULL,?,CONVERT(datetimeoffset(7),?),'
            'CONVERT(datetimeoffset(7),?),CONVERT(datetimeoffset(7),?))',
            [(r['execution_id'], r['folder_name'], r['project_name'], r['package_name'], r['status'],
              stamp(r['created_time']), stamp(r['start_time']), stamp(r['end_time'])) for r in self.rows])

    def run_batch(self, sql, parameters=()):
        self.cursor.execute(sql, tuple(pyodbc.BinaryNull if p is None else p for p in parameters))
        rows = []
        while True:
            if self.cursor.description:
                names = [c[0] for c in self.cursor.description]
                rows = [dict(zip(names, row)) for row in self.cursor.fetchall()]
            if not self.cursor.nextset():
                return rows

    def query(self, resource, parameters):
        self.run_batch('DROP TABLE IF EXISTS #history_page, #history_counts, #history_rows, #history_successes, #history_scopes;')
        sql = load_query(resource)
        for source, target in (('catalog.executions', '#h_executions'), ('catalog.event_messages', '#h_events'),
                               ('catalog.execution_parameter_values', '#h_parameters')):
            sql = sql.replace(source, target)
        self.assertNotIn('catalog.', sql)
        return self.run_batch(sql, parameters)

    def chain(self, statuses, descending, take):
        selection = ('F', 'P', 'Target.dtsx', *statuses, *([statuses[0]] * (9 - len(statuses))))
        upper = self.query('api-history-fence.sql', selection)[0]['upper_id']
        actual, last = [], 0
        for _ in range(200):
            rows = self.query('api-history-page.sql', (*selection, take + 1, upper, last, int(descending)))
            page = rows[:take]
            actual.extend((r['execution_id'], r['estimate_sample_count'],
                           None if r['estimate_total_ticks'] is None else int(r['estimate_total_ticks'])) for r in page)
            if len(rows) <= take:
                return actual
            last = page[-1]['execution_id']
        self.fail('Unbounded or non-progressing cursor chain')

    def expected(self, statuses, descending):
        selected = sorted((r for r in self.rows if r['folder_name'] == 'F' and r['package_name'] == 'Target.dtsx'
                           and r['status'] in statuses), key=lambda r: r['execution_id'], reverse=descending)
        return [(r['execution_id'], *estimate(self.rows, r)) for r in selected]

    def test_fixture_reaches_each_sampling_edge(self):
        counts = [estimate(self.rows, r)[0] for r in self.rows if r['package_name'] == 'Target.dtsx']
        self.assertTrue({0, 1, 4, 5} <= set(counts))
        ends = [r['end_time'] for r in self.rows if r['status'] == 7 and r['end_time'] is not None]
        self.assertLess(len(set(ends)), len(ends))

    def test_like_scope_pages_preserve_each_packages_independent_estimates(self):
        statuses = tuple(range(1, 10))
        for descending in (True, False):
            selection = ('%', 'P', '%', *statuses)
            upper = self.query('api-history-pattern-fence.sql', selection)[0]['upper_id']
            actual, last = [], 0
            for _ in range(30):
                rows = self.query('api-history-pattern-page.sql', (*selection, 51, upper, last, int(descending)))
                page = rows[:50]
                actual.extend((row['execution_id'], row['estimate_sample_count'],
                               None if row['estimate_total_ticks'] is None else int(row['estimate_total_ticks'])) for row in page)
                if len(rows) <= 50:
                    break
                last = page[-1]['execution_id']
            else:
                self.fail('Non-progressing pattern history')
            expected = [(row['execution_id'], *estimate(self.rows, row)) for row in
                        sorted(self.rows, key=lambda row: row['execution_id'], reverse=descending)]
            self.assertEqual(actual, expected)
        for package in ('T_rget[.]dtsx', '%Target%', '[OT]%'):
            selection = ('%', 'P', package, *statuses)
            expected = self.run_batch('SELECT MAX(execution_id) upper_id FROM #h_executions WHERE package_name LIKE ?', (package,))
            self.assertEqual(self.query('api-history-pattern-fence.sql', selection), expected)

    def test_every_page_of_both_directions_matches_independent_estimates(self):
        for statuses in ((2, 7), (2, 4, 6), (3,)):
            for descending in (True, False):
                for take in (7, 50):
                    with self.subTest(statuses=statuses, descending=descending, take=take):
                        self.assertEqual(self.chain(statuses, descending, take), self.expected(statuses, descending))
