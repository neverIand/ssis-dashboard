"""Global execution ordering and raw seek state, with native SQL tested separately."""

import base64
from functools import cmp_to_key
import json
import unittest
from unittest.mock import patch

from dashboard import create_app, cursors
from dashboard.execution_order import EXECUTION_SORTS, encode_key, seek_values
from dashboard.timestamps import Timestamp, as_timestamp, parse_timestamp
from tests import test_executions as pages, test_api_contract as contract_tests


def raw_key(row, sort):
    if sort == 'environment':
        return [row['environment_folder_name'], row['environment_name']]
    if sort == 'duration_seconds':
        start, end = row['started_at'], row['ended_at']
        return [None if start is None or end is None else as_timestamp(end).utc_ticks - as_timestamp(start).utc_ticks]
    return [row[sort]]


def compare(left, right, *, descending):
    for a, b in zip(left, right):
        if a is None or b is None:
            result = (a is None) - (b is None)
        else:
            result = ((a > b) - (a < b)) * (-1 if descending else 1)
        if result:
            return result
    return 0


class ExecutionSortingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.enterContext(patch('dashboard.executions.utc_now', return_value=pages.NOW))
        self.query = self.enterContext(patch('dashboard.executions.execute_query', side_effect=self.query_fixture))
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR'})
        self.client = self.app.test_client()
        start = parse_timestamp('2026-10-15T11:00:00.0000000Z')
        self.rows = []
        for identifier in range(1,9):
            index = identifier - 1
            row = pages.execution(identifier, project_name=['Z','A','B','A','A','B','A','A'][index],
                package_name=['Y','X','A','Z','A','B','A','A'][index], status=[7,2,7,-40000,5,2,7,7][index],
                logging_level=[1,None,2,2,1,100,1,1][index],
                started_at=None if identifier in (1,6) else Timestamp(start.utc_ticks + (1 if identifier in (4,5) else 0)),
                ended_at=None if identifier in (1,2,6) else Timestamp(start.utc_ticks + (3 if identifier==4 else 2 if identifier==5 else 1)),
                created_at=Timestamp(parse_timestamp('2026-10-14T00:00:00Z').utc_ticks+(9-identifier)%3),
                warning_count=index%3, error_count=2-index%3,
                environment_folder_name=[None,'b','a','a','a',None,None,None][index],
                environment_name=[None,'b','z','a',None,'x',None,None][index])
            self.rows.append(row)

    def query_fixture(self, resource, parameters, **settings):
        if resource=='api-executions-fence.sql':
            return {'upper_id':max((row['execution_id'] for row in self.rows),default=None)}
        take, upper, last, descending = parameters[15:19]
        sort = parameters[19] if resource=='api-executions-sort.sql' else 'execution_id'
        boundary = None
        if last is not None:
            if sort=='execution_id':
                boundary=[last,last]
            else:
                null1, number, stamp, text1, null2, text2=parameters[20:26]
                if sort in ('created_at','started_at','ended_at'):
                    key=[None if null1 else parse_timestamp(stamp)]
                elif sort in ('status','logging_level','duration_seconds','warning_count','error_count'):
                    key=[None if null1 else number]
                else:
                    key=[None if null1 else text1]
                    if sort=='environment': key.append(None if null2 else text2)
                boundary=[*key,last]
        def ordered_key(row): return [*raw_key(row,sort),row['execution_id']]
        candidates=[row for row in self.rows if row['execution_id']<=upper and (
            boundary is None or compare(ordered_key(row),boundary,descending=descending)>0)]
        candidates.sort(key=cmp_to_key(lambda a,b:compare(ordered_key(a),ordered_key(b),descending=descending)))
        result=[]
        for row in candidates[:take]:
            row=dict(row)
            if sort!='execution_id':
                key=raw_key(row,sort)
                row.update(sort_number=None,sort_time=None,sort_text1=None,sort_text2=None)
                if sort in ('created_at','started_at','ended_at'): row['sort_time']=key[0]
                elif sort in ('status','logging_level','duration_seconds','warning_count','error_count'): row['sort_number']=key[0]
                else:
                    row['sort_text1']=key[0]
                    if sort=='environment': row['sort_text2']=key[1]
            result.append(row)
        return result

    def get(self, values):
        return self.client.get('/api/v1/executions',query_string=values)

    def chain(self, sort, direction='asc', *, limit='2', first=None):
        values={**pages.WINDOW,'sort':sort,'direction':direction,'limit':limit}
        response=first or self.get(values)
        data=[]
        while True:
            self.assertEqual(response.status_code,200,response.json)
            self.contract.validator('ExecutionsResponse').validate(response.json)
            data.extend(response.json['data'])
            meta=response.json['meta']
            if not meta['has_more']: break
            values.update({'from':meta['from'],'to':meta['to'],'cursor':meta['next_cursor']})
            response=self.get(values)
            self.assertLess(len(data),100)
        return [int(row['execution_id']) for row in data]

    def token(self, response):
        return json.loads(base64.urlsafe_b64decode(response.json['meta']['next_cursor'].split('.')[0]+'=='))

    def test_all_sorts_cross_pages_and_ties_with_nulls_last_in_both_directions(self):
        expected={
            'execution_id':([1,2,3,4,5,6,7,8],[8,7,6,5,4,3,2,1]),
            'created_at':([3,6,2,5,8,1,4,7],[7,4,1,8,5,2,6,3]),
            'started_at':([2,3,7,8,4,5,1,6],[5,4,8,7,3,2,6,1]),
            'ended_at':([3,7,8,5,4,1,2,6],[4,5,8,7,3,6,2,1]),
            'project_name':([2,4,5,7,8,3,6,1],[1,6,3,8,7,5,4,2]),
            'package_name':([3,5,7,8,6,2,1,4],[4,1,2,6,8,7,5,3]),
            'environment':([4,3,5,2,6,1,7,8],[2,3,4,5,6,8,7,1]),
            'status':([4,2,6,5,1,3,7,8],[8,7,3,1,5,6,2,4]),
            'logging_level':([1,5,7,8,3,4,6,2],[6,4,3,8,7,5,1,2]),
            'duration_seconds':([3,5,7,8,4,1,2,6],[4,8,7,5,3,6,2,1]),
            'warning_count':([1,4,7,2,5,8,3,6],[6,3,8,5,2,7,4,1]),
            'error_count':([3,6,2,5,8,1,4,7],[7,4,1,8,5,2,6,3]),
        }
        self.assertEqual(set(expected),set(EXECUTION_SORTS))
        for sort, orders in expected.items():
            for direction, order in zip(('asc','desc'),orders):
                with self.subTest(sort=sort,direction=direction):
                    self.assertEqual(self.chain(sort,direction),order)
                    page_call=self.query.call_args
                    self.assertEqual(page_call.args[0], 'api-executions-page.sql' if sort=='execution_id' else 'api-executions-sort.sql')
                    self.assertEqual(page_call.args[1][15],3)
                    self.assertTrue(page_call.kwargs['typed_timestamps'])
        self.connect.assert_not_called()

    def test_cursor_uses_exact_time_and_duration_keys_beyond_json_precision(self):
        response=self.get({**pages.WINDOW,'sort':'started_at','limit':'1','direction':'asc'})
        state=self.token(response)
        self.assertEqual(state['v'],2)
        self.assertEqual(state['sort_key'],['2026-10-15T11:00:00.0000000Z'])
        self.assertEqual(state['sort_nulls'],[False])
        self.assertEqual(seek_values(state,'started_at')[2],'2026-10-15T11:00:00.0000000+00:00')
        end=parse_timestamp('9000-01-01T00:00:00Z')
        start=parse_timestamp('0001-01-01T00:00:00Z')
        self.rows=[pages.execution(1,started_at=start,ended_at=Timestamp(end.utc_ticks+1)),
                   pages.execution(2,started_at=start,ended_at=end)]
        response=self.get({**pages.WINDOW,'sort':'duration_seconds','direction':'asc','limit':'1'})
        state=self.token(response)
        self.assertEqual(response.json['data'][0]['execution_id'],'2')
        self.assertEqual(state['sort_key'],[str(end.utc_ticks)])
        self.assertGreater(int(state['sort_key'][0]),2**53)
        self.assertEqual(self.chain('duration_seconds',limit='1',first=response),[2,1])

    def test_null_cursor_can_continue_inside_terminal_null_group(self):
        for sort in ('started_at','ended_at','duration_seconds','logging_level','environment'):
            with self.subTest(sort=sort):
                self.assertEqual(len(self.chain(sort,limit='1')),8)
                self.assertEqual(len(self.chain(sort,'desc',limit='1')),8)

    def test_malformed_authenticated_sort_state_is_rejected_before_sql(self):
        response=self.get({**pages.WINDOW,'sort':'status','direction':'asc','limit':'1'})
        state=self.token(response)
        values={**pages.WINDOW,'sort':'status','direction':'asc','limit':'1'}
        cases=[{'sort_key':['1.0']},{'sort_key':[True]},{'sort_key':['2147483648']},
               {'sort_key':['-2147483649']},{'sort_key':['01']},{'sort_key':['-0']},
               {'sort_key':['١']},{'sort_key':[None],'sort_nulls':[True]}, {'sort_key':[]},
               {'sort_nulls':[1]},{'sort_nulls':[True]},{'sort_nulls':[False,False]},{'v':1}]
        for changes in cases:
            with self.subTest(changes=changes):
                count=self.query.call_count
                invalid=cursors.seal({**state,**changes})
                response=self.get({**values,'cursor':invalid})
                self.assertEqual(response.status_code,400,response.json)
                self.assertEqual(response.json['code'],'invalid_cursor')
                self.assertEqual(self.query.call_count,count)
        for sort, key, nulls in [('environment',['a'*129,'b'],[False,False]),
                                  ('package_name',['😀'*131],[False]),
                                  ('created_at',['2026-10-15T00:00:00.12345678Z'],[False]),
                                  ('warning_count',[str(2**53)],[False]), ('duration_seconds',['-1'],[False])]:
            with self.subTest(sort=sort), self.assertRaises(cursors.InvalidCursor):
                seek_values({'sort_key':key,'sort_nulls':nulls},sort)

    def test_sort_and_direction_changes_cannot_reuse_a_cursor(self):
        response=self.get({**pages.WINDOW,'sort':'status','direction':'asc','limit':'1'})
        token=response.json['meta']['next_cursor']
        for changes in ({'sort':'logging_level'},{'sort':'execution_id'},{'direction':'desc'}):
            count=self.query.call_count
            response=self.get({**pages.WINDOW,'sort':'status','direction':'asc','limit':'1','cursor':token,**changes})
            self.assertEqual(response.status_code,400)
            self.assertEqual(self.query.call_count,count)

    def test_original_raw_boundary_survives_retention_and_upper_fence_excludes_inserts(self):
        first=self.get({**pages.WINDOW,'sort':'project_name','direction':'asc','limit':'2'})
        self.rows=[r for r in self.rows if r['execution_id']!=4]
        self.rows.append(pages.execution(9,project_name='X'))
        ids=self.chain('project_name',first=first)
        self.assertEqual(ids,[2,4,5,7,8,3,6,1])
        self.assertNotIn(9,ids)
        refreshed=self.chain('project_name')
        self.assertEqual(refreshed,[2,5,7,8,3,6,9,1])

    def test_live_metric_change_can_repeat_a_row_and_refresh_starts_a_new_chain(self):
        first=self.get({**pages.WINDOW,'sort':'warning_count','direction':'asc','limit':'2'})
        self.rows[0]['warning_count']=9
        self.assertEqual(self.chain('warning_count',first=first).count(1),2)
        self.assertEqual(self.chain('warning_count').count(1),1)
        self.assertEqual(first.json['meta']['consistency'],'live')

    def test_wide_unicode_environment_key_is_bounded_and_raw_names_are_not_logged(self):
        for row in self.rows:
            row.update(environment_folder_name='😀'*64,environment_name='x'*128)
        with self.assertLogs(self.app.logger,level='INFO') as logs:
            first=self.get({**pages.WINDOW,'sort':'environment','direction':'asc','limit':'1'})
            self.assertEqual(first.status_code,200)
            state=self.token(first)
            self.assertEqual(state['sort_key'],['😀'*64,'x'*128])
            self.assertLess(len(first.json['meta']['next_cursor']),8192)
        self.assertNotIn('x'*128,'\n'.join(logs.output))
        self.assertNotIn(first.json['meta']['next_cursor'],'\n'.join(logs.output))
