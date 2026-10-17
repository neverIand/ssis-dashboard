"""Execute real SQL against temporary sources, independently checking whole rows.

No mocks of SQL semantics, catalog writes, grants, servers or new dependencies.
The explicit opt-in configuration supplies an existing SQL Server connection.
"""
import os
from pathlib import Path
import unittest

import pyodbc

from dashboard import create_app
from dashboard.db import load_query
from dashboard.execution_order import CALCULATED_SORTS, EXECUTION_SORTS, encode_key, seek_values
from dashboard.timestamps import SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
FIELDS = ('execution_id', 'folder_name', 'project_name', 'package_name', 'project_lsn',
          'environment_folder_name', 'environment_name', 'status', 'created_at',
          'started_at', 'ended_at', 'logging_level', 'warning_count', 'error_count')
KEYS = {'execution_id': ['execution_id'], 'created_at': ['created_at'], 'started_at': ['started_at'],
        'ended_at': ['ended_at'], 'project_name': ['project_name'], 'package_name': ['package_name'],
        'environment': ['environment_folder_name', 'environment_name'], 'status': ['status'],
        'logging_level': ['logging_level'], 'duration_seconds': ['duration_ticks'],
        'warning_count': ['warning_count'], 'error_count': ['error_count']}
CONTROL = """
WITH expected AS (
 SELECT e.execution_id,e.folder_name,e.project_name,e.package_name,e.project_lsn,
        e.environment_folder_name,e.environment_name,e.status,e.created_time created_at,
        e.start_time started_at,e.end_time ended_at,
        (SELECT COUNT_BIG(*) FROM #sample_events m
         WHERE m.operation_id=e.execution_id AND m.event_name=N'OnWarning') warning_count,
        (SELECT COUNT_BIG(*) FROM #sample_events m
         WHERE m.operation_id=e.execution_id AND m.event_name=N'OnError') error_count,
        (SELECT CONVERT(int,CASE WHEN p.object_type=50 THEN p.parameter_value END)
         FROM #sample_parameters p WHERE p.execution_id=e.execution_id
           AND p.object_type=50 AND p.parameter_name=N'LOGGING_LEVEL') logging_level,
        DATEDIFF_BIG(microsecond,e.start_time,e.end_time)*CONVERT(bigint,10)
        +(DATEPART(nanosecond,e.end_time)%1000-DATEPART(nanosecond,e.start_time)%1000)/100 duration_ticks
 FROM #sample_executions e WHERE e.created_time>='2026-10-01T00:00:00Z'
   AND e.created_time<'2026-10-02T00:00:00Z' {where}
)
SELECT * FROM expected ORDER BY {order};
"""


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class ExecutionSQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.connection.add_output_converter(SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset)
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.cursor.execute(Path(__file__).with_name('execution_fixture.sql').read_text(encoding='utf-8'))
        while self.cursor.nextset():
            pass

    def rows(self, sql, parameters=()):
        self.cursor.execute(sql, tuple(pyodbc.BinaryNull if p is None else p for p in parameters))
        names = [c[0] for c in self.cursor.description]
        return [dict(zip(names, row)) for row in self.cursor.fetchall()]

    def page(self, sort, direction, *, last=None, seek=None, selection=None):
        # Query-local objects are discarded between batches; source fixtures stay.
        self.cursor.execute('DROP TABLE IF EXISTS #execution_page, #execution_cohort, #page_counts, #execution_counts;')
        while self.cursor.nextset():
            pass
        parameters = ['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', *([None]*13)]
        for index, value in (selection or {}).items():
            parameters[index] = value
        parameters += [51, 9007199254740993, last, int(direction == 'desc')]
        resource = ('api-executions-page.sql' if sort == 'execution_id' else
                    'api-executions-sort.sql' if sort in CALCULATED_SORTS else 'api-executions-ordered-page.sql')
        if sort != 'execution_id':
            parameters += [sort, *(seek or [None]*6)]
        sql = load_query(resource)
        for source, target in (('catalog.executions', '#sample_executions'),
                               ('catalog.event_messages', '#sample_events'),
                               ('catalog.execution_parameter_values', '#sample_parameters')):
            sql = sql.replace(source, target)
        self.assertNotIn('catalog.', sql)
        result = self.rows(sql, parameters)
        self.assertLessEqual(len(result), 51)
        return result

    def compare_chain(self, sort, direction, *, selection=None, where=''):
        order = []
        for key in KEYS[sort]:
            order += [f'CASE WHEN {key} IS NULL THEN 1 ELSE 0 END', f'{key} {direction}']
        if sort != 'execution_id':
            order.append('execution_id '+direction)
        expected = self.rows(CONTROL.format(where=where, order=','.join(order)))
        actual, last, seek = [], None, None
        for _ in range(10):
            rows = self.page(sort, direction, last=last, seek=seek, selection=selection)
            page = rows[:50]
            actual.extend(page)
            if len(rows) <= 50:
                break
            last = page[-1]['execution_id']
            key, nulls = encode_key(page[-1], sort)
            seek = seek_values({'last_id': str(last), 'sort_key': key, 'sort_nulls': nulls}, sort)
        else:
            self.fail('Unbounded or non-progressing cursor chain')
        self.assertEqual([tuple(r[k] for k in FIELDS) for r in actual],
                         [tuple(r[k] for k in FIELDS) for r in expected])

    def test_all_sorts_and_directions_preserve_rows_ties_and_null_tail(self):
        for sort in EXECUTION_SORTS:
            for direction in ('asc', 'desc'):
                with self.subTest(sort=sort, direction=direction):
                    self.compare_chain(sort, direction)

    def test_selective_and_empty_cohorts(self):
        cases = [({2: 'F1'}, "AND e.folder_name=N'F1'"),
                 ({3: 'P2', 6: 7}, "AND e.project_name=N'P2' AND e.status=7"),
                 ({4: 'F%'}, "AND e.folder_name LIKE N'F%'"),
                 ({2: 'absent'}, "AND e.folder_name=N'absent'")]
        for sort in ('execution_id', 'created_at', *sorted(CALCULATED_SORTS)):
            for selection, where in cases:
                with self.subTest(sort=sort, selection=selection):
                    self.compare_chain(sort, 'desc', selection=selection, where=where)

    def test_deleted_cursor_row_does_not_break_continuation(self):
        for sort in ('execution_id', 'created_at', *sorted(CALCULATED_SORTS)):
            with self.subTest(sort=sort):
                first = self.page(sort, 'asc')
                boundary = first[49]
                key, nulls = encode_key(boundary, sort)
                seek = seek_values({'last_id': str(boundary['execution_id']),
                                    'sort_key': key, 'sort_nulls': nulls}, sort)
                self.cursor.execute('SAVE TRANSACTION cursor_boundary;')
                try:
                    self.cursor.execute('DELETE #sample_executions WHERE execution_id=?', boundary['execution_id'])
                    continued = self.page(sort, 'asc', last=boundary['execution_id'], seek=seek)
                    self.assertEqual(continued[0]['execution_id'], first[50]['execution_id'])
                finally:
                    self.cursor.execute('ROLLBACK TRANSACTION cursor_boundary;')
