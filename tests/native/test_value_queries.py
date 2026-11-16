"""Opt-in SSISDB parameter paging with transaction-rolled-back catalog rows.

Requires a disposable local SSISDB and permission to insert internal parameter
rows. Identity allocations are not rolled back; no reseed or permission change
is attempted. Unlike the temporary-source suites, this exercises public views.
"""

import os
from pathlib import Path
import unittest
from uuid import uuid4

import pyodbc

from dashboard import create_app
from dashboard.db import load_query


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class ValueSQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5, autocommit=False)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        self.connection.timeout = 30
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.cursor.execute('SET NOCOUNT ON; BEGIN TRANSACTION;')
        self.prefix = '__batch_d_' + uuid4().hex
        self.sequence = 0

    def rows(self, sql, parameters=()):
        self.cursor.execute(sql, tuple(pyodbc.BinaryNull if value is None else value for value in parameters))
        names = [column[0] for column in self.cursor.description]
        return [dict(zip(names, row)) for row in self.cursor.fetchall()]

    def insert_parameter(self, execution_id, scope):
        self.sequence += 1
        # Let IDENTITY allocate increasing IDs while scopes alternate. Values are
        # synthetic nonsensitive strings; never clone existing parameter values.
        result = self.rows("""
SET NOCOUNT ON;
INSERT internal.execution_parameter_values
    (execution_id, object_type, parameter_data_type, parameter_name, parameter_value,
     sensitive, [required], value_set, runtime_override)
VALUES (?, ?, N'String', ?, CONVERT(sql_variant, N'batch D fixture'), 0, 0, 1, 0);
SELECT CONVERT(bigint, SCOPE_IDENTITY()) AS execution_parameter_id;
""", (execution_id, scope, f'{self.prefix}_{self.sequence}'))
        return result[0]['execution_parameter_id']

    def keys(self, execution_id, upper):
        return [(row['object_type'], row['execution_parameter_id']) for row in self.rows("""
SELECT object_type, execution_parameter_id FROM catalog.execution_parameter_values
WHERE execution_id = ? AND execution_parameter_id <= ?
ORDER BY object_type, execution_parameter_id;
""", (execution_id, upper))]

    def page(self, execution_id, limit, upper, last=None):
        last_type, last_id = last if last is not None else (None, None)
        rows = self.rows(load_query('api-values-parameters-page.sql'),
                         (execution_id, limit + 1, upper, last_type, last_id))
        self.assertLessEqual(len(rows), limit + 1)
        self.assertEqual({row['execution_id'] for row in rows}, {execution_id})
        if rows[0]['page_empty']:
            self.assertEqual(len(rows), 1)
            self.assertIsNone(rows[0]['execution_parameter_id'])
            return []
        self.assertTrue(all(not row['page_empty'] for row in rows))
        self.assertTrue(all(row['value'] is None for row in rows if row['sensitive']))
        return rows

    def test_parameter_pages_group_interleaved_scopes_and_keep_id_fence(self):
        executions = self.rows("""
SELECT TOP (1) execution_id FROM catalog.executions
WHERE status IN (3, 4, 6, 7, 9) ORDER BY execution_id DESC;
""")
        self.assertTrue(executions, 'The local SSISDB needs a completed visible execution for this test.')
        execution_id = executions[0]['execution_id']
        baseline = self.keys(execution_id, 2**63 - 1)
        for limit in (2, 3):
            with self.subTest(limit=limit):
                self.cursor.execute('SAVE TRANSACTION parameter_order;')
                try:
                    scopes = (20, 30, 20, 30, 20, 30, 50)
                    inserted = [(scope, self.insert_parameter(execution_id, scope)) for scope in scopes]
                    self.assertEqual([key[1] for key in inserted], sorted(key[1] for key in inserted))
                    self.assertNotEqual(inserted, sorted(inserted))
                    fence = self.rows(load_query('api-values-parameters-fence.sql'), (execution_id,))[0]['upper_id']
                    self.assertEqual(fence, max(key[1] for key in baseline + inserted))
                    expected = sorted(baseline + inserted)
                    self.assertEqual(self.keys(execution_id, fence), expected)
                    rows = self.page(execution_id, limit, fence)
                    later = [self.insert_parameter(execution_id, scope) for scope in (20, 30, 50)]
                    self.assertTrue(all(identifier > fence for identifier in later))
                    actual, last = [], None
                    for _ in range(len(expected) // limit + 2):
                        page = rows[:limit]
                        actual.extend((row['object_type'], row['execution_parameter_id']) for row in page)
                        if len(rows) <= limit:
                            break
                        last = actual[-1]
                        rows = self.page(execution_id, limit, fence, last)
                    else:
                        self.fail('Unbounded or non-progressing parameter cursor chain.')
                    self.assertEqual(actual, expected)
                    ids = [key[1] for key in actual]
                    self.assertEqual(len(set(ids)), len(expected))
                    self.assertTrue(set(ids).isdisjoint(later))
                    self.assertEqual(self.page(execution_id, limit, fence, actual[-1]), [])
                finally:
                    self.cursor.execute('ROLLBACK TRANSACTION parameter_order;')
                self.assertEqual(self.keys(execution_id, 2**63 - 1), baseline)

