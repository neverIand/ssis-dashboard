"""Execution HTTP, input, cursor and typed DTO contracts; native SQL is separate."""

import base64
from copy import deepcopy
import json
import unittest
from unittest.mock import Mock, patch

import pyodbc

from dashboard import create_app, cursors
from dashboard.api_validation import catalog_pattern, fixed_as_of
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
from dashboard.validation import InvalidInput
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture


NOW = parse_timestamp('2026-10-15T12:00:00.1234567Z')
WINDOW = {'from': '2026-10-14T00:00:00Z', 'to': '2026-10-16T00:00:00Z'}


def execution(identifier, **updates):
    row = {'execution_id': identifier, 'folder_name': 'Folder', 'project_name': 'Project',
           'package_name': 'Package.dtsx', 'project_lsn': 2**63 - 1,
           'environment_folder_name': None, 'environment_name': None, 'status': 2,
           'logging_level': 1, 'created_at': parse_timestamp('2026-10-14T12:00:00.7654321Z'),
           'started_at': parse_timestamp('2026-10-15T11:59:30.1234567Z'), 'ended_at': None,
           'warning_count': 0, 'error_count': 0}
    row.update(updates)
    return row


class ExecutionAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.clock = self.enterContext(patch('dashboard.executions.utc_now', return_value=NOW))
        self.query = self.enterContext(patch('dashboard.executions.execute_query', side_effect=self.query_fixture))
        self.rows = [execution(i) for i in range(1, 252)]
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR', 'EXECUTION_COUNT': 1,
                               'CONNECTION_STRING': {'main': 'private-connection-canary'}})
        self.client = self.app.test_client()

    def query_fixture(self, resource, parameters, **settings):
        # A paging oracle for HTTP/session tests, not an emulation of SQL filters.
        if resource == 'api-executions-fence.sql':
            return {'upper_id': max((r['execution_id'] for r in self.rows), default=None)}
        take, upper, last, descending = parameters[-4:]
        candidates = [r for r in self.rows if r['execution_id'] <= upper and (
            last is None or (r['execution_id'] < last if descending else r['execution_id'] > last))]
        return sorted(candidates, key=lambda r: r['execution_id'], reverse=bool(descending))[:take]

    def get(self, **values):
        return self.client.get('/api/v1/executions', query_string=values)

    def page(self, **values):
        response = self.get(**values)
        self.assertEqual(response.status_code, 200, response.json)
        self.contract.validator('ExecutionsResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json['meta']['request_id'], response.headers['X-Request-ID'])
        return response.json

    def continuation(self, page, **values):
        return {**values, 'from': page['meta']['from'], 'to': page['meta']['to'],
                'cursor': page['meta']['next_cursor']}

    def assert_invalid_cursor(self, values):
        before = self.query.call_count
        response = self.get(**values)
        self.assertEqual(response.status_code, 400, response.json)
        self.contract.validator('Problem').validate(response.json)
        self.assertIn(response.json['code'], ('invalid_cursor', 'cursor_expired'))
        self.assertEqual(self.query.call_count, before)
        self.assertNotIn('private-', response.get_data(as_text=True))

    def test_default_limit_is_independent_of_legacy_and_page_plus_one_is_bounded(self):
        page = self.page()
        self.assertEqual(len(page['data']), 50)
        self.assertEqual(page['data'][0]['execution_id'], '251')
        self.assertEqual(page['data'][-1]['execution_id'], '202')
        self.assertTrue(page['meta']['has_more'])
        self.assertEqual(page['meta']['as_of'], NOW.isoformat())
        self.assertEqual(page['meta']['to'], NOW.isoformat())
        expected_start = Timestamp(NOW.utc_ticks - 360 * 3600 * TICKS_PER_SECOND)
        self.assertEqual(page['meta']['from'], expected_start.isoformat())
        self.assertEqual(self.query.call_args.args[1][-4:], (51, 251, None, 1))
        for call in self.query.call_args_list:
            self.assertTrue(call.kwargs['typed_timestamps'])
            self.assertEqual(call.kwargs['login_timeout'], 10)
            self.assertEqual(call.kwargs['query_timeout'], 30)
        self.connect.assert_not_called()

    def test_full_traversal_has_no_duplicate_ids_in_both_directions(self):
        for direction in ('asc', 'desc'):
            with self.subTest(direction=direction):
                self.query.reset_mock()
                values = {**WINDOW, 'direction': direction, 'limit': '200'}
                first = self.page(**values)
                second = self.page(**self.continuation(first, **values))
                ids = [int(r['execution_id']) for page in (first, second) for r in page['data']]
                self.assertEqual(ids, sorted(range(1, 252), reverse=direction == 'desc'))
                self.assertEqual(len(second['data']), 51)
                self.assertFalse(second['meta']['has_more'])
                self.assertIsNone(second['meta']['next_cursor'])
                self.assertEqual(self.query.call_count, 3)  # fence once, then one query per page

    def test_ceiling_excludes_later_inserts_and_empty_exhaustion_is_valid(self):
        self.rows = [execution(1), execution(2), execution(3)]
        first = self.page(**WINDOW, limit='1', direction='asc')
        self.rows.append(execution(4))
        values = self.continuation(first, limit='1', direction='asc')
        second = self.page(**values)
        self.assertEqual(second['meta']['upper_id'], '3')
        self.rows = []  # retention or revoked visibility after the first page
        empty = self.page(**self.continuation(second, limit='1', direction='asc'))
        self.assertEqual(empty['data'], [])
        self.assertFalse(empty['meta']['has_more'])
        self.assertIsNone(empty['meta']['next_cursor'])
        self.assertEqual(empty['meta']['upper_id'], '3')

    def test_initially_empty_scope_has_null_ceiling_without_page_query(self):
        self.rows = []
        page = self.page(**WINDOW)
        self.assertEqual(page['data'], [])
        self.assertIsNone(page['meta']['upper_id'])
        self.assertFalse(page['meta']['has_more'])
        self.query.assert_called_once()

    def test_fixed_as_of_uses_unique_display_time_but_as_of_is_request_time(self):
        app = create_app({'AS_OF_DATE': '2026-07-01 12:00:00.1234567', 'LOG_LEVEL': 'ERROR'})
        response = app.test_client().get('/api/v1/executions')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['meta']['to'], '2026-07-01T11:00:00.1234567Z')
        self.assertEqual(response.json['meta']['as_of'], NOW.isoformat())

    def test_range_cap_keeps_full_precision_and_default_hours_are_elapsed_across_dst(self):
        self.page(**{'from': '2026-09-15T00:00:00Z', 'to': '2026-10-16T00:00:00Z'})
        before = self.query.call_count
        response = self.get(**{'from': '2026-09-14T23:59:59.9999999Z', 'to': '2026-10-16T00:00:00Z'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.query.call_count, before)
        for fixed in ('2026-03-29 12:00:00', '2026-10-25 12:00:00'):
            app = create_app({'HOUR_SPAN': 24, 'API_MAX_RANGE_HOURS': 24,
                               'AS_OF_DATE': fixed, 'LOG_LEVEL': 'ERROR'})
            meta = app.test_client().get('/api/v1/executions').json['meta']
            span = parse_timestamp(meta['to']).utc_ticks - parse_timestamp(meta['from']).utc_ticks
            self.assertEqual(span, 24 * 3600 * TICKS_PER_SECOND)

    def test_exact_names_and_escaped_patterns_are_bound_at_full_width(self):
        for name in ('all', '*', '%_[~', ' 東京/+#\\ ', 'a' * 128, '😀' * 64):
            with self.subTest(name=name):
                self.page(**WINDOW, folder=name, project=name)
                parameters = self.query.call_args.args[1]
                self.assertEqual(parameters[2:6], (name, name, None, None))
        self.page(**WINDOW, folder_pattern=r'*東京%_[~\*\\', project_pattern='%' * 512)
        parameters = self.query.call_args.args[1]
        self.assertEqual(parameters[4], '%東京~%~_~[~~*\\')
        self.assertEqual(parameters[5], '~%' * 512)

    def test_invalid_selectors_fail_before_sql(self):
        cases = [{'limit': value} for value in ('0', '201', '-1', '1.0', 'all', '١')]
        cases += [{'status': value} for value in ('0', 'all', '02', '2,2', '2, 7', '2,')]
        cases += [{'sort': 'elapsed_seconds'}, {'sort': 'execution_id;DROP'}, {'direction': 'DESC'},
                  {'folder': 'x', 'folder_pattern': '*'}, {'project': 'x', 'project_pattern': '*'},
                  {'folder': 'x' * 129}, {'project': '😀' * 65}, {'folder_pattern': '*' * 513},
                  {'project_pattern': '\\a'}, {'project_pattern': 'x\\'},
                  {'from': WINDOW['to']}, {'from': '2020-01-01T00:00:00Z'},
                  {'from': '2026-10-14 00:00:00Z'}, {'to': '2026-10-16T00:00:00-00:00'}]
        for case in cases:
            with self.subTest(case=case):
                response = self.get(**{**WINDOW, **case})
                self.assertEqual(response.status_code, 400, response.json)
        self.query.assert_not_called()
        self.connect.assert_not_called()

    def test_status_and_timestamp_selectors_are_canonical_for_cursor_binding(self):
        first = self.page(**WINDOW, status='7,2', limit='1')
        parameters = self.query.call_args.args[1]
        self.assertEqual(parameters[:2], ('2026-10-14T00:00:00.0000000+00:00', '2026-10-16T00:00:00.0000000+00:00'))
        self.assertEqual(parameters[6:15], (2, 7, *([None] * 7)))
        self.page(**{**self.continuation(first, status='2,7', limit='01'),
                     'from': '2026-10-14T01:00:00+01:00'})

    def test_cursor_requires_all_selection_and_explicit_window_bounds(self):
        values = {**WINDOW, 'folder': 'private-name-canary', 'project_pattern': '*Project',
                  'status': '2,7', 'limit': '1', 'direction': 'asc'}
        first = self.page(**values)
        continuation = self.continuation(first, **values)
        for field in ('folder', 'project_pattern', 'status', 'limit', 'direction', 'from', 'to'):
            changed = dict(continuation)
            del changed[field]
            self.assert_invalid_cursor(changed)
        for changed in ({'folder': 'other'}, {'project_pattern': '*Other'}, {'status': '2'},
                        {'limit': '2'}, {'direction': 'desc'}, {'sort': 'status'},
                        {'to': '2026-10-16T00:00:00.0000001Z'}):
            self.assert_invalid_cursor({**continuation, **changed})
        body = base64.urlsafe_b64decode(first['meta']['next_cursor'].split('.')[0] + '==').decode()
        self.assertNotIn('private-', body)
        self.assertNotIn('Project', body)
        self.assertLess(len(first['meta']['next_cursor']), 8192)

    def test_cursor_rejects_malformed_tampered_wrong_resource_scope_and_restart(self):
        first = self.page(**WINDOW, limit='1')
        values = self.continuation(first, limit='1')
        token = values['cursor']
        for damaged in ('private-canary', 'x.y.z', 'é.字', 'a' * 8193,
                        token[:-1] + ('A' if token[-1] != 'A' else 'B'), token + '='):
            self.assert_invalid_cursor({**values, 'cursor': damaged})
        payload = json.loads(base64.urlsafe_b64decode(token.split('.')[0] + '=='))
        self.assert_invalid_cursor({**values, 'cursor': cursors.seal({**payload, 'resource': 'v1/history'})})
        for changes in ({'last_id': '0'}, {'upper_id': '1'}, {'v': True}, {'as_of': 'bad'}):
            self.assert_invalid_cursor({**values, 'cursor': cursors.seal({**payload, **changes})})
        for config in ({'CONNECTION_STRING': {'main': 'other private identity'}}, {'API_EVENTS_ENABLED': True}):
            original = deepcopy(self.app.config)
            self.app.config.update(config)
            self.assert_invalid_cursor(values)
            self.app.config.update(original)
        with patch('dashboard.cursors._KEY', b'x' * 32):
            self.assert_invalid_cursor(values)

    def test_cursor_expiry_does_not_slide_and_as_of_stays_fixed(self):
        first = self.page(**WINDOW, limit='1')
        self.clock.return_value = Timestamp(NOW.utc_ticks + 1799 * TICKS_PER_SECOND)
        second = self.page(**self.continuation(first, limit='1'))
        self.assertEqual(second['meta']['as_of'], first['meta']['as_of'])
        self.assertEqual(second['data'][0]['elapsed_seconds'], 30)
        self.clock.return_value = Timestamp(NOW.utc_ticks + 1800 * TICKS_PER_SECOND)
        self.assert_invalid_cursor(self.continuation(second, limit='1'))
        self.clock.return_value = Timestamp(NOW.utc_ticks - 1)
        self.assert_invalid_cursor(self.continuation(first, limit='1'))

    def test_cursor_names_and_returned_rows_stay_out_of_application_events(self):
        self.rows = [execution(1, folder_name='private-name-canary'), execution(2, folder_name='private-name-canary')]
        with self.assertLogs(self.app.logger, level='INFO') as logs:
            first = self.page(**WINDOW, folder='private-name-canary', limit='1')
            values = self.continuation(first, folder='private-name-canary', limit='1')
            self.page(**values)
            self.assert_invalid_cursor({**values, 'cursor': values['cursor'] + 'private-cursor-canary'})
        events = '\n'.join(logs.output)
        self.assertNotIn('private-', events)
        self.assertNotIn(values['cursor'], events)

    def test_typed_dto_preserves_identity_precision_unknowns_nulls_and_actual_duration(self):
        self.rows = [execution(9007199254740993, folder_name='😀' * 64, project_name='all',
                               package_name='P' * 260, status=-2147483648, logging_level=999,
                               ended_at=parse_timestamp('2026-10-15T12:00:00.1234568Z')),
                     execution(1, status=1, project_lsn=None, started_at=None, logging_level=None)]
        page = self.page(**WINDOW)
        row, pending = page['data']
        self.assertEqual(row['execution_id'], '9007199254740993')
        self.assertEqual(row['project_lsn'], '9223372036854775807')
        self.assertEqual(row['status'], {'code': -2147483648, 'name': 'unknown'})
        self.assertEqual(row['logging_level'], {'code': 999, 'name': 'unknown'})
        self.assertEqual(row['ended_at'], '2026-10-15T12:00:00.1234568Z')
        self.assertEqual(row['duration_seconds'], 30.0000001)
        self.assertEqual(row['elapsed_seconds'], 30.0000001)
        self.assertIsNone(pending['elapsed_seconds'])
        self.assertIsNone(pending['duration_seconds'])

    def test_invalid_catalog_shapes_are_safe_server_errors(self):
        for changes in ({'folder_name': 'x' * 129}, {'created_at': None}, {'warning_count': 2**53},
                        {'execution_id': 0}, {'ended_at': parse_timestamp('2026-10-01T00:00:00Z')}):
            with self.subTest(changes=changes):
                self.rows = [execution(42, **changes)] if 'execution_id' not in changes else [execution(0)]
                with self.assertLogs(self.app.logger, level='ERROR'):
                    response = self.get(**WINDOW)
                self.assertEqual(response.status_code, 500)
                self.contract.validator('Problem').validate(response.json)

    def test_head_options_invalid_inputs_and_browser_headers_obey_http_boundary(self):
        self.assertEqual(self.client.open('/api/v1/executions', method='OPTIONS').status_code, 200)
        self.query.assert_not_called()
        response = self.client.head('/api/v1/executions', query_string=WINDOW)
        self.assertEqual((response.status_code, response.data), (200, b''))
        calls = self.query.call_count
        for suffix in ('?limit=1&limit=2', '?package=bad', '?folder=%FF', '?cursor=', '?unknown=x'):
            self.assertEqual(self.client.get('/api/v1/executions' + suffix).status_code, 400)
        self.assertEqual(self.client.get('/api/v1/executions', data='private-canary').status_code, 400)
        self.assertEqual(self.query.call_count, calls)
        self.rows = []
        response = self.client.get('/api/v1/executions', query_string=WINDOW,
                                    headers={'X-Forwarded-User': 'administrator', 'X-SQL-Login': 'administrator'})
        self.assertEqual(response.json['data'], [])
        self.assertEqual(self.query.call_args.kwargs['connection_string'], 'private-connection-canary')

    def test_real_query_boundary_binds_exact_types_and_closes_both_queries(self):
        self.query.side_effect = None
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        row = execution(42)
        connections = []
        sql_cursors = []
        for names, values in ((['upper_id'], [(42,)]), (list(row), [tuple(row.values())])):
            cursor = Mock()
            cursor.description = [(name,) for name in names]
            cursor.fetchone.return_value = values[0]
            cursor.fetchall.return_value = values
            connections.append(ConnectionFixture(cursor, []))
            sql_cursors.append(cursor)
        self.connect.side_effect = connections
        self.assertEqual(self.page(**WINDOW)['data'][0]['execution_id'], '42')
        for connection, cursor in zip(connections, sql_cursors):
            connection.add_output_converter.assert_called_once()
            cursor.close.assert_called_once()
            connection.close.assert_called_once()
            sql, parameters = cursor.execute.call_args.args
            self.assertEqual(sql.count('?'), len(parameters))
            self.assertNotIn('private-', sql)
            self.assertIn('datetimeoffset(7)', sql)
        page_sql = sql_cursors[1].execute.call_args.args[0]
        self.assertLess(page_sql.index('INTO #execution_page'), page_sql.index('FROM catalog.event_messages'))

    def test_database_timeout_is_safe_and_never_falls_back_to_unbounded_legacy_query(self):
        self.query.side_effect = pyodbc.OperationalError('HYT00', 'private-canary')
        with self.assertLogs(self.app.logger, level='ERROR') as logs:
            response = self.get(**WINDOW)
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('private-', '\n'.join(logs.output) + response.get_data(as_text=True))
        self.query.assert_called_once()


class ExecutionConfigurationTests(unittest.TestCase):
    def test_fixed_dates_reject_dst_ambiguity_nonexistence_and_bad_configuration_before_sql(self):
        with patch('pyodbc.connect') as connect:
            for value in ('2026-10-25 01:30:00', '2026-03-29 01:30:00', 'bad', '',
                          '2026-10-15T00:00:00-00:00', '2026-10-15T00:00:00.12345678Z', None):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    create_app({'AS_OF_DATE': value})
            connect.assert_not_called()
        self.assertEqual(fixed_as_of('2026-10-25T01:30:00.0000001+01:00', 'Europe/London').isoformat(),
                         '2026-10-25T00:30:00.0000001Z')
        self.assertEqual(fixed_as_of('2026-10-25T01:30:00+00:00', 'Europe/London').isoformat(),
                         '2026-10-25T01:30:00.0000000Z')
        self.assertEqual(fixed_as_of('2026-07-01', 'Europe/London').isoformat(),
                         '2026-06-30T23:00:00.0000000Z')
        self.assertIsNone(fixed_as_of('NOW', 'Europe/London'))

    def test_pattern_language_has_only_explicit_star_and_backslash_escapes(self):
        self.assertEqual(catalog_pattern('all'), 'all')
        self.assertEqual(catalog_pattern(r'\*\\*%_[~'), '*\\%~%~_~[~~')
        for value in ('\\', '\\x', '\\%', '😀' * 257):
            with self.subTest(value=value), self.assertRaises(InvalidInput):
                catalog_pattern(value)
