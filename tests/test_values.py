"""Independent value policy, paging and SQL-boundary contracts."""

import base64
from copy import deepcopy
import json
from unittest.mock import Mock, patch
import unittest
from urllib.parse import quote

import pyodbc
from werkzeug.exceptions import NotFound

from dashboard import create_app, cursors
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
from dashboard.values import SECTIONS
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture
from tests.test_executions import execution


NOW = parse_timestamp('2026-10-16T14:00:00.1234567Z')


def row(section='parameters', identifier=1, **changes):
    metadata = ({'object_type':30, 'name':'Dummy', 'sql_type':'String', 'required':False,
                 'value_set':True, 'runtime_override':False} if section=='parameters'
                else {'property_path':r'\Package.Properties[Description]'})
    return {'page_empty':0, 'execution_id':42, SECTIONS[section]:identifier,
            'sensitive':False, 'value':'<value>ordinary', **metadata, **changes}


class ValueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.clock = self.enterContext(patch('dashboard.values.utc_now', return_value=NOW))
        self.visible = self.enterContext(patch('dashboard.values.visible_execution', return_value={'logging_level':None}))
        self.query = self.enterContext(patch('dashboard.values.execute_query', side_effect=self.query_fixture))
        self.app = create_app({'TESTING':True, 'LOG_LEVEL':'ERROR', 'EXECUTION_COUNT':1,
                               'API_VALUES_ENABLED':True, 'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()
        self.rows = {s:[row(s, i) for i in range(1, 252)]+[row(s, 3000, execution_id=43)] for s in SECTIONS}

    def query_fixture(self, resource, parameters, **settings):
        section = resource.split('-')[2]
        identity = SECTIONS[section]
        source = [r for r in self.rows[section] if r['execution_id']==parameters[0]]
        if resource.endswith('fence.sql'):
            return {'upper_id':max((r[identity] for r in source), default=None)}
        _, take, upper, last, *policy = parameters
        selected = sorted((r for r in source if (last or 0)<r[identity]<=upper), key=lambda r:r[identity])[:take]
        # This deliberately supplies raw forbidden values to test serializer enforcement.
        return deepcopy(selected) or [{'execution_id':parameters[0], identity:None, 'page_empty':1}]

    def get(self, values=None, identifier='42', **kwargs):
        return self.client.get('/api/v1/executions/'+quote(identifier, safe='')+'/values', query_string=values or {}, **kwargs)

    def page(self, values=None, identifier='42'):
        response = self.get(values, identifier)
        self.assertEqual(response.status_code, 200, response.json)
        self.contract.validator('ValuesResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Request-ID'], response.json['meta']['request_id'])
        self.assertIsNone(response.json['meta']['from'])
        self.assertIsNone(response.json['meta']['to'])
        return response.json

    def payload(self, page):
        return json.loads(base64.urlsafe_b64decode(page['meta']['next_cursor'].split('.')[0]+'=='))

    def invalid_cursor(self, values, identifier='42'):
        before = self.query.call_count, self.visible.call_count
        response = self.get(values, identifier)
        self.assertEqual(response.status_code, 400)
        self.assertIn(response.json['code'], ('invalid_cursor', 'cursor_expired'))
        self.assertEqual(before, (self.query.call_count, self.visible.call_count))

    def test_defaults_are_independent_of_overview_and_event_capability(self):
        self.app.config.update(AS_OF_DATE='2000-01-01T00:00:00Z', HOUR_SPAN=1)
        page = self.page()
        self.assertEqual((len(page['data']), page['meta']['section'], page['meta']['sort'], page['meta']['direction']),
                         (50, 'parameters', 'execution_parameter_id', 'asc'))
        self.assertEqual((page['meta']['upper_id'], page['meta']['as_of']), ('251', NOW.isoformat()))
        self.assertEqual(self.query.call_args.args, ('api-values-parameters-page.sql', (42, 51, 251, None)))
        self.assertFalse(self.app.config['API_EVENTS_ENABLED'])
        self.assertFalse(self.app.config['API_OVERRIDE_VALUES_ENABLED'])
        self.visible.assert_called_once_with('42', self.app.config, as_of=NOW)

    def test_each_section_is_globally_ordered_and_bounded_to_200(self):
        for section, identity in SECTIONS.items():
            values = {'section':section, 'limit':'200'}
            first = self.page(values)
            second = self.page({**values, 'cursor':first['meta']['next_cursor']})
            self.assertEqual([r[identity] for r in first['data']+second['data']], [str(i) for i in range(1, 252)])
            self.assertEqual((len(first['data']), len(second['data'])), (200, 51))
            self.assertEqual(second['meta']['as_of'], first['meta']['as_of'])
            self.assertEqual(second['meta']['sort'], identity)
            self.assertFalse(second['meta']['has_more'])
            self.assertEqual(self.query.call_args.args[1][1], 201)

    def test_sensitive_and_policy_redaction_ignore_faulty_plaintext_or_objects(self):
        for section in SECTIONS:
            for permitted in (False, True):
                self.app.config['API_OVERRIDE_VALUES_ENABLED'] = permitted
                for sensitive in (False, True):
                    reason = 'sensitive' if sensitive else 'policy' if section=='overrides' and not permitted else None
                    if reason is None:
                        continue
                    for forbidden in ('private-secret-canary', object(), '\ud800', 123, None):
                        self.rows[section] = [row(section, sensitive=sensitive, value=forbidden)]
                        item = self.page({'section':section})['data'][0]
                        self.assertEqual((item['value'], item['redacted'], item['redaction_reason'], item['truncated']),
                                         (None, True, reason, False))

    def test_unredacted_null_empty_and_safe_display_strings_are_distinct(self):
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = True
        for section in SECTIONS:
            for value in (None, '', '0', '1', '-2147483648', '12345678901234567890.1234567890',
                          '2026-10-16T12:34:56.1234567+05:45', '0x00FF', '<script>東京😀</script>'):
                self.rows[section] = [row(section, value=value)]
                item = self.page({'section':section})['data'][0]
                self.assertEqual((item['value'], item['redacted'], item['redaction_reason'], item['truncated']),
                                 (value, False, None, False))

    def test_parameter_metadata_and_unknown_object_codes_remain_typed(self):
        for code, name in ((20, 'project'), (30, 'package'), (50, 'system'), (-32768, 'unknown'), (32767, 'unknown')):
            self.rows['parameters'] = [row(object_type=code, name='😀'*64, sql_type='CustomType', required=1,
                                           value_set=0, runtime_override=True)]
            item = self.page()['data'][0]
            self.assertEqual(item['object_type'], {'code':code, 'name':name})
            self.assertEqual((item['required'], item['value_set'], item['runtime_override']), (True, False, True))
            self.assertEqual(item['sql_type'], 'CustomType')

    def test_bigint_ids_and_long_property_paths_never_enter_cursors(self):
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = True
        self.rows['overrides'] = [row('overrides', i, execution_id=9007199254740993, property_path='😀'*2000)
                                  for i in (9007199254740993, 9223372036854775807)]
        first = self.page({'section':'overrides', 'limit':'1'}, identifier='9007199254740993')
        self.assertEqual(first['data'][0]['property_path'], '😀'*2000)
        self.assertEqual(first['meta']['upper_id'], '9223372036854775807')
        payload = self.payload(first)
        self.assertEqual(payload['sort_key'], ['9007199254740993'])
        self.assertNotIn('property_path', payload)
        last = self.page({'section':'overrides', 'limit':'1', 'cursor':first['meta']['next_cursor']}, identifier='9007199254740993')
        self.assertEqual(last['data'][0]['property_id'], '9223372036854775807')

    def test_unicode_value_truncation_preserves_complete_characters(self):
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = True
        for value, expected, truncated in (('😀'*16384, '😀'*16384, False),
                                            ('a'+'😀'*20000, 'a'+'😀'*16383, True), ('x'*32770, 'x'*16384, True)):
            self.rows['overrides'] = [row('overrides', value=value)]
            item = self.page({'section':'overrides'})['data'][0]
            self.assertEqual((item['value'], item['truncated']), (expected, truncated))

    def test_empty_sections_stop_after_fence_without_invented_logging_evidence(self):
        for section in SECTIONS:
            self.rows[section] = []
            self.query.reset_mock()
            page = self.page({'section':section})
            self.assertEqual((page['data'], page['meta']['upper_id'], page['meta']['next_cursor']), ([], None, None))
            self.assertFalse(page['meta']['has_more'])
            self.assertNotIn('availability', page['meta'])
            self.query.assert_called_once()

    def test_visibility_and_query_revocation_share_safe_404(self):
        self.visible.side_effect = NotFound()
        first = self.get()
        self.assertEqual(first.status_code, 404)
        self.query.assert_not_called()
        self.visible.side_effect = None
        self.query.side_effect = lambda *a, **kw:{}
        second = self.get()
        self.assertEqual(second.status_code, 404)
        self.assertEqual({k:v for k,v in first.json.items() if k!='request_id'},
                         {k:v for k,v in second.json.items() if k!='request_id'})
        self.query.side_effect = lambda resource, *a, **kw:({'upper_id':1} if resource.endswith('fence.sql') else [])
        self.assertEqual(self.get().status_code, 404)

    def test_cursor_survives_retention_and_excludes_later_insertions(self):
        for section, identity in SECTIONS.items():
            values = {'section':section, 'limit':'2'}
            first = self.page(values)
            self.rows[section] = [r for r in self.rows[section] if r[identity]!=2]+[row(section, 900)]
            second = self.page({**values, 'cursor':first['meta']['next_cursor']})
            self.assertEqual([r[identity] for r in second['data']], ['3', '4'])
            self.assertEqual(second['meta']['upper_id'], '251')
            self.rows[section] = []
            empty = self.page({**values, 'cursor':second['meta']['next_cursor']})
            self.assertEqual(empty['data'], [])
            self.assertFalse(empty['meta']['has_more'])

    def test_cursor_binds_section_target_limit_sql_scope_and_policy(self):
        token = self.page({'limit':'1'})['meta']['next_cursor']
        self.invalid_cursor({'limit':'2', 'cursor':token})
        self.invalid_cursor({'limit':'1', 'section':'overrides', 'cursor':token})
        self.invalid_cursor({'limit':'1', 'cursor':token}, identifier='43')
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = True
        self.invalid_cursor({'limit':'1', 'cursor':token})
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = False
        self.app.config['CONNECTION_STRING']['main'] = 'another-private-scope'
        self.invalid_cursor({'limit':'1', 'cursor':token})

    def test_cursor_tampering_expiry_restart_and_wrong_resource_do_no_sql(self):
        first = self.page({'limit':'1'})
        token = first['meta']['next_cursor']
        self.invalid_cursor({'limit':'1', 'cursor':token[:-1]+('A' if token[-1]!='A' else 'B')})
        self.invalid_cursor({'limit':'1', 'cursor':cursors.seal({**self.payload(first), 'resource':'v1/events'})})
        with patch('dashboard.cursors._KEY', b'another-server-key'):
            self.invalid_cursor({'limit':'1', 'cursor':token})
        self.clock.return_value = Timestamp(NOW.utc_ticks+1800*TICKS_PER_SECOND)
        self.invalid_cursor({'limit':'1', 'cursor':token})

    def test_authenticated_malformed_ids_and_keys_fail_before_visibility(self):
        payload = self.payload(self.page({'limit':'1'}))
        for changes in ({'upper_id':'0'}, {'last_id':'9223372036854775807'}, {'sort_key':[]},
                        {'sort_key':[1]}, {'sort_key':['2']}, {'sort_nulls':[0]}, {'sort_nulls':[True]},
                        {'sort_nulls':[]}, {'sort_key':'1'}):
            self.invalid_cursor({'limit':'1', 'cursor':cursors.seal({**payload, **changes})})

    def test_invalid_inputs_methods_and_bodies_do_no_catalog_work(self):
        for identifier in ('0', '01', '-1', '+1', '1.0', '1e3', ' 1', '١', '9223372036854775808', "1' OR 1=1"):
            self.assertEqual(self.get(identifier=identifier).status_code, 400)
        for values in ({'limit':'201'}, {'limit':'0'}, {'limit':'-1'}, {'limit':'1.5'}, {'section':'all'},
                       {'section':'Parameters'}, {'sort':'property_id'}, {'direction':'asc'}, {'q':'private'}, {'from':'bad'}):
            self.assertEqual(self.get(values).status_code, 400)
        self.assertEqual(self.get(data='private-canary').status_code, 400)
        path = '/api/v1/executions/42/values'
        self.assertEqual(self.client.post(path).status_code, 405)
        self.assertEqual(self.client.open(path, method='OPTIONS').status_code, 200)
        self.visible.assert_not_called()
        self.query.assert_not_called()
        response = self.client.head(path)
        self.assertEqual((response.status_code, response.data), (200, b''))

    def test_denied_values_capability_precedes_every_sql_and_section(self):
        self.app.config['API_VALUES_ENABLED'] = False
        for identifier in ('42', '43', '01'):
            for method in ('GET', 'HEAD', 'OPTIONS'):
                for section in ('parameters', 'overrides', 'bad'):
                    response = self.client.open('/api/v1/executions/'+identifier+'/values?section='+section, method=method)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.visible.assert_not_called()
        self.query.assert_not_called()

    def test_malformed_catalog_metadata_and_values_fail_safely(self):
        self.app.config['API_OVERRIDE_VALUES_ENABLED'] = True
        for section in SECTIONS:
            changes = [{'sensitive':None}, {'sensitive':2}, {'value':123}, {'value':'\ud800'}, {'value':'x'*32771}]
            changes += ([{'name':None}, {'name':''}, {'name':'😀'*65}, {'sql_type':None}, {'sql_type':'x'*129},
                         {'object_type':True}, {'object_type':32768}, {'required':None}, {'value_set':'0'}, {'runtime_override':2}]
                        if section=='parameters' else [{'property_path':None}, {'property_path':''}, {'property_path':'😀'*2001}])
            for change in changes:
                self.rows[section] = [row(section, **change)]
                with self.assertLogs(self.app.logger, level='ERROR'):
                    self.assertEqual(self.get({'section':section}).status_code, 500)

    def test_malformed_page_markers_duplicates_and_scope_fail_safely(self):
        self.query.side_effect = lambda resource, *a, **kw:({'upper_id':1} if resource.endswith('fence.sql') else self.rows['parameters'])
        for change in ({'execution_parameter_id':True}, {'execution_parameter_id':2}, {'execution_id':43}, {'page_empty':2}):
            self.rows['parameters'] = [row(**change)]
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.get().status_code, 500)
        self.rows['parameters'] = [row(), row()]
        with self.assertLogs(self.app.logger, level='ERROR'):
            self.assertEqual(self.get().status_code, 500)

    def test_authorized_text_and_forbidden_canaries_never_enter_logs_or_tokens(self):
        for section in SECTIONS:
            self.rows[section] = [row(section, 1, value='<script>private-value-canary</script>'),
                                  row(section, 2, sensitive=True, value='private-sensitive-canary')]
            with self.assertLogs(self.app.logger, level='INFO') as logged:
                page = self.page({'section':section, 'limit':'1'})
            self.assertNotIn('private-', '\n'.join(logged.output))
            self.assertNotIn('private-', json.dumps(self.payload(page)))
            self.assertNotIn('private-sensitive-canary', str(page))
            if section=='parameters':
                self.assertEqual(page['data'][0]['value'], '<script>private-value-canary</script>')
            else:
                self.assertNotIn('private-value-canary', str(page))
                self.assertEqual(self.query.call_args.args[1][-1], 0)

    def test_native_boundary_binds_section_policy_and_closes_owned_connections(self):
        from dashboard.db import execute_query
        from dashboard.inspection import visible_execution
        self.visible.side_effect = visible_execution
        self.query.side_effect = execute_query
        for section in SECTIONS:
            records = [execution(42, logging_rows=1), {'upper_id':1}, row(section)]
            connections, cursors_used = [], []
            for record in records:
                cursor = Mock()
                cursor.description = [(key,) for key in record]
                cursor.fetchone.return_value = tuple(record.values())
                cursor.fetchall.return_value = [tuple(record.values())]
                connections.append(ConnectionFixture(cursor, []))
                cursors_used.append(cursor)
            self.connect.side_effect = connections
            self.page({'section':section})
            for connection, cursor in zip(connections, cursors_used):
                sql, parameters = cursor.execute.call_args.args
                self.assertEqual(sql.count('?'), len(parameters))
                self.assertEqual(parameters[0], 42)
                connection.add_output_converter.assert_called_once()
                cursor.close.assert_called_once()
                connection.close.assert_called_once()
            expected = (42, 51, 1, None)+( (0,) if section=='overrides' else () )
            self.assertEqual(cursors_used[-1].execute.call_args.args[1], expected)

    def test_database_failures_preserve_safe_status_and_short_circuit(self):
        for suffix, state, status in (('fence.sql', '08001', 503), ('page.sql', 'HYT00', 504)):
            def fail(resource, *args, **kwargs):
                if resource.endswith(suffix):
                    raise pyodbc.OperationalError(state, 'private-diagnostic-canary')
                return self.query_fixture(resource, *args, **kwargs)
            self.query.side_effect = fail
            with self.assertLogs(self.app.logger, level='ERROR') as logged:
                response = self.get()
            self.assertEqual(response.status_code, status)
            self.assertNotIn('private-', response.get_data(as_text=True)+'\n'.join(logged.output))
