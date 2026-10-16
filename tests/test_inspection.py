"""Execution detail visibility, exact DTO and safe query-boundary contracts."""

from copy import deepcopy
from unittest.mock import Mock, patch
from urllib.parse import quote
import unittest

import pyodbc

from dashboard import create_app
from dashboard.timestamps import parse_timestamp
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture
from tests.test_executions import execution


NOW = parse_timestamp('2026-10-15T12:00:00.1234567Z')
COUNTS = {'all':8,'errors':1,'warnings':2,'duplicate_warnings':1,'memory_warnings':1}


class ExecutionDetailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect',side_effect=AssertionError('Unexpected SQL')))
        self.enterContext(patch('dashboard.inspection.utc_now',return_value=NOW))
        self.query = self.enterContext(patch('dashboard.inspection.execute_query',side_effect=self.query_fixture))
        self.row = execution(42,logging_rows=1)
        self.counts = dict(COUNTS)
        self.app = create_app({'TESTING':True,'LOG_LEVEL':'ERROR',
                               'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()

    def query_fixture(self, resource, parameters, **settings):
        return deepcopy(self.row if resource=='api-execution.sql' else self.counts)

    def get(self, identifier='42', **kwargs):
        return self.client.get('/api/v1/executions/'+quote(identifier,safe=''),**kwargs)

    def detail(self, identifier='42'):
        response = self.get(identifier)
        self.assertEqual(response.status_code,200,response.json)
        self.contract.validator('ExecutionResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.headers['X-Request-ID'],response.json['meta']['request_id'])
        self.assertEqual(set(response.json['meta']),{'request_id','generated_at'})
        data = response.json['data']
        self.assertEqual(data['warning_count'],data['event_counts']['warnings'])
        self.assertEqual(data['error_count'],data['event_counts']['errors'])
        return data

    def problem(self, identifier, expected=404):
        response = self.get(identifier)
        self.assertEqual(response.status_code,expected,response.json)
        self.contract.validator('Problem').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        return {k:v for k,v in response.json.items() if k!='request_id'}

    def test_visible_detail_has_exact_identity_actual_times_and_consistent_event_counts(self):
        data = self.detail()
        self.assertEqual(data['execution_id'],'42')
        self.assertEqual(data['created_at'],'2026-10-14T12:00:00.7654321Z')
        self.assertEqual(data['started_at'],'2026-10-15T11:59:30.1234567Z')
        self.assertIsNone(data['ended_at'])
        self.assertIsNone(data['duration_seconds'])
        self.assertEqual(data['elapsed_seconds'],30)
        self.assertEqual(data['event_counts'],COUNTS)
        self.assertEqual([call.args[0] for call in self.query.call_args_list],
                         ['api-execution.sql','api-execution-event-counts.sql'])
        for call in self.query.call_args_list:
            self.assertEqual(call.args[1],(42,))
            self.assertTrue(call.kwargs['one_row'])
            self.assertTrue(call.kwargs['typed_timestamps'])
        self.connect.assert_not_called()

    def test_detail_is_independent_of_fixed_overview_range_and_window_configuration(self):
        app = create_app({'TESTING':True,'LOG_LEVEL':'ERROR','AS_OF_DATE':'2000-01-01T00:00:00Z','HOUR_SPAN':1})
        response = app.test_client().get('/api/v1/executions/42')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['data']['elapsed_seconds'],30)
        self.assertEqual([call.args[1] for call in self.query.call_args_list],[(42,),(42,)])

    def test_bigint_precision_wide_names_and_nullable_metadata_remain_typed(self):
        for identifier in (9007199254740993,9223372036854775807):
            self.row.update(execution_id=identifier,folder_name='😀'*64,project_name="O'Brien %_[/+#",
                package_name='P'*260,project_lsn=None,environment_name='東京',environment_folder_name='x'*128,
                status=2147483647,logging_level=-2147483648)
            data = self.detail(str(identifier))
            self.assertEqual(data['execution_id'],str(identifier))
            self.assertEqual(data['folder_name'],'😀'*64)
            self.assertEqual(data['status'],{'code':2147483647,'name':'unknown'})
            self.assertEqual(data['logging_level'],{'code':-2147483648,'name':'unknown'})
            self.assertIsNone(data['project_lsn'])
            self.assertEqual(self.query.call_args.args[1],(identifier,))

    def test_pending_no_start_and_missing_system_logging_are_not_fabricated(self):
        self.row.update(status=5,started_at=None,ended_at=None,logging_level=None,logging_rows=0,project_lsn=0)
        data = self.detail()
        self.assertIsNone(data['elapsed_seconds'])
        self.assertIsNone(data['duration_seconds'])
        self.assertIsNone(data['logging_level'])
        self.assertEqual(data['project_lsn'],'0')
        self.assertEqual(data['status']['name'],'pending')

    def test_completed_duration_keeps_the_seventh_digit_and_elapsed_does_not_use_overview_as_of(self):
        self.row.update(started_at=parse_timestamp('2026-10-15T11:59:30.1234567Z'),
                        ended_at=parse_timestamp('2026-10-15T11:59:30.1234568Z'),status=7)
        data = self.detail()
        self.assertEqual(data['duration_seconds'],0.0000001)
        self.assertEqual(data['elapsed_seconds'],0.0000001)
        self.assertEqual(data['ended_at'],'2026-10-15T11:59:30.1234568Z')
        self.row.update(started_at=parse_timestamp('2026-10-16T00:00:00Z'),ended_at=None,status=2)
        self.assertEqual(self.detail()['elapsed_seconds'],0)

    def test_absent_and_hidden_ids_have_identical_404_and_no_event_query(self):
        self.row = {}
        missing = self.problem('42')
        self.query.assert_called_once()
        self.assertEqual(self.query.call_args.args[0],'api-execution.sql')
        self.query.reset_mock()
        self.assertEqual(self.problem('43'),missing)
        self.query.assert_called_once()

    def test_retention_or_revoked_visibility_between_queries_returns_the_same_404(self):
        self.counts = {}
        revoked = self.problem('42')
        self.assertEqual(self.query.call_count,2)
        self.row = {}
        self.assertEqual(self.problem('42'),revoked)

    def test_zero_recorded_events_and_disabled_text_value_capabilities_still_return_detail(self):
        self.counts = dict.fromkeys(COUNTS,0)
        self.row.update(warning_count=999,error_count=999)
        self.assertFalse(self.app.config['API_EVENTS_ENABLED'])
        self.assertFalse(self.app.config['API_VALUES_ENABLED'])
        data = self.detail()
        self.assertEqual(data['event_counts'],self.counts)
        self.assertEqual(data['warning_count'],0)
        self.assertEqual(data['error_count'],0)

    def test_invalid_path_ids_fail_before_any_query(self):
        for identifier in ('0','-1','+1','01','1.0','1e3',' 1','١','9223372036854775808','all',"1' OR 1=1",'\0'):
            with self.subTest(identifier=identifier):
                self.problem(identifier,400)
        self.query.assert_not_called()

    def test_query_selectors_bodies_and_methods_keep_the_shared_guards(self):
        for key in ('from','to','folder','project','status','limit','cursor','kind','q'):
            self.assertEqual(self.get(query_string={key:'invalid'}).status_code,400)
        self.assertEqual(self.get(data='private-canary').status_code,400)
        self.assertEqual(self.client.post('/api/v1/executions/42').status_code,405)
        self.assertEqual(self.client.open('/api/v1/executions/42',method='OPTIONS').status_code,200)
        self.query.assert_not_called()
        response = self.client.head('/api/v1/executions/42')
        self.assertEqual((response.status_code,response.data),(200,b''))
        self.assertEqual(self.query.call_count,2)

    def test_inconsistent_or_malformed_execution_rows_fail_before_events(self):
        original = dict(self.row)
        for changes in ({'execution_id':43},{'execution_id':True},{'logging_rows':2},{'logging_rows':True},
                        {'logging_rows':0},{'folder_name':''},{'package_name':'P'*261},{'created_at':None}):
            with self.subTest(changes=changes):
                self.query.reset_mock()
                self.row = {**original,**changes}
                with self.assertLogs(self.app.logger,level='ERROR'):
                    self.problem('42',500)
                self.query.assert_called_once()

    def test_unsafe_counts_and_impossible_category_relationships_are_safe_errors(self):
        invalid = [{**COUNTS,key:value} for key,value in (('all',True),('all',2**53),('errors',-1),('warnings',1.0),
                   ('memory_warnings',None),('duplicate_warnings',3),('all',3))]
        for counts in invalid:
            with self.subTest(counts=counts):
                self.counts = counts
                with self.assertLogs(self.app.logger,level='ERROR'):
                    self.problem('42',500)
        self.counts = {'all':2**53-1,'errors':0,'warnings':0,'duplicate_warnings':0,'memory_warnings':0}
        self.assertEqual(self.detail()['event_counts']['all'],2**53-1)

    def test_bound_odbc_queries_register_converters_and_close_both_connections(self):
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        connections,cursors = [],[]
        for record in (self.row,self.counts):
            cursor = Mock()
            cursor.description = [(key,) for key in record]
            cursor.fetchone.return_value = tuple(record.values())
            connections.append(ConnectionFixture(cursor,[]))
            cursors.append(cursor)
        self.connect.side_effect = connections
        self.detail()
        for connection,cursor in zip(connections,cursors):
            sql,parameters = cursor.execute.call_args.args
            self.assertEqual(parameters,(42,))
            self.assertEqual(sql.count('?'),1)
            self.assertIn('bigint = ?',sql)
            connection.add_output_converter.assert_called_once()
            connection.close.assert_called_once()
            cursor.close.assert_called_once()
        self.assertNotIn('event_messages',cursors[0].execute.call_args.args[0])
        self.assertNotIn('execution_parameter_values',cursors[1].execute.call_args.args[0])

    def test_inputs_extra_rows_and_diagnostics_do_not_leak_into_response_or_logs(self):
        self.row['message'] = 'private-message-canary'
        self.row['parameter_value'] = 'private-value-canary'
        self.counts['message'] = 'private-event-canary'
        with self.assertLogs(self.app.logger,level='INFO') as logs:
            data = self.detail()
        self.assertNotIn('private-',str(data)+'\n'.join(logs.output))
        for fail_resource,status,state in (('api-execution.sql',503,'08001'),('api-execution-event-counts.sql',504,'HYT00')):
            def failing(resource,*args,**kwargs):
                if resource==fail_resource:
                    raise pyodbc.OperationalError(state,'private-diagnostic-canary')
                return self.query_fixture(resource,*args,**kwargs)
            self.query.reset_mock()
            self.query.side_effect = failing
            with self.assertLogs(self.app.logger,level='ERROR') as logs:
                response = self.get()
            self.assertEqual(response.status_code,status)
            self.assertNotIn('private-',response.get_data(as_text=True)+'\n'.join(logs.output))
            self.assertEqual(self.query.call_count,1 if fail_resource=='api-execution.sql' else 2)
