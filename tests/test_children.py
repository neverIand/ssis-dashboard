"""Child invocation paging, conservative observations and SQL ownership contracts."""

import base64
from copy import deepcopy
from functools import cmp_to_key
import json
from unittest.mock import Mock, patch
import unittest
from urllib.parse import quote

import pyodbc
from werkzeug.exceptions import NotFound

from dashboard import create_app, cursors
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture
from tests.test_executions import execution


NOW = parse_timestamp('2026-10-16T12:00:00.1234567Z')


def observation(identifier=1, **changes):
    start = Timestamp(NOW.utc_ticks - 60*TICKS_PER_SECOND + identifier%5)
    return {'page_empty':0,'observation_id':identifier,'execution_id':42,
            'package_name':'Probe.dtsx','package_path':r'\Package','execution_path':r'\Probe\Task[1]',
            'source_name':'Task','started_at':start,'ended_at':Timestamp(start.utc_ticks+1),
            'source_type':30,**changes}


def ordered(rows, by_time, descending):
    def compare(a,b):
        for x,y in zip(([a['started_at']] if by_time else [])+[a['observation_id']],
                       ([b['started_at']] if by_time else [])+[b['observation_id']]):
            if x is None or y is None:
                result = (x is None)-(y is None)
            else:
                result = ((x>y)-(x<y))*(-1 if descending else 1)
            if result:
                return result
        return 0
    return sorted(rows,key=cmp_to_key(compare)), compare


class ChildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect',side_effect=AssertionError('Unexpected SQL')))
        self.clock = self.enterContext(patch('dashboard.children.utc_now',return_value=NOW))
        self.visible = self.enterContext(patch('dashboard.children.visible_execution',return_value={
            'logging_level':{'code':1,'name':'basic'}}))
        self.query = self.enterContext(patch('dashboard.children.execute_query',side_effect=self.query_fixture))
        self.app = create_app({'TESTING':True,'LOG_LEVEL':'ERROR','EXECUTION_COUNT':1,
                               'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()
        self.rows = [observation(i,ended_at=None if i%7==0 else observation(i)['ended_at']) for i in range(1,252)]
        self.unidentified = False
        self.rows.append(observation(3000,execution_id=43))

    def query_fixture(self,resource,parameters,**settings):
        identifier = parameters[0]
        source = [r for r in self.rows if r['execution_id']==identifier]
        if resource=='api-children-fence.sql':
            return {'upper_id':max((r['observation_id'] for r in source),default=None),'has_unidentified_starts':self.unidentified}
        _,take,upper,last,last_time,by_time,descending = parameters
        candidates,compare = ordered([r for r in source if r['observation_id']<=upper],by_time,descending)
        if last is not None:
            boundary = {'observation_id':last,'started_at':parse_timestamp(last_time) if last_time else None}
            candidates = [r for r in candidates if compare(r,boundary)>0]
        return [{**r,'has_unidentified_starts':self.unidentified} for r in deepcopy(candidates[:take])] or [{'execution_id':identifier,'observation_id':None,'page_empty':1,'has_unidentified_starts':self.unidentified}]

    def get(self,values=None,identifier='42',**kwargs):
        return self.client.get('/api/v1/executions/'+quote(identifier,safe='')+'/children',query_string=values or {},**kwargs)

    def page(self,values=None,identifier='42'):
        response = self.get(values,identifier)
        self.assertEqual(response.status_code,200,response.json)
        self.contract.validator('ChildrenResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.headers['X-Request-ID'],response.json['meta']['request_id'])
        self.assertIsNone(response.json['meta']['from'])
        self.assertIsNone(response.json['meta']['to'])
        return response.json

    def payload(self,page):
        return json.loads(base64.urlsafe_b64decode(page['meta']['next_cursor'].split('.')[0]+'=='))

    def invalid_cursor(self,values,identifier='42'):
        before = self.query.call_count,self.visible.call_count
        response = self.get(values,identifier)
        self.assertEqual(response.status_code,400,response.json)
        self.assertIn(response.json['code'],('invalid_cursor','cursor_expired'))
        self.assertEqual((self.query.call_count,self.visible.call_count),before)

    def test_default_page_is_bounded_and_independent_of_overview_and_capabilities(self):
        self.app.config.update(AS_OF_DATE='2000-01-01T00:00:00Z',HOUR_SPAN=1)
        page = self.page()
        self.assertEqual((len(page['data']),page['meta']['upper_id'],page['meta']['sort'],page['meta']['direction']),
                         (50,'251','started_at','asc'))
        self.assertEqual(page['meta']['availability'],'available')
        self.assertEqual(page['meta']['as_of'],NOW.isoformat())
        self.assertEqual(self.query.call_args.args[1],(42,51,251,None,None,1,0))
        self.assertEqual(self.query.call_count,2)
        self.visible.assert_called_once_with('42',self.app.config,as_of=NOW)
        self.assertFalse(self.app.config['API_EVENTS_ENABLED'])
        self.assertFalse(self.app.config['API_VALUES_ENABLED'])
        self.connect.assert_not_called()

    def test_global_orders_both_directions_exact_ties_and_200_limit(self):
        for sort in ('started_at','observation_id'):
            for direction in ('asc','desc'):
                with self.subTest(sort=sort,direction=direction):
                    values = {'sort':sort,'direction':direction,'limit':'200'}
                    first = current = self.page(values)
                    rows = list(current['data'])
                    while current['meta']['has_more']:
                        current = self.page({**values,'cursor':current['meta']['next_cursor']})
                        self.assertEqual(current['meta']['as_of'],first['meta']['as_of'])
                        rows += current['data']
                    expected,_ = ordered(self.rows[:-1],sort=='started_at',direction=='desc')
                    self.assertEqual([r['observation_id'] for r in rows],[str(r['observation_id']) for r in expected])
                    self.assertEqual((len(first['data']),len(current['data'])),(200,51))
                    self.assertEqual(self.query.call_args.args[1][1],201)

    def test_incomplete_states_nullable_source_and_exact_duration(self):
        self.rows = [observation(),observation(2,package_name=None,source_name=None,source_type=None,ended_at=None)]
        rows = self.page()['data']
        by_id = {r['observation_id']:r for r in rows}
        self.assertEqual((by_id['1']['state'],by_id['1']['duration_seconds']),('complete',0.0000001))
        self.assertEqual(by_id['2']['state'],'incomplete')
        self.assertTrue(all(by_id['2'][k] is None for k in ('package_name','source_name','source_type','ended_at','duration_seconds')))
        self.assertTrue(all(r['execution_id']=='42' for r in rows))

    def test_wide_unicode_paths_names_and_bigint_ids_remain_exact(self):
        identifier = 9223372036854775807
        path = '\\P\\'+'😀'*16380
        self.rows = [observation(identifier,execution_id=9007199254740993,package_name='😀'*130,
                                 execution_path=path,source_name='😀'*2000,source_type=-32768)]
        row = self.page(identifier='9007199254740993')['data'][0]
        self.assertEqual(row['observation_id'],str(identifier))
        self.assertEqual(row['execution_path'],path)
        self.assertEqual(row['execution_id'],'9007199254740993')
        self.assertEqual(row['source_type'],-32768)

    def test_empty_availability_requires_positive_logging_evidence(self):
        self.rows = []
        for logging,availability in ((None,'unknown'),({'code':0,'name':'none'},'not-recorded'),
                                     ({'code':1,'name':'basic'},'unknown'),({'code':32767,'name':'unknown'},'unknown')):
            self.visible.return_value = {'logging_level':logging}
            self.query.reset_mock()
            page = self.page()
            self.assertEqual((page['data'],page['meta']['upper_id'],page['meta']['has_more']),( [],None,False))
            self.assertEqual(page['meta']['availability'],availability)
            self.query.assert_called_once()
        self.rows = [observation()]
        self.visible.return_value = {'logging_level':{'code':0,'name':'none'}}
        self.assertEqual(self.page()['meta']['availability'],'available')

    def test_visibility_and_revocation_short_circuit_without_leaking_existence(self):
        self.visible.side_effect = NotFound()
        first = self.get()
        self.assertEqual(first.status_code,404)
        self.query.assert_not_called()
        self.visible.side_effect = None
        self.query.side_effect = lambda *a,**kw:{}
        second = self.get()
        self.assertEqual(second.status_code,404)
        self.assertEqual({k:v for k,v in first.json.items() if k!='request_id'},
                         {k:v for k,v in second.json.items() if k!='request_id'})
        self.query.side_effect = lambda resource,*a,**kw:({'upper_id':1,'has_unidentified_starts':False} if resource.endswith('fence.sql') else [])
        self.assertEqual(self.get().status_code,404)

    def test_continuation_fixes_fence_and_survives_last_row_retention(self):
        values = {'sort':'observation_id','limit':'2'}
        first = self.page(values)
        self.rows = [r for r in self.rows if r['observation_id']!=2]+[observation(900)]
        self.query.reset_mock()
        second = self.page({**values,'cursor':first['meta']['next_cursor']})
        self.assertEqual([r['observation_id'] for r in second['data']],['3','4'])
        self.assertEqual(second['meta']['upper_id'],'251')
        self.query.assert_called_once()
        self.rows = []
        empty = self.page({**values,'cursor':second['meta']['next_cursor']})
        self.assertEqual(empty['data'],[])
        self.assertFalse(empty['meta']['has_more'])
        self.assertEqual(empty['meta']['availability'],'unknown')

    def test_cursor_binds_target_order_limit_policy_and_resource_without_sql(self):
        token = self.page({'limit':'1'})['meta']['next_cursor']
        for change in ({'limit':'2'},{'sort':'observation_id'},{'direction':'desc'}):
            self.invalid_cursor({'limit':'1','cursor':token,**change})
        self.invalid_cursor({'limit':'1','cursor':token},identifier='43')
        self.app.config['API_VALUES_ENABLED'] = True
        self.invalid_cursor({'limit':'1','cursor':token})
        self.app.config['API_VALUES_ENABLED'] = False
        payload = self.payload(self.page({'limit':'1'}))
        for resource in ('v1/executions','v1/folders','v1/executables'):
            self.invalid_cursor({'limit':'1','cursor':cursors.seal({**payload,'resource':resource})})

    def test_cursor_tampering_expiry_and_restart_fail_without_sql(self):
        token = self.page({'limit':'1'})['meta']['next_cursor']
        self.invalid_cursor({'limit':'1','cursor':token[:-1]+('A' if token[-1]!='A' else 'B')})
        with patch('dashboard.cursors._KEY',b'another-server-owned-secret'):
            self.invalid_cursor({'limit':'1','cursor':token})
        self.clock.return_value = Timestamp(NOW.utc_ticks+1800*TICKS_PER_SECOND)
        self.invalid_cursor({'limit':'1','cursor':token})

    def test_authenticated_malformed_keys_and_fences_fail_before_visibility(self):
        for sort in ('started_at','observation_id'):
            page = self.page({'sort':sort,'limit':'1'})
            payload = self.payload(page)
            for changes in ({'upper_id':'0'},{'last_id':'9223372036854775807'},{'sort_key':[]},
                            {'sort_nulls':[0]},{'sort_nulls':[True]},{'sort_key':[True]},
                            {'sort_key':['nonsense']},{'sort_key':[None],'sort_nulls':[False]}):
                self.invalid_cursor({'sort':sort,'limit':'1','cursor':cursors.seal({**payload,**changes})})

    def test_invalid_ids_inputs_methods_and_bodies_do_no_catalog_work(self):
        for identifier in ('0','01','-1','+1','1.0','1e3',' 1','١','9223372036854775808',"1' OR 1=1"):
            self.assertEqual(self.get(identifier=identifier).status_code,400)
        for values in ({'limit':'201'},{'limit':'0'},{'limit':'-1'},{'limit':'1.5'},{'sort':'name'},
                       {'sort':'execution_id'},{'direction':'ASC'},{'from':'bad'},{'status':'2'},{'q':'private-canary'}):
            self.assertEqual(self.get(values).status_code,400)
        self.assertEqual(self.get(data='private-canary').status_code,400)
        path = '/api/v1/executions/42/children'
        self.assertEqual(self.client.post(path).status_code,405)
        self.assertEqual(self.client.open(path,method='OPTIONS').status_code,200)
        self.visible.assert_not_called()
        self.query.assert_not_called()
        response = self.client.head(path)
        self.assertEqual((response.status_code,response.data),(200,b''))

    def test_malformed_rows_markers_and_duplicates_are_safe_errors(self):
        self.query.side_effect = lambda resource,*a,**kw:({'upper_id':1,'has_unidentified_starts':False}
            if resource.endswith('fence.sql') else deepcopy(self.rows))
        for changes in ({'observation_id':True},{'execution_id':43},{'source_type':True},{'source_type':32768},
                        {'source_name':'x'*4001},{'source_name':'😀'*2001},{'package_name':''},
                        {'package_path':None},{'package_path':r'\Package\Task'},{'execution_path':None},
                        {'execution_path':'x'*16385},{'execution_path':r'\Root'},{'source_name':'\ud800'},
                        {'started_at':None},{'ended_at':Timestamp(NOW.utc_ticks-100*TICKS_PER_SECOND)},
                        {'page_empty':2},{'has_unidentified_starts':None}):
            with self.subTest(changes=list(changes)):
                self.rows = [observation(**{'has_unidentified_starts':False,**changes})]
                with self.assertLogs(self.app.logger,level='ERROR'):
                    self.assertEqual(self.get().status_code,500)
        self.rows = [observation(has_unidentified_starts=False),observation(has_unidentified_starts=False)]
        with self.assertLogs(self.app.logger,level='ERROR'):
            self.assertEqual(self.get().status_code,500)

    def test_unidentified_starts_are_explicit_and_never_labelled_not_recorded(self):
        self.unidentified = True
        for rows in ([],[observation()]):
            for level in (None,{'code':0,'name':'none'},{'code':1,'name':'basic'}):
                self.rows = rows
                self.visible.return_value = {'logging_level':level}
                page = self.page()
                self.assertTrue(page['meta']['has_unidentified_starts'])
                self.assertEqual(page['meta']['availability'],'unknown')
                self.assertEqual(len(page['data']),len(rows))

    def test_extra_private_fields_are_never_returned_or_logged(self):
        self.rows = [observation(execution_value='private-value-canary',message='private-message-canary',
                                 message_source_id='private-source-canary')]
        with self.assertLogs(self.app.logger,level='INFO') as logged:
            page = self.page()
        self.assertNotIn('private-',str(page)+'\n'.join(logged.output))

    def test_native_boundary_binds_typed_ids_and_time_and_closes_three_connections(self):
        from dashboard.db import execute_query
        from dashboard.inspection import visible_execution
        self.visible.side_effect = visible_execution
        self.query.side_effect = execute_query
        records = [execution(42,logging_rows=1),{'upper_id':1,'has_unidentified_starts':False},observation(has_unidentified_starts=False)]
        connections,cursors_used = [],[]
        for record in records:
            cursor = Mock()
            cursor.description = [(key,) for key in record]
            cursor.fetchone.return_value = tuple(record.values())
            cursor.fetchall.return_value = [tuple(record.values())]
            connections.append(ConnectionFixture(cursor,[]))
            cursors_used.append(cursor)
        self.connect.side_effect = connections
        self.page()
        for connection,cursor in zip(connections,cursors_used):
            sql,parameters = cursor.execute.call_args.args
            self.assertEqual(sql.count('?'),len(parameters))
            self.assertEqual(parameters[0],42)
            self.assertNotIn('execution_value',sql)
            connection.add_output_converter.assert_called_once()
            cursor.close.assert_called_once()
            connection.close.assert_called_once()

    def test_database_errors_keep_safe_status_and_short_circuit(self):
        for resource,state,status in (('api-children-fence.sql','08001',503),('api-children-page.sql','HYT00',504)):
            def fail(name,*args,**kwargs):
                if name==resource:
                    raise pyodbc.OperationalError(state,'private-diagnostic-canary')
                return self.query_fixture(name,*args,**kwargs)
            self.query.side_effect = fail
            with self.assertLogs(self.app.logger,level='ERROR') as logged:
                response = self.get()
            self.assertEqual(response.status_code,status)
            self.assertNotIn('private-',response.get_data(as_text=True)+'\n'.join(logged.output))
