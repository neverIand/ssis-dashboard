"""Summary HTTP/cohort/typed boundary checks; native SQL is tested separately."""

from unittest.mock import Mock, patch
import unittest

import pyodbc

from dashboard import create_app
from dashboard.timestamps import parse_timestamp
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture


NOW = parse_timestamp('2026-10-16T12:00:00.1234567Z')
WINDOW = {'from': '2026-10-14T00:00:00.0000001Z', 'to': '2026-10-16T00:00:00.7654321Z'}
PATH = '/api/v1/metrics/summary'


class SummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.enterContext(patch('dashboard.metrics.utc_now', return_value=NOW))
        self.query = self.enterContext(patch('dashboard.metrics.execute_query', return_value=[]))
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR',
                               'CONNECTION_STRING': {'main': 'private-connection-canary'}})
        self.client = self.app.test_client()

    def get(self, **values):
        return self.client.get(PATH, query_string=values)

    def summary(self, **values):
        response = self.get(**values)
        self.assertEqual(response.status_code, 200, response.json)
        self.contract.validator('SummaryResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Request-ID'], response.json['meta']['request_id'])
        self.assertEqual(response.json['meta']['status_scope'], 'all')
        data = response.json['data']
        self.assertEqual(data['total'], sum(row['count'] for row in data['by_status']))
        return response.json

    def test_all_statuses_are_counted_and_known_zeros_and_unknown_codes_are_explicit(self):
        self.query.return_value = [{'status_code': code, 'execution_count': count}
                                  for code, count in ((2, 3), (7, 5), (0, 2), (-2147483648, 1), (2147483647, 1))]
        result = self.summary(status='7')
        rows = {r['code']: r for r in result['data']['by_status']}
        self.assertEqual(result['data']['total'], 12)
        self.assertEqual(rows[2], {'code': 2, 'name': 'running', 'count': 3})
        self.assertEqual(rows[5], {'code': 5, 'name': 'pending', 'count': 0})
        for code in (0, -2147483648, 2147483647):
            self.assertEqual(rows[code]['name'], 'unknown')
        self.assertEqual(list(rows), sorted(rows))
        self.query.assert_called_once()
        resource, parameters = self.query.call_args.args
        self.assertEqual(resource, 'api-metrics-summary.sql')
        self.assertEqual(parameters, ('2026-10-01T12:00:00.1234567+00:00',
                                     '2026-10-16T12:00:00.1234567+00:00', None, None, None, None))
        self.assertTrue(self.query.call_args.kwargs['typed_timestamps'])
        self.connect.assert_not_called()

    def test_empty_cohort_is_successful_with_nine_zero_entries(self):
        result = self.summary(folder='Hidden or absent', **WINDOW)
        self.assertEqual(result['data']['total'], 0)
        self.assertEqual([r['code'] for r in result['data']['by_status']], list(range(1, 10)))
        self.assertTrue(all(r['count'] == 0 for r in result['data']['by_status']))
        self.assertEqual(result['meta']['from'], WINDOW['from'])
        self.assertEqual(result['meta']['to'], WINDOW['to'])

    def test_valid_status_selection_never_changes_summary_sql_or_totals(self):
        self.query.return_value = [{'status_code': 5, 'execution_count': 2}]
        data = [self.summary(**values)['data'] for values in ({}, {'status':'7'}, {'status':'9,1,2'})]
        self.assertEqual(data[0], data[1])
        self.assertEqual(data[1], data[2])
        parameters = [call.args[1] for call in self.query.call_args_list]
        self.assertTrue(all(p == parameters[0] for p in parameters))

    def test_execution_page_effective_bounds_and_selectors_can_be_reused_exactly(self):
        for selectors in ({'folder': ' Literal%_[/+# ', 'project': 'P'*128},
                          {'folder_pattern': r'A*\*%_', 'project_pattern': r'P\\*'}):
            with self.subTest(selectors=selectors):
                with patch('dashboard.executions.utc_now', return_value=NOW), patch(
                        'dashboard.executions.execute_query', return_value={'upper_id':None}) as execution_query:
                    response = self.client.get('/api/v1/executions', query_string={**selectors, 'status':'7'})
                self.assertEqual(response.status_code, 200)
                bounds = {name: response.json['meta'][name] for name in ('from', 'to')}
                result = self.summary(**selectors, **bounds, status='7')
                self.assertEqual({k: result['meta'][k] for k in bounds}, bounds)
                self.assertEqual(self.query.call_args.args[1], execution_query.call_args.args[1][:6])

    def test_fixed_configuration_and_seven_digit_offset_bounds_are_preserved(self):
        app = create_app({'TESTING':True, 'LOG_LEVEL':'ERROR', 'AS_OF_DATE':'2026-10-15T01:02:03.0000001+03:00',
                          'HOUR_SPAN':1})
        result = app.test_client().get(PATH)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['meta']['to'], '2026-10-14T22:02:03.0000001Z')
        self.assertEqual(result.json['meta']['from'], '2026-10-14T21:02:03.0000001Z')
        result = self.summary(**{'from':'2026-10-15T01:02:03.0000001+03:00', 'to':'2026-10-15T01:02:03.0000002+03:00'})
        self.assertEqual(result['meta']['to'], '2026-10-14T22:02:03.0000002Z')

    def test_special_and_full_width_exact_names_are_bound_and_decoded_once(self):
        for name in ('all', '*', '%_[', "O'Brien/+#\\東京", '  Name  ', 'x'*128, '😀'*64):
            with self.subTest(name=name):
                self.summary(folder=name, project=name)
                self.assertEqual(self.query.call_args.args[1][2:4], (name, name))
        response = self.client.get(PATH+'?folder=%252F%2B')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.query.call_args.args[1][2], '%2F+')

    def test_explicit_patterns_escape_sql_wildcards_without_becoming_exact_names(self):
        self.summary(folder_pattern=r"A*\*%_[~", project_pattern=r'P\\*')
        parameters = self.query.call_args.args[1]
        self.assertEqual(parameters[2:4], (None, None))
        self.assertEqual(parameters[4:], ('A%*~%~_~[~~', 'P\\%'))

    def test_invalid_inputs_and_unsupported_page_parameters_fail_before_sql(self):
        values = ({'status':'0'}, {'status':'10'}, {'status':'2,2'}, {'status':'2, 7'}, {'status':''},
                  {'folder':'x'*129}, {'project':'😀'*65}, {'folder':'Exact','folder_pattern':'*'},
                  {'project':'Exact','project_pattern':'*'}, {'folder_pattern':r'bad\x'},
                  {'project_pattern':'x'*513}, {'from':'2026-10-15'}, {'to':'2026-10-16T00:00:00-00:00'},
                  {'from':'2026-10-16T00:00:00Z','to':'2026-10-15T00:00:00Z'},
                  {'from':'2020-01-01T00:00:00Z'}, {'limit':'1'}, {'sort':'status'}, {'direction':'asc'}, {'cursor':'token'})
        for selection in values:
            with self.subTest(selection=selection):
                response = self.get(**selection)
                self.assertEqual(response.status_code, 400)
                self.contract.validator('Problem').validate(response.json)
        self.query.assert_not_called()

    def test_unknown_encoding_duplicate_keys_and_bodies_keep_shared_http_guards(self):
        for suffix in ('?status=2&status=7', '?folder=%FF', '?folder=%GG', '?folder=%00', '?folder='):
            self.assertEqual(self.client.get(PATH+suffix).status_code, 400)
        self.assertEqual(self.client.get(PATH, data='private-canary').status_code, 400)
        self.assertEqual(self.client.post(PATH).status_code, 405)
        self.assertEqual(self.client.open(PATH, method='OPTIONS').status_code, 200)
        self.query.assert_not_called()
        response = self.client.head(PATH)
        self.assertEqual((response.status_code, response.data), (200, b''))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.query.assert_called_once()

    def test_bad_codes_duplicate_groups_and_unsafe_counts_fail_without_partial_totals(self):
        bad = [[{'status_code':code,'execution_count':1}] for code in (None, True, 2**31, -2**31-1)]
        bad += [[{'status_code':2,'execution_count':count}] for count in (-1, True, 1.0, 2**53)]
        bad += [[{'status_code':2,'execution_count':1}, {'status_code':2,'execution_count':2}],
                [{'status_code':2,'execution_count':2**53-1}, {'status_code':7,'execution_count':1}]]
        for rows in bad:
            with self.subTest(rows=rows):
                self.query.return_value = rows
                with self.assertLogs(self.app.logger, level='ERROR'):
                    response = self.get()
                self.assertEqual(response.status_code, 500)
                self.assertNotIn('data', response.json)
                self.contract.validator('Problem').validate(response.json)

    def test_status_group_limit_includes_zero_filled_known_codes(self):
        self.query.return_value = [{'status_code':code, 'execution_count':1} for code in range(10, 65538)]
        with self.assertLogs(self.app.logger, level='ERROR'):
            response = self.get()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('data', response.json)

    def test_real_query_boundary_binds_types_owns_cleanup_and_only_reads_executions(self):
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        cursor = Mock()
        cursor.description = [('status_code',), ('execution_count',)]
        cursor.fetchall.return_value = [(1, 4), (5, 2)]
        connection = ConnectionFixture(cursor, [])
        self.connect.side_effect = [connection]
        result = self.summary(folder="x' OR 1=1 --", **WINDOW)
        self.assertEqual(result['data']['total'], 6)
        sql, parameters = cursor.execute.call_args.args
        self.assertEqual(sql.count('?'), 6)
        self.assertEqual(parameters[2], "x' OR 1=1 --")
        self.assertNotIn(parameters[2], sql)
        self.assertIn('COUNT_BIG(*)', sql)
        self.assertIn('TOP (65537)', sql)
        self.assertIn('nvarchar(128)', sql)
        self.assertIn('nvarchar(1024)', sql)
        self.assertIn('datetimeoffset(7)', sql)
        self.assertNotIn('catalog.event', sql)
        self.assertNotIn('RECOMPILE', sql)
        connection.add_output_converter.assert_called_once()
        connection.close.assert_called_once()
        cursor.close.assert_called_once()

    def test_database_errors_and_application_logs_do_not_expose_inputs_or_diagnostics(self):
        for state, status in (('HYT00',504), ('08001',503)):
            self.query.reset_mock()
            self.query.side_effect = pyodbc.OperationalError(state, 'private-diagnostic-canary')
            with self.assertLogs(self.app.logger, level='ERROR') as logs:
                response = self.get(folder='private-folder-canary', **WINDOW)
            self.assertEqual(response.status_code, status)
            self.contract.validator('Problem').validate(response.json)
            self.assertNotIn('private-', response.get_data(as_text=True)+'\n'.join(logs.output))
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.query.assert_called_once()
