"""Exact history selection, observed timing and bounded cursor contracts."""

import base64
from copy import deepcopy
import json
from unittest.mock import Mock, patch
import unittest

import pyodbc

from dashboard import create_app, cursors
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture
from tests.test_executions import execution


NOW = parse_timestamp('2026-10-16T12:00:00.1234567Z')
IDENTITY = {'folder':'Folder', 'project':'Project', 'package':'Package.dtsx'}


def history(identifier=1, **changes):
    return execution(identifier, logging_rows=1, **changes)


class HistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.clock = self.enterContext(patch('dashboard.history.utc_now', return_value=NOW))
        self.query = self.enterContext(patch('dashboard.history.execute_query', side_effect=self.query_fixture))
        self.app = create_app({'TESTING':True, 'LOG_LEVEL':'ERROR', 'EXECUTION_COUNT':1,
                               'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()
        self.rows = [history(i) for i in range(1, 252)]

    def query_fixture(self, resource, parameters, **settings):
        folder, project, package, *statuses = parameters[:12]
        source = [r for r in self.rows if (r['folder_name'], r['project_name'], r['package_name'])==(folder, project, package)
                  and r['status'] in statuses]
        if resource=='api-history-fence.sql':
            return {'upper_id':max((r['execution_id'] for r in source), default=None)}
        take, upper, last, descending = parameters[-4:]
        source = [r for r in source if r['execution_id']<=upper and
                  (last is None or (r['execution_id']<last if descending else r['execution_id']>last))]
        return deepcopy(sorted(source, key=lambda r:r['execution_id'], reverse=bool(descending))[:take])

    def get(self, values=None, **kwargs):
        return self.client.get('/api/v1/history', query_string={**IDENTITY, **(values or {})}, **kwargs)

    def page(self, values=None):
        response = self.get(values)
        self.assertEqual(response.status_code, 200, response.json)
        self.contract.validator('HistoryResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Request-ID'], response.json['meta']['request_id'])
        self.assertIsNone(response.json['meta']['from'])
        self.assertIsNone(response.json['meta']['to'])
        return response.json

    def payload(self, page):
        return json.loads(base64.urlsafe_b64decode(page['meta']['next_cursor'].split('.')[0]+'=='))

    def invalid_cursor(self, values):
        before = self.query.call_count
        response = self.get(values)
        self.assertEqual(response.status_code, 400, response.json)
        self.assertIn(response.json['code'], ('invalid_cursor', 'cursor_expired'))
        self.assertEqual(before, self.query.call_count)

    def test_defaults_use_last_50_running_successful_without_overview_dates(self):
        self.app.config.update(AS_OF_DATE='2000-01-01T00:00:00Z', HOUR_SPAN=1)
        self.rows += [history(900, status=4), history(901, folder_name='Other')]
        page = self.page()
        self.assertEqual([r['execution_id'] for r in page['data']], [str(i) for i in range(251, 201, -1)])
        self.assertEqual((page['meta']['sort'], page['meta']['direction'], page['meta']['upper_id']), ('execution_id', 'desc', '251'))
        self.assertEqual(self.query.call_args.args, ('api-history-page.sql',
            ('Folder', 'Project', 'Package.dtsx', 2, 7, None, None, None, None, None, None, None, 51, 251, None, 1)))
        self.assertTrue(all(r['estimate'] is None for r in page['data']))
        self.assertFalse(self.app.config['API_EVENTS_ENABLED'])
        self.assertFalse(self.app.config['API_VALUES_ENABLED'])

    def test_both_global_directions_traverse_251_rows_at_limit_200(self):
        for direction in ('asc', 'desc'):
            values = {'direction':direction, 'limit':'200'}
            first = self.page(values)
            second = self.page({**values, 'cursor':first['meta']['next_cursor']})
            expected = sorted(range(1, 252), reverse=direction=='desc')
            self.assertEqual([r['execution_id'] for r in first['data']+second['data']], list(map(str, expected)))
            self.assertEqual((len(first['data']), len(second['data'])), (200, 51))
            self.assertFalse(second['meta']['has_more'])
            self.assertEqual(first['meta']['as_of'], second['meta']['as_of'])

    def test_exact_identity_keeps_same_package_names_in_other_scopes_separate(self):
        self.rows = [history(1), history(2, folder_name='Other'), history(3, project_name='Other'),
                     history(4, package_name='PackageXdtsx')]
        self.assertEqual([r['execution_id'] for r in self.page()['data']], ['1'])
        self.assertEqual([r['execution_id'] for r in self.page({'folder':'Other'})['data']], ['2'])
        self.assertEqual([r['execution_id'] for r in self.page({'project':'Other'})['data']], ['3'])

    def test_special_names_and_full_utf16_width_are_bound_as_literals(self):
        for name in ('all', '*', '%_[~+#/\\東京', "O'Brien %25", '😀'*64):
            self.rows = [history(1, folder_name=name, project_name=name, package_name=name)]
            self.assertEqual(len(self.page({'folder':name, 'project':name, 'package':name})['data']), 1)
            self.assertEqual(self.query.call_args.args[1][:3], (name, name, name))
        self.rows = [history(1, package_name='😀'*130)]
        self.assertEqual(self.page({'package':'😀'*130})['data'][0]['package_name'], '😀'*130)

    def test_status_is_explicit_canonical_and_excludes_unknown_future_codes(self):
        self.rows = [history(i, status=i, started_at=None if i==1 else history()['started_at']) for i in range(1, 10)]
        self.rows.append(history(20, status=2147483647))
        self.assertEqual([r['execution_id'] for r in self.page()['data']], ['7', '2'])
        page = self.page({'status':'9,8,7,6,5,4,3,2,1'})
        self.assertEqual([r['status']['code'] for r in page['data']], list(range(9, 0, -1)))
        first = self.page({'limit':'1'})
        next_page = self.page({'limit':'1', 'status':'7,2', 'cursor':first['meta']['next_cursor']})
        self.assertEqual(next_page['data'][0]['execution_id'], '2')

    def test_actual_nulls_precision_and_duration_are_never_forecasts(self):
        start = parse_timestamp('2026-10-16T11:59:00.1234567+05:45')
        end = Timestamp(start.utc_ticks+1)
        self.rows = [history(1, status=7, started_at=start, ended_at=end),
                     history(2, started_at=start, ended_at=None), history(3, status=1, started_at=None, ended_at=None)]
        page = self.page({'status':'1,2,7', 'direction':'asc'})
        complete, active, pending = page['data']
        self.assertEqual(complete['duration_seconds'], 0.0000001)
        self.assertEqual(complete['started_at'], '2026-10-16T06:14:00.1234567Z')
        self.assertIsNone(active['ended_at'])
        self.assertIsNone(active['duration_seconds'])
        self.assertIsNotNone(active['elapsed_seconds'])
        self.assertIsNone(pending['elapsed_seconds'])
        self.assertTrue(all(r['estimate'] is None for r in page['data']))

    def test_long_observed_duration_and_bigints_remain_exact_wire_types(self):
        self.rows = [history(9223372036854775807, project_lsn=9007199254740993, status=7,
                            started_at=parse_timestamp('1000-01-01T00:00:00Z'), ended_at=parse_timestamp('9000-01-01T00:00:00.0000001Z'),
                            logging_level=2147483647, environment_folder_name='Env folder', environment_name=None)]
        item = self.page()['data'][0]
        self.assertEqual((item['execution_id'], item['project_lsn']), ('9223372036854775807', '9007199254740993'))
        self.assertGreater(item['duration_seconds'], 1e11)
        self.assertEqual(item['logging_level'], {'code':2147483647, 'name':'unknown'})
        self.assertEqual(item['environment'], {'folder_name':'Env folder', 'name':None})

    def test_initial_empty_and_absent_or_hidden_names_are_successful_empty(self):
        for values in ({'folder':'Absent'}, {'project':'Hidden'}, {'package':'Absent'}):
            self.query.reset_mock()
            page = self.page(values)
            self.assertEqual((page['data'], page['meta']['upper_id'], page['meta']['next_cursor']), ([], None, None))
            self.assertFalse(page['meta']['has_more'])
            self.query.assert_called_once()

    def test_cursor_survives_retention_excludes_insertions_and_rechecks_visibility(self):
        values = {'direction':'asc', 'limit':'2'}
        first = self.page(values)
        self.rows = [r for r in self.rows if r['execution_id']!=2]+[history(900)]
        self.clock.return_value = Timestamp(NOW.utc_ticks+10*TICKS_PER_SECOND)
        second = self.page({**values, 'cursor':first['meta']['next_cursor']})
        self.assertEqual([r['execution_id'] for r in second['data']], ['3', '4'])
        self.assertEqual((second['meta']['upper_id'], second['meta']['as_of']), ('251', NOW.isoformat()))
        self.assertEqual(second['data'][0]['elapsed_seconds'], first['data'][0]['elapsed_seconds'])
        self.rows = []
        empty = self.page({**values, 'cursor':second['meta']['next_cursor']})
        self.assertEqual(empty['data'], [])
        self.assertFalse(empty['meta']['has_more'])

    def test_status_membership_is_live_below_the_original_ceiling(self):
        self.rows = [history(1, status=2), history(2, status=4), history(3, status=7)]
        values = {'direction':'asc', 'limit':'1'}
        first = self.page(values)
        self.rows[1]['status'] = 2
        next_page = self.page({**values, 'cursor':first['meta']['next_cursor']})
        self.assertEqual(next_page['data'][0]['execution_id'], '2')

    def test_cursor_binds_exact_names_status_limit_direction_and_sql_policy_scope(self):
        token = self.page({'limit':'1'})['meta']['next_cursor']
        for change in ({'folder':'Other'}, {'project':'Other'}, {'package':'Other'}, {'status':'2'},
                       {'limit':'2'}, {'direction':'asc'}, {'sort':'started_at'}):
            self.invalid_cursor({'limit':'1', 'cursor':token, **change})
        self.app.config['API_VALUES_ENABLED'] = True
        self.invalid_cursor({'limit':'1', 'cursor':token})
        self.app.config['API_VALUES_ENABLED'] = False
        self.app.config['CONNECTION_STRING']['main'] = 'another-private-scope'
        self.invalid_cursor({'limit':'1', 'cursor':token})

    def test_cursor_tampering_expiry_restart_and_wrong_resource_do_no_sql(self):
        page = self.page({'limit':'1'})
        token = page['meta']['next_cursor']
        self.invalid_cursor({'limit':'1', 'cursor':token[:-1]+('A' if token[-1]!='A' else 'B')})
        self.invalid_cursor({'limit':'1', 'cursor':cursors.seal({**self.payload(page), 'resource':'v1/executions'})})
        with patch('dashboard.cursors._KEY', b'another-key'):
            self.invalid_cursor({'limit':'1', 'cursor':token})
        self.clock.return_value = Timestamp(NOW.utc_ticks+1800*TICKS_PER_SECOND)
        self.invalid_cursor({'limit':'1', 'cursor':token})

    def test_authenticated_bad_keys_and_fences_are_rejected_before_sql(self):
        payload = self.payload(self.page({'limit':'1'}))
        for change in ({'upper_id':'0'}, {'last_id':'9223372036854775807'}, {'sort_key':[]}, {'sort_key':[1]},
                       {'sort_key':['2']}, {'sort_nulls':[0]}, {'sort_nulls':[True]}, {'sort_nulls':[]}):
            self.invalid_cursor({'limit':'1', 'cursor':cursors.seal({**payload, **change})})

    def test_required_names_invalid_selectors_and_encoding_fail_without_sql(self):
        for missing in IDENTITY:
            self.assertEqual(self.client.get('/api/v1/history', query_string={k:v for k,v in IDENTITY.items() if k!=missing}).status_code, 400)
        for values in ({'folder':'x'*129}, {'project':'😀'*65}, {'package':'x'*261}, {'package':'😀'*131},
                       {'status':'0'}, {'status':'2,2'}, {'status':'2,7,'}, {'status':'20'}, {'status':'all'},
                       {'limit':'201'}, {'limit':'0'}, {'limit':'1.0'}, {'sort':'created_at'}, {'direction':'DESC'},
                       {'from':'bad'}, {'to':'bad'}, {'folder_pattern':'*'}, {'package_pattern':'*'}, {'q':'private'}):
            self.assertEqual(self.get(values).status_code, 400)
        for query in ('folder=F&folder=F&project=P&package=X', 'folder=%ZZ&project=P&package=X', 'folder=%FF&project=P&package=X'):
            self.assertEqual(self.client.get('/api/v1/history?'+query).status_code, 400)
        self.query.assert_not_called()

    def test_methods_bodies_and_head_keep_http_contracts(self):
        self.assertEqual(self.get(data='private-body').status_code, 400)
        self.assertEqual(self.client.post('/api/v1/history').status_code, 405)
        self.assertEqual(self.client.open('/api/v1/history', method='OPTIONS').status_code, 200)
        self.query.assert_not_called()
        response = self.client.head('/api/v1/history', query_string=IDENTITY)
        self.assertEqual((response.status_code, response.data), (200, b''))

    def test_bad_rows_duplicates_and_sentinel_fail_safely(self):
        changes = ({'execution_id':True}, {'execution_id':252}, {'created_at':None}, {'folder_name':None},
                   {'package_name':'x'*261}, {'project_lsn':-1}, {'logging_rows':2}, {'logging_rows':True},
                   {'logging_rows':0, 'logging_level':1}, {'warning_count':2**53}, {'error_count':-1},
                   {'started_at':NOW, 'ended_at':Timestamp(NOW.utc_ticks-1)})
        for change in changes:
            self.query.side_effect = lambda r, *a, **kw:({'upper_id':251} if r.endswith('fence.sql') else [history(**change)])
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.get().status_code, 500)
        self.query.side_effect = lambda r, *a, **kw:({'upper_id':251} if r.endswith('fence.sql') else [history(), history()])
        with self.assertLogs(self.app.logger, level='ERROR'):
            self.assertEqual(self.get().status_code, 500)
        self.query.side_effect = lambda r, *a, **kw:({'upper_id':251} if r.endswith('fence.sql') else
                                                    [history(1), history(2, logging_rows=2)])
        with self.assertLogs(self.app.logger, level='ERROR'):
            self.assertEqual(self.get({'limit':'1'}).status_code, 500)

    def test_message_value_and_estimate_canaries_are_never_exposed(self):
        self.rows = [history(i, message='private-message', parameter_value='private-value',
                             estimate={'secret':'private-forecast'}) for i in (1, 2)]
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            page = self.page({'limit':'1'})
        self.assertNotIn('private-', str(page))
        self.assertNotIn('private-', '\n'.join(logged.output))
        self.assertNotIn('private-', json.dumps(self.payload(page)))
        self.assertIsNone(page['data'][0]['estimate'])

    def test_native_boundary_binds_names_statuses_and_closes_both_connections(self):
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        connections, cursors_used = [], []
        for record in ({'upper_id':1}, history()):
            cursor = Mock()
            cursor.description = [(key,) for key in record]
            cursor.fetchone.return_value = tuple(record.values())
            cursor.fetchall.return_value = [tuple(record.values())]
            connections.append(ConnectionFixture(cursor, []))
            cursors_used.append(cursor)
        self.connect.side_effect = connections
        self.page()
        for connection, cursor in zip(connections, cursors_used):
            sql, parameters = cursor.execute.call_args.args
            self.assertEqual(sql.count('?'), len(parameters))
            self.assertEqual(parameters[:5], ('Folder', 'Project', 'Package.dtsx', 2, 7))
            self.assertNotIn('m.message,', sql)
            connection.add_output_converter.assert_called_once()
            cursor.close.assert_called_once()
            connection.close.assert_called_once()

    def test_database_errors_preserve_safe_status_and_diagnostics(self):
        for suffix, state, status in (('fence.sql', '08001', 503), ('page.sql', 'HYT00', 504)):
            def fail(resource, *a, **kw):
                if resource.endswith(suffix):
                    raise pyodbc.OperationalError(state, 'private-diagnostic-canary')
                return self.query_fixture(resource, *a, **kw)
            self.query.side_effect = fail
            with self.assertLogs(self.app.logger, level='ERROR') as logged:
                response = self.get()
            self.assertEqual(response.status_code, status)
            self.assertNotIn('private-', response.get_data(as_text=True)+'\n'.join(logged.output))
