from datetime import datetime, timezone
from decimal import Decimal
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import Mock, patch

import pyodbc

from dashboard import create_app
from dashboard.db import execute_query, load_query
from dashboard.ssis import monitor


class ConnectionFixture:
    """Observe ownership and timeout ordering without native ODBC handles."""

    def __init__(self, cursor, events):
        self.events = events
        self._timeout = None
        self.timeout_error = None
        self.close_error = None
        self.cursor = Mock(side_effect=lambda: events.append('cursor') or cursor)
        self.close = Mock(side_effect=self.close_connection)

    @property
    def timeout(self):
        return self._timeout

    @timeout.setter
    def timeout(self, value):
        self.events.append('query-timeout')
        if self.timeout_error is not None:
            raise self.timeout_error
        self._timeout = value

    def close_connection(self):
        self.events.append('connection-close')
        if self.close_error is not None:
            raise self.close_error


class DatabaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        connector = patch('dashboard.db.pyodbc.connect')
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.configure_resources()

    def configure_resources(self):
        self.events = []
        self.cursor_close_error = None
        self.cursor = Mock()
        self.cursor.description = [('execution_id',), ('label',)]
        self.cursor.execute.side_effect = lambda *args: self.events.append('execute')
        self.cursor.fetchall.side_effect = lambda: self.events.append('fetchall') or [(1, 'alpha'), (2, None)]
        self.cursor.fetchone.side_effect = lambda: self.events.append('fetchone') or (1, 'alpha')
        self.cursor.close.side_effect = self.close_cursor
        self.connection = ConnectionFixture(self.cursor, self.events)
        self.connect.reset_mock()
        self.connect.return_value = self.connection

    def close_cursor(self):
        self.events.append('cursor-close')
        if self.cursor_close_error is not None:
            raise self.cursor_close_error

    def query(self, query_file='engine-info.sql', parameters=(), **overrides):
        options = {'connection_string': 'synthetic connection', 'login_timeout': 10, 'query_timeout': 30}
        options.update(overrides)
        return execute_query(query_file, parameters, **options)

    def assert_resources_closed(self):
        self.cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()
        self.assertEqual(self.events[-2:], ['cursor-close', 'connection-close'])

    def test_multi_row_shape_timeouts_and_close_order(self):
        result = self.query()
        self.assertEqual(result, [{'execution_id': 1, 'label': 'alpha'}, {'execution_id': 2, 'label': None}])
        self.connect.assert_called_once_with('synthetic connection', timeout=10)
        self.assertEqual(self.connection.timeout, 30)
        self.assertEqual(self.events, ['query-timeout', 'cursor', 'execute', 'fetchall', 'cursor-close', 'connection-close'])
        self.assert_resources_closed()

    def test_single_row_shape_uses_fetchone(self):
        self.assertEqual(self.query(one_row=True), {'execution_id': 1, 'label': 'alpha'})
        self.cursor.fetchall.assert_not_called()
        self.assert_resources_closed()

    def test_empty_results_retain_legacy_shapes_without_column_metadata(self):
        for one_row, expected in ((False, []), (True, {})):
            with self.subTest(one_row=one_row):
                self.configure_resources()
                self.cursor.description = None
                self.cursor.fetchall.side_effect = None
                self.cursor.fetchall.return_value = []
                self.cursor.fetchone.side_effect = None
                self.cursor.fetchone.return_value = None
                self.assertEqual(self.query(one_row=one_row), expected)
                self.assert_resources_closed()

    def test_parameters_are_bound_without_interpolation(self):
        value = "a'; DROP TABLE example; --"
        self.query('package-info.sql', [value])
        sql, parameters = self.cursor.execute.call_args.args
        self.assertEqual(sql, load_query('package-info.sql'))
        self.assertNotIn(value, sql)
        self.assertEqual(parameters, (value,))
        self.assert_resources_closed()

    def test_odbc_values_are_preserved_without_display_or_json_conversion(self):
        values = (9007199254740993, Decimal('1.250'), datetime(2026, 10, 12, tzinfo=timezone.utc), True, None)
        names = ('id', 'duration', 'timestamp', 'flag', 'end_time')
        self.cursor.description = [(name,) for name in names]
        self.cursor.fetchone.side_effect = None
        self.cursor.fetchone.return_value = values
        result = self.query(one_row=True)
        self.assertEqual(result, dict(zip(names, values)))
        self.assertIs(result['duration'], values[1])
        self.assertIs(result['timestamp'], values[2])
        self.assert_resources_closed()

    def test_connect_failure_does_not_close_unacquired_resources(self):
        error = pyodbc.OperationalError('HYT00', 'synthetic login timeout')
        self.connect.side_effect = error
        with self.assertRaises(pyodbc.OperationalError) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.connection.close.assert_not_called()
        self.cursor.close.assert_not_called()

    def test_query_timeout_configuration_failure_closes_connection(self):
        error = pyodbc.Error('synthetic timeout configuration failure')
        self.connection.timeout_error = error
        with self.assertRaises(pyodbc.Error) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.connection.cursor.assert_not_called()
        self.cursor.close.assert_not_called()
        self.connection.close.assert_called_once_with()

    def test_cursor_creation_failure_closes_connection(self):
        error = pyodbc.Error('synthetic cursor creation failure')
        self.connection.cursor.side_effect = error
        with self.assertRaises(pyodbc.Error) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.cursor.close.assert_not_called()
        self.connection.close.assert_called_once_with()

    def test_execute_and_fetch_failures_close_both_resources(self):
        for stage in ('execute', 'fetchall', 'fetchone'):
            with self.subTest(stage=stage):
                self.configure_resources()
                error = pyodbc.OperationalError('HYT00', 'synthetic query failure')
                getattr(self.cursor, stage).side_effect = error
                with self.assertRaises(pyodbc.OperationalError) as caught:
                    self.query(one_row=stage == 'fetchone')
                self.assertIs(caught.exception, error)
                self.assert_resources_closed()

    def test_row_mapping_failures_close_both_resources(self):
        for one_row in (False, True):
            with self.subTest(one_row=one_row):
                self.configure_resources()
                self.cursor.description = [()]
                with self.assertRaises(IndexError):
                    self.query(one_row=one_row)
                self.assert_resources_closed()

    def test_cancellation_still_closes_both_resources(self):
        error = KeyboardInterrupt('synthetic cancellation')
        self.cursor.execute.side_effect = error
        with self.assertRaises(KeyboardInterrupt) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.assert_resources_closed()

    def test_cleanup_failures_do_not_replace_original_query_failure(self):
        error = pyodbc.OperationalError('HYT00', 'synthetic primary failure')
        self.cursor.execute.side_effect = error
        self.cursor_close_error = pyodbc.Error('synthetic cursor close failure')
        self.connection.close_error = pyodbc.Error('synthetic connection close failure')
        with self.assertRaises(pyodbc.OperationalError) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.assert_resources_closed()

    def test_cursor_close_failure_still_closes_connection_and_fails_operation(self):
        error = pyodbc.Error('synthetic cursor close failure')
        self.cursor_close_error = error
        self.connection.close_error = pyodbc.Error('synthetic second close failure')
        with self.assertRaises(pyodbc.Error) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.assert_resources_closed()

    def test_connection_close_failure_is_not_reported_as_success(self):
        error = pyodbc.Error('synthetic connection close failure')
        self.connection.close_error = error
        with self.assertRaises(pyodbc.Error) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.assert_resources_closed()

    def test_cancellation_during_cursor_close_still_attempts_connection_close(self):
        error = KeyboardInterrupt('synthetic cursor-close cancellation')
        self.cursor_close_error = error
        with self.assertRaises(KeyboardInterrupt) as caught:
            self.query()
        self.assertIs(caught.exception, error)
        self.assert_resources_closed()

    def test_calls_do_not_share_connections_or_cursors(self):
        other_cursor = Mock(description=[('execution_id',), ('label',)])
        other_cursor.fetchall.return_value = [(3, 'second connection')]
        other = ConnectionFixture(other_cursor, [])
        self.connect.side_effect = [self.connection, other]
        self.query()
        result = self.query()
        self.assertEqual(result, [{'execution_id': 3, 'label': 'second connection'}])
        self.assertEqual(self.connect.call_count, 2)
        self.assert_resources_closed()
        other_cursor.close.assert_called_once_with()
        other.close.assert_called_once_with()

    def test_missing_sql_fails_before_connecting(self):
        with self.assertRaises(FileNotFoundError):
            self.query('missing-query.sql')
        self.connect.assert_not_called()

    def test_paths_and_non_sql_names_are_rejected_before_connecting(self):
        for name in ('../engine-info.sql', 'query/engine-info.sql', '..\\engine-info.sql',
                     'C:\\secret.sql', 'engine-info.sql:secret.sql', 'config.cfg', '', None):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.query(name)
        self.connect.assert_not_called()

    def test_invalid_timeouts_fail_before_connecting(self):
        for setting in ('login_timeout', 'query_timeout'):
            for value in (0, -1, True, False, '5', 5.5, None, 2**31):
                with self.subTest(setting=setting, value=value), self.assertRaises(ValueError):
                    self.query(**{setting: value})
        self.connect.assert_not_called()

    def test_query_loads_and_monitor_executes_outside_project_directory(self):
        self.cursor.description = [('server_name',)]
        self.cursor.fetchone.side_effect = None
        self.cursor.fetchone.return_value = ('Synthetic SQL Server',)
        app = create_app({
            'CONNECTION_STRING': {'main': 'synthetic outside-directory connection'},
            'DB_LOGIN_TIMEOUT_SECONDS': 7, 'DB_QUERY_TIMEOUT_SECONDS': 19,
        })
        original_directory = Path.cwd()
        with TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                with app.app_context():
                    result = monitor().get_engine_info()
            finally:
                os.chdir(original_directory)
        self.assertEqual(result, {'server_name': 'Synthetic SQL Server'})
        self.connect.assert_called_once_with('synthetic outside-directory connection', timeout=7)
        self.assertEqual(self.connection.timeout, 19)
        self.assert_resources_closed()

    def test_timeout_validation_runs_at_app_construction(self):
        for key in ('DB_LOGIN_TIMEOUT_SECONDS', 'DB_QUERY_TIMEOUT_SECONDS'):
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, key):
                create_app({key: 0})
        self.connect.assert_not_called()

    def test_modified_app_timeout_is_revalidated_when_query_runs(self):
        app = create_app({})
        app.config['DB_QUERY_TIMEOUT_SECONDS'] = 0
        with app.app_context(), self.assertRaisesRegex(ValueError, 'DB_QUERY_TIMEOUT_SECONDS'):
            monitor().get_engine_info()
        self.connect.assert_not_called()

    def test_utf8_sql_with_bom_loads_without_losing_unicode(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'query').mkdir()
            (root / 'query' / 'unicode.sql').write_text('\ufeffSELECT N\'Ω\';\n', encoding='utf-8')
            with patch('dashboard.db.files', return_value=root):
                self.assertEqual(load_query('unicode.sql'), "SELECT N'Ω';\n")
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
