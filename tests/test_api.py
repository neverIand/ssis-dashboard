import json
import re
import unittest
from unittest.mock import Mock, patch

from flask import g
import pyodbc
from werkzeug.datastructures import WWWAuthenticate
from werkzeug.exceptions import (BadGateway, Forbidden, NotFound, NotImplemented as NotImplementedHTTP,
                                 RequestEntityTooLarge, TooManyRequests, Unauthorized)

from dashboard import create_app, cursors
from dashboard.api import query_parameters, requires_capability, resource_response
from dashboard import api_validation as inputs
from dashboard import serialization as wire
from dashboard.validation import InvalidInput
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture


class APIHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        guard = patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL access'))
        self.connect = guard.start()
        self.addCleanup(guard.stop)
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR'})
        self.visits = Mock()

        @query_parameters('folder', 'q', 'limit', 'status', 'from')
        def inspect(execution_id):
            identifier = inputs.execution_id(execution_id)
            values = g.api_query
            result = {'execution_id': wire.bigint(identifier)}
            if 'folder' in values:
                result['folder'] = inputs.catalog_name(values['folder'])
            if 'q' in values:
                result['q'] = values['q']
            if 'limit' in values:
                result['limit'] = inputs.integer(values['limit'])
            if 'status' in values:
                result['status'] = inputs.statuses(values['status'])
            if 'from' in values:
                result['from'] = wire.utc_timestamp(inputs.timestamp(values['from']))
            self.visits()
            return resource_response(result)

        @requires_capability('events')
        def events(execution_id):
            self.visits()
            return resource_response({'execution_id': wire.bigint(inputs.execution_id(execution_id))})

        @requires_capability('values')
        def values():
            self.visits()
            return resource_response([])

        def failure(kind):
            if kind == 'nonfinite':
                return resource_response({'value': float('nan')})
            errors = {
                'invalid': InvalidInput('private-canary'), 'missing': NotFound('private-canary'),
                'forbidden': Forbidden('private-canary'),
                'auth': Unauthorized('private-canary', www_authenticate=WWWAuthenticate('Basic', {'realm': 'test'})),
                'database': pyodbc.OperationalError('08001', 'private-canary'),
                'login': pyodbc.InterfaceError('28000', 'private-canary'),
                'driver': pyodbc.InterfaceError('IM002', 'private-canary'),
                'timeout': pyodbc.OperationalError('HYT00', 'private-canary'),
                'permission': pyodbc.ProgrammingError('42000', 'private-canary'),
                'conversion': ValueError('private-canary'), 'unexpected': RuntimeError('private-canary'),
            }
            raise errors[kind]

        self.app.add_url_rule('/api/v1/_inspect/<execution_id>', view_func=inspect)
        self.app.add_url_rule('/api/v1/_events/<execution_id>', view_func=events)
        self.app.add_url_rule('/api/v1/_values', view_func=values)
        self.app.add_url_rule('/api/v1/_failure/<kind>', view_func=failure)
        self.client = self.app.test_client()

    def assert_response(self, response, schema, status=200):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.assertRegex(response.headers['X-Request-ID'], r'\A[0-9a-f]{32}\Z')
        self.contract.validator(schema).validate(response.json)
        if schema == 'Problem':
            self.assertEqual(response.mimetype, 'application/problem+json')
            self.assertEqual(response.json['status'], status)
            self.assertEqual(response.json['request_id'], response.headers['X-Request-ID'])
            self.assertNotIn('private-canary', response.get_data(as_text=True))
        else:
            self.assertEqual(response.mimetype, 'application/json')
            self.assertEqual(response.json['meta']['request_id'], response.headers['X-Request-ID'])

    def ready_connection(self, row=(True,)):
        self.cursor = Mock()
        self.cursor.description = [('ready',)]
        self.cursor.fetchone.return_value = row
        self.connection = ConnectionFixture(self.cursor, [])
        self.connect.side_effect = None
        self.connect.return_value = self.connection

    def test_metadata_and_liveness_match_schema_without_sql_or_login(self):
        for path, schema in (('/api/v1/meta', 'MetaResponse'), ('/healthz', 'LivenessResponse')):
            with self.subTest(path=path):
                response = self.client.get(path, headers={'X-Request-ID': 'private-canary', 'X-Forwarded-User': 'private-canary'})
                self.assert_response(response, schema)
                self.assertNotIn('WWW-Authenticate', response.headers)
        data = self.client.get('/api/v1/meta').json['data']
        self.assertEqual(len(data['execution_sorts']), 12)
        self.assertEqual(data['execution_sorts'], self.contract.spec['components']['parameters']['ExecutionSort']['schema']['enum'])
        self.assertEqual(data['capabilities'], {'events': False, 'values': False, 'override_values': False})
        self.assertEqual(data['limits']['default_range_hours'], 360)
        self.assertEqual([row['code'] for row in data['execution_statuses']], list(range(1, 10)))
        self.connect.assert_not_called()

    def test_openapi_implementation_labels_match_production_routes(self):
        app = create_app({'LOG_LEVEL': 'ERROR'})
        routes = {
            re.sub(r'<[^>]+>', '{id}', rule.rule) for rule in app.url_map.iter_rules()
            if 'GET' in rule.methods and (rule.rule.startswith('/api/v1/') or rule.rule in ('/healthz', '/readyz'))
        }
        implemented = {path for path, item in self.contract.spec['paths'].items()
                       if item['get']['x-implementation-status'] == 'implemented'}
        self.assertEqual(routes, implemented)
        self.connect.assert_not_called()

    def test_readiness_is_one_bounded_query_with_closed_resources_and_timing(self):
        self.ready_connection()
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            response = self.client.get('/readyz')
        self.assert_response(response, 'ReadinessResponse')
        self.connect.assert_called_once_with(self.app.config['CONNECTION_STRING']['main'], timeout=2)
        self.assertEqual(self.connection.timeout, 2)
        self.cursor.execute.assert_called_once()
        self.assertIn('WHERE 1 = 0', self.cursor.execute.call_args.args[0])
        self.cursor.close.assert_called_once()
        self.connection.close.assert_called_once()
        records = [json.loads(record.getMessage()) for record in logged.records]
        request = next(record for record in records if record['event'] == 'request_completed')
        self.assertEqual(request['query_count'], 1)
        self.assertTrue(any(record['event'] == 'query_completed' for record in records))

    def test_readiness_does_not_raise_a_lower_global_timeout(self):
        self.ready_connection()
        self.app.config.update(DB_LOGIN_TIMEOUT_SECONDS=1, DB_QUERY_TIMEOUT_SECONDS=1)
        self.assert_response(self.client.get('/readyz'), 'ReadinessResponse')
        self.assertEqual(self.connect.call_args.kwargs['timeout'], 1)
        self.assertEqual(self.connection.timeout, 1)

    def test_failed_readiness_data_and_connection_are_safe(self):
        for row in (None, (False,)):
            with self.subTest(row=row):
                self.ready_connection(row)
                self.assert_response(self.client.get('/readyz'), 'Problem', 503)
                self.connection.close.assert_called_once()
        self.connect.side_effect = pyodbc.InterfaceError('IM002', 'private-canary')
        self.assert_response(self.client.get('/readyz'), 'Problem', 503)

    def test_readiness_query_timeout_and_cleanup_failures_are_safe(self):
        self.ready_connection()
        self.cursor.execute.side_effect = pyodbc.OperationalError('HYT01', 'private-canary')
        self.assert_response(self.client.get('/readyz'), 'Problem', 504)
        self.connection.close.assert_called_once()
        self.ready_connection()
        self.connection.close_error = RuntimeError('private-canary')
        self.assert_response(self.client.get('/readyz'), 'Problem', 500)

    def test_unknown_api_paths_and_methods_have_json_legacy_remains_html(self):
        for path in ('/api/v1', '/api/v1/missing', '/api/v1/executions/42/missing', '/api/v1/meta/', '/api/v1//meta'):
            with self.subTest(path=path):
                self.assert_response(self.client.get(path), 'Problem', 404)
        for path in ('/api/v1/meta', '/healthz', '/readyz'):
            with self.subTest(path=path):
                response = self.client.post(path)
                self.assert_response(response, 'Problem', 405)
                self.assertTrue({'GET', 'HEAD', 'OPTIONS'} <= set(response.headers['Allow'].split(', ')))
        for path in ('/api/v10', '/api/v1x', '/missing', '/static/missing.css'):
            with self.subTest(legacy=path):
                self.assertEqual(self.client.get(path).mimetype, 'text/html')
        self.connect.assert_not_called()

    def test_rejected_query_values_stay_out_of_problem_bodies_and_logs(self):
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            for path in ('/api/v1/meta?cursor=private-canary', '/api/v1/missing?token=private-canary'):
                response = self.client.get(path, headers={'X-Request-ID': 'private-canary'})
                self.assertNotIn('private-canary', response.get_data(as_text=True))
        self.assertNotIn('private-canary', '\n'.join(logged.output))
        self.assert_response(self.client.get('/readyz', headers={'Transfer-Encoding': 'chunked'}), 'Problem', 400)
        self.connect.assert_not_called()

    def test_head_and_options_keep_policy_headers_without_bodies_or_sql(self):
        for path in ('/api/v1/meta', '/healthz'):
            with self.subTest(path=path):
                for method in ('HEAD', 'OPTIONS'):
                    response = self.client.open(path, method=method)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, b'')
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertRegex(response.headers['X-Request-ID'], r'\A[0-9a-f]{32}\Z')
        response = self.client.head('/api/v1/missing')
        self.assertEqual((response.status_code, response.data), (404, b''))
        self.connect.assert_not_called()

        response = self.client.open('/readyz', method='OPTIONS')
        self.assertEqual(response.status_code, 200)
        self.connect.assert_not_called()
        self.ready_connection()
        response = self.client.head('/readyz')
        self.assertEqual((response.status_code, response.data), (200, b''))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.connect.assert_called_once()

    def test_unexpected_query_keys_and_get_bodies_reject_before_readiness_sql(self):
        for suffix in ('?x=private-canary', '?x=', '?x=1&x=2', '?q=%FF', '?q=%', '?q=%GG', '?q=%00'):
            with self.subTest(suffix=suffix):
                self.assert_response(self.client.get('/readyz' + suffix), 'Problem', 400)
        self.assert_response(self.client.get('/readyz', data='private-canary'), 'Problem', 400)
        self.connect.assert_not_called()

    def test_names_and_query_text_are_decoded_once_and_keep_literal_characters(self):
        response = self.client.get('/api/v1/_inspect/42?folder=%252F%2B%23%25_%2A&q=%2525')
        self.assertEqual(response.json['data'], {'execution_id': '42', 'folder': '%2F+#%_*', 'q': '%25'})
        for folder in ('all', '  Name  ', '東京/#%_*\\+', '😀' * 64):
            with self.subTest(folder=folder):
                response = self.client.get('/api/v1/_inspect/42', query_string={'folder': folder})
                self.assertEqual(response.json['data']['folder'], folder)
        self.connect.assert_not_called()

    def test_strict_ids_counts_statuses_and_utf16_width_fail_before_view_work(self):
        for value in ('0', '01', '-1', '1.5', '١', '9223372036854775808', '9' * 5000):
            with self.subTest(id=value):
                self.assert_response(self.client.get('/api/v1/_inspect/' + value), 'Problem', 400)
        for values in ({'limit': 'bad'}, {'limit': '0'}, {'limit': '+1'}, {'limit': '201'},
                       {'status': '2,2'}, {'status': '2, 7'}, {'status': 'all'}, {'status': '02'},
                       {'folder': '😀' * 65}, {'from': '2026-10-15T12:00:00'}, {'from': '2026-10-15T12:00:00-00:00'}):
            with self.subTest(values=values):
                self.assert_response(self.client.get('/api/v1/_inspect/42', query_string=values), 'Problem', 400)
        self.visits.assert_not_called()
        self.connect.assert_not_called()

    def test_duplicate_encoded_keys_and_invalid_utf8_are_rejected(self):
        for query in ('q=1&%71=2', 'q=%ED%A0%80', 'q=%C0%AF', 'q=%', 'q=%GG', 'q=%00', '=x', 'q', 'q='):
            with self.subTest(query=query):
                self.assert_response(self.client.get('/api/v1/_inspect/42?' + query), 'Problem', 400)
        self.visits.assert_not_called()
        self.connect.assert_not_called()

    def test_valid_shared_inputs_keep_precision_and_known_selections(self):
        response = self.client.get('/api/v1/_inspect/9223372036854775807', query_string={
            'limit': '200', 'status': '7,2', 'from': '2026-10-15T12:00:00.1234567+01:00',
        })
        self.assertEqual(response.json['data'], {'execution_id': '9223372036854775807', 'limit': 200,
                         'status': [2, 7], 'from': '2026-10-15T11:00:00.1234567Z'})

    def test_capabilities_short_circuit_get_head_and_options_before_view(self):
        for identifier in ('1', '9223372036854775807'):
            for method in ('GET', 'HEAD', 'OPTIONS'):
                with self.subTest(identifier=identifier, method=method):
                    response = self.client.open('/api/v1/_events/' + identifier, method=method,
                                                headers={'X-Forwarded-User': 'admin', 'X-API-Events-Enabled': 'true'})
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assert_response(self.client.get('/api/v1/_values'), 'Problem', 403)
        self.visits.assert_not_called()
        self.connect.assert_not_called()
        self.app.config['API_EVENTS_ENABLED'] = True
        self.assertEqual(self.client.get('/api/v1/_events/42').status_code, 200)
        self.visits.assert_called_once()

    def test_all_documented_error_statuses_have_fixed_safe_problems_and_logs(self):
        cases = {'invalid': 400, 'missing': 404, 'forbidden': 403, 'auth': 401,
                 'database': 503, 'login': 503, 'driver': 503, 'timeout': 504,
                 'permission': 500, 'conversion': 500, 'unexpected': 500, 'nonfinite': 500}
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            for kind, status in cases.items():
                with self.subTest(kind=kind):
                    response = self.client.get('/api/v1/_failure/' + kind)
                    self.assert_response(response, 'Problem', status)
                    if status == 401:
                        self.assertIn('Basic', response.headers['WWW-Authenticate'])
        self.assertNotIn('private-canary', '\n'.join(logged.output))
        self.connect.assert_not_called()

    def test_unlisted_http_errors_keep_their_class_within_the_fixed_problem_set(self):
        errors = {413: RequestEntityTooLarge, 429: TooManyRequests, 501: NotImplementedHTTP, 502: BadGateway}

        def unlisted(code):
            raise errors[code]('private-canary')

        self.app.add_url_rule('/api/v1/_unlisted/<int:code>', view_func=unlisted)
        expected = {413: ('invalid_input', 400), 429: ('invalid_input', 400),
                    501: ('internal_error', 500), 502: ('internal_error', 500)}
        for original, (code, status) in expected.items():
            with self.subTest(original=original):
                response = self.client.get(f'/api/v1/_unlisted/{original}')
                self.assert_response(response, 'Problem', status)
                self.assertEqual(response.json['code'], code)
        self.connect.assert_not_called()

    def test_foreign_host_headers_are_rejected_before_policy_views_or_sql(self):
        for path in ('/api/v1/meta', '/healthz', '/readyz', '/api/v1/_values', '/api/v1/_inspect/42'):
            for host in ('private-canary.example', 'private-canary.example:5555',
                         '127.0.0.1.private-canary.example', 'localhost.private-canary.example'):
                with self.subTest(path=path, host=host):
                    response = self.client.get(path, headers={'Host': host})
                    self.assert_response(response, 'Problem', 400)
                    self.assertEqual(response.json['code'], 'invalid_input')
        for host in ('localhost', 'localhost:5555', '127.0.0.1', '127.0.0.1:5000'):
            with self.subTest(host=host):
                self.assert_response(self.client.get('/api/v1/meta', headers={'Host': host}), 'MetaResponse')
        self.visits.assert_not_called()
        self.connect.assert_not_called()


class APIConfigurationTests(unittest.TestCase):
    def test_bad_capability_and_limit_settings_fail_at_startup_without_sql(self):
        cases = [
            {'API_EVENTS_ENABLED': 'false'}, {'API_VALUES_ENABLED': 1},
            {'API_OVERRIDE_VALUES_ENABLED': None}, {'API_OVERRIDE_VALUES_ENABLED': True},
            {'API_MAX_RANGE_HOURS': 0}, {'API_MAX_RANGE_HOURS': True}, {'API_MAX_RANGE_HOURS': 24},
            {'HOUR_SPAN': 0}, {'API_MAX_TIMELINE_BUCKETS': 1001},
            {'API_READINESS_TIMEOUT_SECONDS': 0}, {'API_READINESS_TIMEOUT_SECONDS': 3},
            {'API_READINESS_TIMEOUT_SECONDS': True},
        ]
        with patch('pyodbc.connect') as connect:
            for config in cases:
                with self.subTest(config=config), self.assertRaises(ValueError):
                    create_app(config)
            connect.assert_not_called()

    def test_metadata_reports_effective_settings_per_app(self):
        first = create_app({'LOG_LEVEL': 'ERROR', 'API_EVENTS_ENABLED': True, 'API_VALUES_ENABLED': True,
                            'API_OVERRIDE_VALUES_ENABLED': True, 'DISPLAY_TIMEZONE': 'UTC',
                            'HOUR_SPAN': 24, 'API_MAX_RANGE_HOURS': 48, 'API_MAX_TIMELINE_BUCKETS': 100})
        second = create_app({'LOG_LEVEL': 'ERROR'})
        data = first.test_client().get('/api/v1/meta').json['data']
        self.assertEqual(data['capabilities'], {'events': True, 'values': True, 'override_values': True})
        self.assertEqual(data['display_timezone'], 'UTC')
        self.assertEqual(data['limits']['default_range_hours'], 24)
        self.assertEqual(data['limits']['max_range_hours'], 48)
        self.assertEqual(data['limits']['max_timeline_buckets'], 100)
        self.assertFalse(second.test_client().get('/api/v1/meta').json['data']['capabilities']['events'])

    def test_host_allowlist_and_cursor_secret_fail_at_startup_without_sql(self):
        cases = [
            {'TRUSTED_HOSTS': None}, {'TRUSTED_HOSTS': []}, {'TRUSTED_HOSTS': ()},
            {'TRUSTED_HOSTS': 'localhost'}, {'TRUSTED_HOSTS': ['']}, {'TRUSTED_HOSTS': [' ']},
            {'TRUSTED_HOSTS': ['localhost', None]},
            {'API_CURSOR_SECRET_KEY': ''}, {'API_CURSOR_SECRET_KEY': 'x' * 31},
            {'API_CURSOR_SECRET_KEY': b'x' * 31}, {'API_CURSOR_SECRET_KEY': bytearray(32)},
            {'API_CURSOR_SECRET_KEY': 2**300}, {'API_CURSOR_SECRET_KEY': True},
            {'API_CURSOR_SECRET_KEY': '\ud800' * 32},
        ]
        with patch('pyodbc.connect') as connect, patch.object(cursors, '_KEY', cursors._KEY):
            original = cursors._KEY
            for config in cases:
                with self.subTest(config=config), self.assertRaises(ValueError):
                    create_app({'LOG_LEVEL': 'ERROR', **config})
            self.assertIs(cursors._KEY, original)
            connect.assert_not_called()
