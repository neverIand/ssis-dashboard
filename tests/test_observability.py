from concurrent.futures import ThreadPoolExecutor
import json
from threading import Barrier
import unittest
from unittest.mock import Mock, patch

import pyodbc

from dashboard import create_app
from dashboard.db import execute_query
from dashboard.ssis import monitor
from tests.test_db import ConnectionFixture


def resources():
    events = []
    cursor = Mock()
    cursor.description = [('server_name',)]
    cursor.fetchone.return_value = ('private-server-name',)
    cursor.fetchall.return_value = [('private-server-name',)]
    return cursor, ConnectionFixture(cursor, events)


def events_from(logged, event=None):
    records = [json.loads(record.getMessage()) for record in logged.records]
    return [record for record in records if event is None or record['event'] == event]


class QueryTimingTests(unittest.TestCase):
    def setUp(self):
        connector = patch('dashboard.db.pyodbc.connect')
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.cursor, self.connection = resources()
        self.connect.return_value = self.connection
        self.reports = []

    def query(self, **overrides):
        options = dict(connection_string='PWD=private-password', one_row=True,
                       login_timeout=10, query_timeout=30, on_complete=self.reports.append)
        options.update(overrides)
        return execute_query('engine-info.sql', ('private-parameter',), **options)

    def test_success_timing_is_reported_once_after_both_resources_close(self):
        def observe(report):
            self.cursor.close.assert_called_once_with()
            self.connection.close.assert_called_once_with()
            self.reports.append(report)
        with patch('dashboard.db.perf_counter', side_effect=[1.0, 1.125]):
            self.assertEqual(self.query(on_complete=observe), {'server_name': 'private-server-name'})
        self.assertEqual(self.reports, [{
            'query': 'engine-info.sql', 'duration_ms': 125.0, 'outcome': 'ok',
            'rows': 1, 'failure_stage': None, 'cleanup_failed': False,
        }])

    def test_empty_and_multi_row_counts_preserve_result_shapes(self):
        for one_row, rows, expected in ((True, None, {}), (False, [], []),
                                        (False, [('a',), ('b',)], [{'server_name': 'a'}, {'server_name': 'b'}])):
            with self.subTest(one_row=one_row, rows=rows):
                self.cursor, self.connection = resources()
                self.connect.return_value = self.connection
                self.cursor.fetchone.return_value = rows
                self.cursor.fetchall.return_value = rows
                self.assertEqual(self.query(one_row=one_row), expected)
                self.assertEqual(self.reports[-1]['rows'], len(expected) if not one_row else 0)
                self.assertEqual(self.reports[-1]['outcome'], 'ok')

    def test_each_failure_reports_its_safe_stage_without_diagnostics(self):
        for stage in ('connect', 'timeout_setup', 'cursor', 'execute', 'fetch', 'map', 'cleanup'):
            with self.subTest(stage=stage):
                self.cursor, self.connection = resources()
                self.connect.side_effect = None
                self.connect.return_value = self.connection
                error = RuntimeError('private-error-diagnostic')
                if stage == 'connect':
                    self.connect.side_effect = error
                elif stage == 'timeout_setup':
                    self.connection.timeout_error = error
                elif stage == 'cursor':
                    self.connection.cursor.side_effect = error
                elif stage == 'execute':
                    self.cursor.execute.side_effect = error
                elif stage == 'fetch':
                    self.cursor.fetchone.side_effect = error
                elif stage == 'map':
                    self.cursor.description = [()]
                else:
                    self.connection.close_error = error
                with self.assertRaises((RuntimeError, IndexError)):
                    self.query()
                report = self.reports[-1]
                self.assertEqual(report['failure_stage'], stage)
                self.assertEqual(report['outcome'], 'error')
                self.assertIsNone(report['rows'])
                self.assertEqual(report['cleanup_failed'], stage == 'cleanup')
                self.assertNotIn('private-', json.dumps(report))

    def test_cleanup_failure_keeps_the_operation_error_and_records_cleanup_flag(self):
        original = pyodbc.OperationalError('HYT00', 'private-timeout')
        self.cursor.execute.side_effect = original
        self.cursor.close.side_effect = RuntimeError('private-close-error')
        with self.assertRaises(pyodbc.OperationalError) as caught:
            self.query()
        self.assertIs(caught.exception, original)
        self.assertEqual(self.reports[-1]['failure_stage'], 'execute')
        self.assertTrue(self.reports[-1]['cleanup_failed'])
        self.connection.close.assert_called_once_with()

    def test_query_cancellation_remains_cancellation_after_cleanup_and_reporting(self):
        original = KeyboardInterrupt('private-cancellation')
        self.cursor.execute.side_effect = original
        with self.assertRaises(KeyboardInterrupt) as caught:
            self.query()
        self.assertIs(caught.exception, original)
        self.assertEqual(self.reports[-1]['outcome'], 'cancelled')
        self.cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_observer_errors_do_not_replace_success_or_active_failure(self):
        observer = Mock(side_effect=RuntimeError('private-observer-error'))
        self.assertEqual(self.query(on_complete=observer), {'server_name': 'private-server-name'})
        original = pyodbc.Error('HY000', 'private-query-error')
        self.cursor.execute.side_effect = original
        observer.side_effect = KeyboardInterrupt('private-observer-cancellation')
        with self.assertRaises(pyodbc.Error) as caught:
            self.query(on_complete=observer)
        self.assertIs(caught.exception, original)

    def test_observer_cancellation_after_success_propagates_with_resources_already_closed(self):
        with self.assertRaises(KeyboardInterrupt):
            self.query(on_complete=Mock(side_effect=KeyboardInterrupt()))
        self.cursor.close.assert_called_once_with()
        self.connection.close.assert_called_once_with()

    def test_preparation_failure_does_not_count_as_a_database_operation(self):
        observer = Mock()
        with self.assertRaises(ValueError):
            execute_query('../private-input.sql', connection_string='private-password',
                          login_timeout=10, query_timeout=30, on_complete=observer)
        observer.assert_not_called()
        self.connect.assert_not_called()


class RequestTimingTests(unittest.TestCase):
    def setUp(self):
        connector = patch('dashboard.db.pyodbc.connect', side_effect=AssertionError('No live DB in tests'))
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.app = create_app({'TESTING': True, 'CONNECTION_STRING': {'main': 'PWD=private-password'}})
        self.client = self.app.test_client()

    def add_query_route(self, count=1):
        def observed():
            for _ in range(count):
                monitor().get_engine_info()
            return 'ok'
        self.app.add_url_rule('/observed', view_func=observed)

    def test_request_and_queries_share_an_id_and_add_only_safe_numeric_timings(self):
        self.add_query_route(2)
        self.connect.side_effect = lambda *args, **kwargs: resources()[1]
        with patch('dashboard.db.perf_counter', side_effect=[1, 1.020, 2, 2.030]), \
             patch('dashboard.observability.perf_counter', side_effect=[0, 0.250]), \
             self.assertLogs(self.app.logger, level='INFO') as logged:
            response = self.client.get('/observed?token=private-query-string',
                                       headers={'Authorization': 'private-authorization', 'X-Request-ID': 'private-client-id'})
        self.assertEqual(response.status_code, 200)
        queries = events_from(logged, 'query_completed')
        summary, = events_from(logged, 'request_completed')
        self.assertEqual([record['query_index'] for record in queries], [1, 2])
        self.assertEqual([record['duration_ms'] for record in queries], [20.0, 30.0])
        self.assertEqual(summary['duration_ms'], 250.0)
        self.assertEqual(summary['query_duration_ms'], 50.0)
        self.assertEqual(summary['query_count'], 2)
        self.assertEqual(summary['query_failures'], 0)
        self.assertEqual(summary['endpoint'], 'observed')
        self.assertTrue(all(record['request_id'] == response.headers['X-Request-ID'] for record in events_from(logged)))
        self.assertNotIn('private-', ' '.join(logged.output))
        self.assertTrue(all(record.exc_info is None for record in logged.records))

    def test_missing_static_invalid_input_and_unknown_methods_log_without_database_calls(self):
        for path, method, status, expected_method in (
            ('/static/private-filename?token=private-token', 'GET', 404, 'GET'),
            ('/execution/42/events/private-category', 'GET', 400, 'GET'),
            ('/execution/42', 'PRIVATE-METHOD', 405, 'OTHER'),
        ):
            with self.subTest(path=path), self.assertLogs(self.app.logger, level='INFO') as logged:
                response = self.client.open(path, method=method)
            summary, = events_from(logged, 'request_completed')
            self.assertEqual(response.status_code, status)
            self.assertEqual(summary['status'], status)
            self.assertEqual(summary['method'], expected_method)
            self.assertEqual(summary['query_count'], 0)
            self.assertNotIn('private-', ' '.join(logged.output))
        self.connect.assert_not_called()

    def test_query_failure_and_http_failure_have_correlated_safe_events(self):
        self.add_query_route()
        cursor, connection = resources()
        cursor.execute.side_effect = pyodbc.OperationalError('HYT00', 'SQL=private-query; PWD=private-password')
        self.connect.side_effect = None
        self.connect.return_value = connection
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            response = self.client.get('/observed')
        self.assertEqual(response.status_code, 504)
        query, = events_from(logged, 'query_completed')
        database_error, = events_from(logged, 'database_error')
        summary, = events_from(logged, 'request_completed')
        self.assertEqual(query['failure_stage'], 'execute')
        self.assertEqual(database_error['sqlstate'], 'HYT00')
        self.assertEqual(summary['query_count'], 1)
        self.assertEqual(summary['query_failures'], 1)
        self.assertTrue(all(record['request_id'] == response.headers['X-Request-ID'] for record in events_from(logged)))
        self.assertNotIn('private-', ' '.join(logged.output))
        cursor.close.assert_called_once_with()
        connection.close.assert_called_once_with()

    def test_retained_context_does_not_duplicate_summary_or_leak_counters_to_next_request(self):
        self.add_query_route()
        self.connect.side_effect = lambda *args, **kwargs: resources()[1]
        with self.assertLogs(self.app.logger, level='INFO') as logged, self.app.app_context(), self.app.test_client() as client:
            first = client.get('/observed')
            second = client.get('/missing')
        summaries = events_from(logged, 'request_completed')
        self.assertEqual(len(summaries), 2)
        self.assertEqual([record['query_count'] for record in summaries], [1, 0])
        self.assertEqual([record['request_id'] for record in summaries],
                         [first.headers['X-Request-ID'], second.headers['X-Request-ID']])
        self.assertNotEqual(first.headers['X-Request-ID'], second.headers['X-Request-ID'])

    def test_concurrent_requests_keep_distinct_ids_and_query_totals(self):
        self.add_query_route()
        barrier = Barrier(2)
        def connect(*args, **kwargs):
            cursor, connection = resources()
            cursor.execute.side_effect = lambda *args: barrier.wait(timeout=5)
            return connection
        self.connect.side_effect = connect
        def get():
            with self.app.test_client() as client:
                response = client.get('/observed')
                return response.status_code, response.headers['X-Request-ID']
        with self.assertLogs(self.app.logger, level='INFO') as logged, ThreadPoolExecutor(max_workers=2) as workers:
            responses = list(workers.map(lambda _: get(), range(2)))
        ids = {identifier for status, identifier in responses if status == 200}
        self.assertEqual(len(ids), 2)
        summaries = events_from(logged, 'request_completed')
        self.assertEqual({record['request_id'] for record in summaries}, ids)
        self.assertEqual(len(summaries), 2)
        self.assertTrue(all(record['query_count'] == 1 and record['query_failures'] == 0 for record in summaries))
        self.assertTrue(all(record['query_index'] == 1 for record in events_from(logged, 'query_completed')))

    def test_cancelled_dispatch_logs_one_aborted_summary_after_cleanup(self):
        def cancelled():
            raise KeyboardInterrupt('private-cancellation')
        self.app.add_url_rule('/cancelled', view_func=cancelled)
        with self.assertLogs(self.app.logger, level='ERROR') as logged, self.assertRaises(KeyboardInterrupt):
            self.client.get('/cancelled')
        summary, = events_from(logged, 'request_completed')
        self.assertEqual(summary['outcome'], 'aborted')
        self.assertIsNone(summary['status'])
        self.assertEqual(summary['query_count'], 0)
        self.assertNotIn('private-', ' '.join(logged.output))

    def test_manual_request_context_does_not_create_a_phantom_completion(self):
        with patch.object(self.app.logger, 'log') as sink:
            with self.app.test_request_context('/not-dispatched'):
                pass
        sink.assert_not_called()

    def test_broken_log_sink_does_not_replace_safe_http_error(self):
        self.add_query_route()
        self.connect.side_effect = pyodbc.InterfaceError('08001', 'private-database-error')
        with patch.object(self.app.logger, 'log', side_effect=RuntimeError('private-sink-error')) as sink:
            response = self.client.get('/observed')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-', response.get_data(as_text=True))
        self.assertEqual(sink.call_count, 3)
        self.assertNotIn('private-', ' '.join(call.args[1] for call in sink.call_args_list))

    def test_logger_level_policy_is_explicit_and_rejects_values_without_echoing_them(self):
        self.assertEqual(self.app.config['LOG_LEVEL'], 'INFO')
        for value in (None, True, 0, 'private-password', 'info'):
            with self.subTest(value=value), self.assertRaises(ValueError) as caught:
                create_app({'LOG_LEVEL': value})
            self.assertNotIn('private-password', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
