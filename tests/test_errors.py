import json
import sys
import unittest
from unittest.mock import Mock, patch

from flask import abort, got_request_exception
import pyodbc

from dashboard import create_app
from dashboard.db import load_query
from dashboard.ssis import monitor
from dashboard.validation import InvalidInput, validate_execution_id
from tests.fixtures import LegacyMonitorFixture
from tests.test_db import ConnectionFixture


class InputValidationTests(unittest.TestCase):
    def setUp(self):
        connector = patch('pyodbc.connect', side_effect=AssertionError('No live database in tests'))
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.app = create_app({'TESTING': True})
        self.client = self.app.test_client()

    def assert_rejected_before_monitor(self, paths, status):
        with patch('dashboard.views.monitor') as factory:
            for path in paths:
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, status)
            factory.assert_not_called()
        self.connect.assert_not_called()

    def test_invalid_statuses_are_rejected_before_any_query_on_both_routes(self):
        self.assert_rejected_before_monitor([
            '/folder/F/project/P/status/unknown',
            '/folder/F/project/P/status/SUCCEEDED',
            '/history/F/project/P/status/unknown/package/Example.dtsx',
        ], 400)

    def test_invalid_event_category_is_rejected_before_execution_lookup(self):
        self.assert_rejected_before_monitor([
            '/execution/42/events/unknown',
            '/execution/42/events/errors.sql',
            '/execution/42/events/execution-values',
        ], 400)

    def test_zero_and_overflow_ids_are_rejected_on_all_execution_routes(self):
        self.assert_rejected_before_monitor([
            f'/execution/{execution_id}{suffix}'
            for execution_id in (0, 2**63, 10**100)
            for suffix in ('', '/events/all', '/values')
        ], 400)

    def test_unmatched_id_segments_are_database_free_404s(self):
        paths = [
            '/execution/-1', '/execution/not-an-id', '/execution/1.5',
        ]
        if 0 < sys.get_int_max_str_digits() < 5000:
            paths.append('/execution/' + '9' * 5000)
        self.assert_rejected_before_monitor(paths, 404)

    def test_invalid_values_are_not_echoed_in_error_pages(self):
        response = self.client.get('/execution/42/events/%3Cscript%3Esecret-input')
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('secret-input', response.get_data(as_text=True))
        self.assertNotIn('<script>', response.get_data(as_text=True))
        self.connect.assert_not_called()

    def test_all_legacy_statuses_and_event_categories_still_render(self):
        with patch('dashboard.views.monitor', LegacyMonitorFixture):
            for status in ('all', 'created', 'running', 'cancelled', 'failed', 'pending',
                           'halted', 'succeeded', 'stopping', 'completed'):
                with self.subTest(status=status):
                    self.assertEqual(self.client.get(f'/folder/F/project/P/status/{status}').status_code, 200)
            for category in ('all', 'errors', 'warnings', 'duplicate-warnings', 'memory-warnings'):
                with self.subTest(category=category):
                    response = self.client.get(f'/execution/42/events/{category}')
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('&lt;script&gt;fixture&lt;/script&gt;', response.get_data(as_text=True))
        self.connect.assert_not_called()

    def test_largest_positive_bigint_remains_valid(self):
        instance = LegacyMonitorFixture()
        with patch('dashboard.views.monitor', return_value=instance):
            response = self.client.get(f'/execution/{2**63 - 1}/values')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(instance.execution_id, 2**63 - 1)
        self.connect.assert_not_called()

    def test_execution_id_validation_rejects_coercion_and_booleans(self):
        for value in (True, False, None, '42', 42.0, -1, 0, 2**63):
            with self.subTest(value=value), self.assertRaises(InvalidInput):
                validate_execution_id(value)

    def test_monitor_rejects_unsupported_event_and_detail_queries(self):
        with self.app.app_context(), patch('dashboard.ssis.execute_query') as query:
            instance = monitor()
            instance.execution_id = 42
            for operation in (instance.get_package_events, instance.get_package_details):
                for value in ('unknown', '../engine-info', 'errors.sql', None, []):
                    with self.subTest(operation=operation.__name__, value=value), self.assertRaises(InvalidInput):
                        operation(value)
            query.assert_not_called()
        self.connect.assert_not_called()

    def test_monitor_rejects_invalid_status_without_executing_sql(self):
        with self.app.app_context(), patch('dashboard.ssis.execute_query') as query:
            instance = monitor()
            instance.status = 'unknown'
            for operation in (instance.get_execution_statistics, instance.get_package_list):
                with self.subTest(operation=operation.__name__), self.assertRaises(InvalidInput):
                    operation()
            query.assert_not_called()
        self.connect.assert_not_called()

    def test_supported_selectors_choose_existing_resources_and_bind_execution_id(self):
        operations = [
            ('get_package_events', 'all', 'package-events-all.sql'),
            ('get_package_events', 'errors', 'package-events-errors.sql'),
            ('get_package_events', 'warnings', 'package-events-warnings.sql'),
            ('get_package_events', 'duplicate-warnings', 'package-events-duplicate-warnings.sql'),
            ('get_package_events', 'memory-warnings', 'package-events-memory-warnings.sql'),
            ('get_package_details', 'execution-values', 'package-details-execution-values.sql'),
            ('get_package_details', 'execution-overrides', 'package-details-execution-overrides.sql'),
        ]
        with self.app.app_context(), patch('dashboard.ssis.execute_query', return_value=[]) as query:
            instance = monitor()
            instance.execution_id = 42
            for name, selector, resource in operations:
                with self.subTest(selector=selector):
                    self.assertTrue(load_query(resource).strip())
                    self.assertEqual(getattr(instance, name)(selector), [])
                    self.assertEqual(query.call_args.args, (resource, (42,)))
                    self.assertFalse(query.call_args.kwargs['one_row'])
        self.connect.assert_not_called()


class HttpErrorTests(unittest.TestCase):
    def setUp(self):
        connector = patch('pyodbc.connect', side_effect=AssertionError('No live database in tests'))
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.app = create_app({'TESTING': True})
        self.client = self.app.test_client()

    def assert_safe_error(self, response, status):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.mimetype, 'text/html')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        request_id = response.headers['X-Request-ID']
        self.assertRegex(request_id, r'\A[0-9a-f]{32}\Z')
        self.assertIn(request_id, response.get_data(as_text=True))
        self.assertIn('href="/"', response.get_data(as_text=True))
        return response.get_data(as_text=True)

    def logged_events(self, logged, event):
        records = [json.loads(record.getMessage()) for record in logged.records]
        return [record for record in records if record['event'] == event]

    def test_unknown_route_and_missing_static_file_need_no_database(self):
        with patch('dashboard.views.monitor') as factory:
            for path in ('/not-a-route', '/static/does-not-exist.css'):
                with self.subTest(path=path):
                    self.assert_safe_error(self.client.get(path), 404)
            factory.assert_not_called()
        self.connect.assert_not_called()

    def test_wrong_method_preserves_allow_header_and_needs_no_database(self):
        response = self.client.post('/execution/42')
        self.assert_safe_error(response, 405)
        self.assertIn('GET', response.headers['Allow'])
        self.assertIn('HEAD', response.headers['Allow'])
        self.connect.assert_not_called()

    def test_head_error_keeps_status_and_headers_without_a_body(self):
        response = self.client.head('/not-a-route')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_data(), b'')
        self.assertRegex(response.headers['X-Request-ID'], r'\A[0-9a-f]{32}\Z')
        self.connect.assert_not_called()

    def test_absent_or_invisible_execution_short_circuits_all_detail_routes(self):
        for path in ('/execution/42', '/execution/42/events/all', '/execution/42/values'):
            with self.subTest(path=path):
                instance = Mock(spec=LegacyMonitorFixture)
                instance.get_package_info.return_value = {}
                with patch('dashboard.views.monitor', return_value=instance):
                    self.assert_safe_error(self.client.get(path), 404)
                instance.get_package_info.assert_called_once_with()
                self.assertEqual([call[0] for call in instance.mock_calls], ['get_package_info'])
        self.connect.assert_not_called()

    def test_each_request_gets_an_id_instead_of_trusting_a_client_id(self):
        first = self.client.get('/not-a-route', headers={'X-Request-ID': 'untrusted-client-id'})
        second = self.client.get('/not-a-route')
        self.assert_safe_error(first, 404)
        self.assert_safe_error(second, 404)
        self.assertNotEqual(first.headers['X-Request-ID'], second.headers['X-Request-ID'])
        self.assertNotIn('untrusted-client-id', first.get_data(as_text=True))

    def test_successful_requests_also_get_a_request_id(self):
        with patch('dashboard.views.monitor', LegacyMonitorFixture):
            response = self.client.get('/execution/42')
        self.assertEqual(response.status_code, 200)
        self.assertRegex(response.headers['X-Request-ID'], r'\A[0-9a-f]{32}\Z')
        self.assertNotEqual(response.headers.get('Cache-Control'), 'no-store')
        self.connect.assert_not_called()

    def test_http_exception_does_not_echo_a_custom_diagnostic(self):
        def forbidden():
            abort(403, description='private diagnostic PWD=secret')
        self.app.add_url_rule('/synthetic-denied', view_func=forbidden)
        html = self.assert_safe_error(self.client.get('/synthetic-denied'), 403)
        self.assertNotIn('private diagnostic', html)
        self.assertNotIn('PWD=', html)
        self.connect.assert_not_called()

    def test_driver_states_map_to_safe_http_errors_and_safe_logs(self):
        cases = [
            (pyodbc.OperationalError, 'HYT00', 504),
            (pyodbc.OperationalError, 'HYT01', 504),
            (pyodbc.OperationalError, '08001', 503),
            (pyodbc.OperationalError, '08S01', 503),
            (pyodbc.InterfaceError, '28000', 503),
            (pyodbc.InterfaceError, 'IM002', 503),
            (pyodbc.Error, 'IM003', 503),
            (pyodbc.ProgrammingError, '42000', 500),
            (pyodbc.ProgrammingError, '42S02', 500),
            (pyodbc.DataError, '22003', 500),
            (pyodbc.Error, 'HY000', 500),
            (pyodbc.Error, 'HY008', 500),
            (pyodbc.Error, None, 500),
        ]
        for error_type, state, status in cases:
            with self.subTest(state=state):
                diagnostic = 'SELECT secret_column; SERVER=private-host; UID=private-user; PWD=private-password'
                self.connect.side_effect = error_type(state, diagnostic) if state else error_type(diagnostic)
                with self.assertLogs(self.app.logger, level='ERROR') as logged:
                    response = self.client.get('/execution/42')
                html = self.assert_safe_error(response, status)
                combined = html + repr(dict(response.headers)) + ' '.join(logged.output)
                for value in ('secret_column', 'private-host', 'private-user', 'private-password', 'Traceback'):
                    self.assertNotIn(value, combined)
                self.assertIn(response.headers['X-Request-ID'], ' '.join(logged.output))
                event, = self.logged_events(logged, 'database_error')
                self.assertEqual(event['exception_type'], error_type.__name__)
                self.assertEqual(event['application_frames'][-1]['module'], 'dashboard.db')
                self.assertEqual(event['application_frames'][-1]['function'], 'execute_query')

    def test_unexpected_failure_is_safe_even_with_testing_enabled(self):
        with patch('dashboard.views.monitor', side_effect=RuntimeError('PWD=private-password')):
            with self.assertLogs(self.app.logger, level='ERROR') as logged:
                response = self.client.get('/')
        html = self.assert_safe_error(response, 500)
        self.assertNotIn('private-password', html + ' '.join(logged.output))
        self.assertTrue(all(record.exc_info is None for record in logged.records))
        self.connect.assert_not_called()

    def test_unexpected_failure_has_actionable_frames_without_diagnostic_values(self):
        def fail(*args, **kwargs):
            private_local = 'private-local-canary'
            original = ValueError('private-exception-canary')
            original.add_note('private-note-canary')
            raise original from RuntimeError(private_local)

        with patch('dashboard.ssis.execute_query', side_effect=fail), \
             self.assertLogs(self.app.logger, level='ERROR') as logged:
            response = self.client.get('/execution/42?token=private-url-canary')
        html = self.assert_safe_error(response, 500)
        event, = self.logged_events(logged, 'request_error')
        self.assertEqual(event['request_id'], response.headers['X-Request-ID'])
        self.assertEqual(event['exception_type'], 'ValueError')
        self.assertTrue(event['application_frames'])
        self.assertEqual(event['application_frames'][-1]['module'], 'dashboard.ssis')
        self.assertEqual(event['application_frames'][-1]['function'], '__execute_query')
        self.assertTrue(all(type(frame['line']) is int and frame['line'] > 0
                            for frame in event['application_frames']))
        for value in ('private-', 'Traceback', str(__file__), 'raise original'):
            self.assertNotIn(value, html + ' '.join(logged.output))
        self.assertTrue(all(record.exc_info is None for record in logged.records))
        self.connect.assert_not_called()

    def test_diagnostic_frames_are_bounded_and_external_metadata_is_excluded(self):
        # A deep application call chain should not expand log size or expose
        # an external script path/function or its forged module name.
        namespace = {'__name__': 'dashboard.private_module_canary'}
        exec(compile(
            "def private_function_canary():\n    raise RuntimeError('private-value-canary')\n",
            '/private-path-canary/generated.py', 'exec',
        ), namespace)
        depth = 0
        def recurse():
            nonlocal depth
            depth += 1
            if depth == 20:
                namespace['private_function_canary']()
            from dashboard.views import packages
            return packages()

        with patch('dashboard.views.monitor', side_effect=recurse), \
             self.assertLogs(self.app.logger, level='ERROR') as logged:
            response = self.client.get('/')
        html = self.assert_safe_error(response, 500)
        event, = self.logged_events(logged, 'request_error')
        self.assertTrue(event['application_frames'])
        self.assertLessEqual(len(event['application_frames']), 8)
        self.assertTrue(all(frame['module'] == 'dashboard.views' and frame['function'] == 'packages'
                            for frame in event['application_frames']))
        self.assertNotIn('private', html + ' '.join(logged.output))
        self.connect.assert_not_called()

    def test_explicit_development_propagation_preserves_error_signal_and_request_summary(self):
        for mode in ({'TESTING': True, 'DEBUG': False}, {'TESTING': False, 'DEBUG': True}):
            with self.subTest(mode=mode):
                self.app.config.update(mode, PROPAGATE_EXCEPTIONS=True)
                original = KeyError('private-error-canary')
                signals = []
                def observe(sender, **kwargs):
                    signals.append(kwargs['exception'])
                with got_request_exception.connected_to(observe, self.app), \
                     patch('dashboard.views.monitor', side_effect=original), \
                     self.assertLogs(self.app.logger, level='ERROR') as logged, \
                     self.assertRaises(KeyError) as caught:
                    self.client.get('/')
                self.assertIs(caught.exception, original)
                self.assertEqual(signals, [original])
                event, = self.logged_events(logged, 'request_error')
                summary, = self.logged_events(logged, 'request_completed')
                self.assertEqual(event['exception_type'], 'KeyError')
                self.assertEqual(event['request_id'], summary['request_id'])
                self.assertEqual(summary['outcome'], 'aborted')
                self.assertIsNone(summary['status'])
                self.assertNotIn('private-', ' '.join(logged.output))
                self.assertTrue(all(record.exc_info is None for record in logged.records))
        self.connect.assert_not_called()

    def test_debug_mode_requires_explicit_boolean_propagation_opt_in(self):
        for propagate in (None, False, 1, 'yes'):
            with self.subTest(propagate=propagate):
                self.app.config.update(DEBUG=True, PROPAGATE_EXCEPTIONS=propagate)
                with patch('dashboard.views.monitor', side_effect=RuntimeError('private-value')), \
                     self.assertLogs(self.app.logger, level='ERROR') as logged:
                    response = self.client.get('/')
                html = self.assert_safe_error(response, 500)
                self.assertNotIn('private-value', html + ' '.join(logged.output))
        self.connect.assert_not_called()

    def test_propagation_flag_keeps_safe_errors_when_debug_and_testing_are_off(self):
        self.app.config.update(TESTING=False, DEBUG=False, PROPAGATE_EXCEPTIONS=True)
        for error, status in ((RuntimeError('private-value'), 500),
                              (pyodbc.InterfaceError('08001', 'private-value'), 503)):
            with self.subTest(status=status), \
                 patch('dashboard.views.monitor', side_effect=error), \
                 self.assertLogs(self.app.logger, level='ERROR') as logged:
                response = self.client.get('/')
            html = self.assert_safe_error(response, status)
            self.assertNotIn('private-value', html + ' '.join(logged.output))
        self.connect.assert_not_called()

    def test_database_propagation_emits_signal_after_resource_cleanup(self):
        self.app.config['PROPAGATE_EXCEPTIONS'] = True
        original = pyodbc.OperationalError('HYT00', 'private-timeout-canary')
        cursor = Mock()
        cursor.execute.side_effect = original
        connection = ConnectionFixture(cursor, [])
        self.connect.side_effect = None
        self.connect.return_value = connection
        signals = []
        def observe(sender, **kwargs):
            cursor.close.assert_called_once_with()
            connection.close.assert_called_once_with()
            signals.append(kwargs['exception'])

        with got_request_exception.connected_to(observe, self.app), \
             self.assertLogs(self.app.logger, level='ERROR') as logged, \
             self.assertRaises(pyodbc.OperationalError) as caught:
            self.client.get('/execution/42')
        self.assertIs(caught.exception, original)
        self.assertEqual(signals, [original])
        event, = self.logged_events(logged, 'database_error')
        summary, = self.logged_events(logged, 'request_completed')
        self.assertEqual(event['exception_type'], 'OperationalError')
        self.assertEqual(event['sqlstate'], 'HYT00')
        self.assertEqual(event['request_id'], summary['request_id'])
        self.assertEqual(summary['query_count'], 1)
        self.assertEqual(summary['query_failures'], 1)
        self.assertEqual(summary['outcome'], 'aborted')
        self.assertNotIn('private-', ' '.join(logged.output))

    def test_expected_http_errors_stay_responses_with_propagation_enabled(self):
        self.app.config['PROPAGATE_EXCEPTIONS'] = True
        for path, method, status in (('/not-a-route', 'GET', 404),
                                     ('/execution/0', 'GET', 400),
                                     ('/execution/42', 'POST', 405)):
            with self.subTest(path=path):
                self.assert_safe_error(self.client.open(path, method=method), status)
        self.connect.assert_not_called()

    def test_query_failure_maps_after_cursor_and_connection_cleanup(self):
        events = []
        cursor = Mock()
        cursor.execute.side_effect = pyodbc.OperationalError('HYT00', 'private timeout diagnostic')
        connection = ConnectionFixture(cursor, events)
        self.connect.side_effect = None
        self.connect.return_value = connection
        with self.assertLogs(self.app.logger, level='ERROR'):
            response = self.client.get('/execution/42')
        self.assert_safe_error(response, 504)
        cursor.close.assert_called_once_with()
        connection.close.assert_called_once_with()
        cursor.fetchone.assert_not_called()
        self.connect.assert_called_once()

    def test_missing_execution_via_odbc_row_shape_does_not_run_followup_queries(self):
        cursor = Mock()
        cursor.fetchone.return_value = None
        connection = ConnectionFixture(cursor, [])
        self.connect.side_effect = None
        self.connect.return_value = connection
        self.assert_safe_error(self.client.get('/execution/42/values'), 404)
        sql, parameters = cursor.execute.call_args.args
        self.assertEqual(sql, load_query('package-info.sql'))
        self.assertEqual(parameters, (42,))
        cursor.close.assert_called_once_with()
        connection.close.assert_called_once_with()
        self.connect.assert_called_once()


if __name__ == '__main__':
    unittest.main()
