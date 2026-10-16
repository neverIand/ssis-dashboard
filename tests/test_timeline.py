"""Calendar, HTTP and typed timeline contracts; native SQL work is separate."""

import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import Mock, patch
import unittest
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

import pyodbc

from dashboard import create_app
from dashboard.timeline import bucket_bounds, _datetime
from dashboard.timestamps import parse_timestamp, TICKS_PER_SECOND
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture


PATH = '/api/v1/metrics/timeline'
NOW = parse_timestamp('2026-10-16T12:00:00.1234567Z')
WINDOW = {'from':'2026-10-14T12:34:00.0000001Z','to':'2026-10-14T13:45:00.0000002Z'}


def bounds(start, end, bucket='hour', zone='Europe/London', limit=1000):
    return bucket_bounds(parse_timestamp(start),parse_timestamp(end),timezone_name=zone,bucket=bucket,limit=limit)


class TimelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect',side_effect=AssertionError('Unexpected SQL')))
        self.enterContext(patch('dashboard.timeline.utc_now',return_value=NOW))
        self.query = self.enterContext(patch('dashboard.timeline.execute_query',side_effect=self.zero_rows))
        self.app = create_app({'TESTING':True,'LOG_LEVEL':'ERROR',
                               'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()

    def zero_rows(self, resource, parameters, **settings):
        return [{'bucket_id':int(b.get('i')), 'created_count':0,'started_count':0,'succeeded_count':0,'failed_count':0}
                for b in ET.fromstring(parameters[0])]

    def page(self, **values):
        response = self.client.get(PATH,query_string=values)
        self.assertEqual(response.status_code,200,response.json)
        self.contract.validator('TimelineResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(response.headers['X-Request-ID'],response.json['meta']['request_id'])
        rows = response.json['data']
        self.assertTrue(rows)
        self.assertLessEqual(len(rows),self.app.config['API_MAX_TIMELINE_BUCKETS'])
        self.assertTrue(all(left['end']==right['start'] for left,right in zip(rows,rows[1:])))
        return response.json

    def test_default_days_zero_fill_the_entire_requested_window(self):
        result = self.page()
        self.assertEqual(result['meta']['bucket'],'day')
        self.assertEqual(result['meta']['timezone'],'Europe/London')
        self.assertEqual(result['meta']['selected_statuses'],[])
        self.assertEqual(result['meta']['from'],'2026-10-01T12:00:00.1234567Z')
        self.assertEqual(result['meta']['to'],NOW.isoformat())
        self.assertEqual(len(result['data']),16)
        self.assertEqual(result['data'][0]['start'],'2026-09-30T23:00:00.0000000Z')
        self.assertTrue(all(row['created_count']==0 for row in result['data']))
        self.query.assert_called_once()
        self.connect.assert_not_called()

    def test_london_spring_day_has_23_distinct_hours(self):
        result = self.page(**{'from':'2026-03-29T00:00:00Z','to':'2026-03-29T23:00:00Z','bucket':'hour'})
        self.assertEqual(len(result['data']),23)
        local_hours = [_datetime(parse_timestamp(row['start'])).astimezone(ZoneInfo('Europe/London')).hour for row in result['data']]
        self.assertNotIn(1,local_hours)
        self.assertEqual(result['data'][-1]['end'],'2026-03-29T23:00:00.0000000Z')

    def test_london_autumn_repeated_hour_has_separate_utc_bounds(self):
        result = self.page(**{'from':'2026-10-24T23:00:00Z','to':'2026-10-26T00:00:00Z','bucket':'hour'})
        self.assertEqual(len(result['data']),25)
        repeated = [row for row in result['data'] if row['start'] in ('2026-10-25T00:00:00.0000000Z','2026-10-25T01:00:00.0000000Z')]
        self.assertEqual(len(repeated),2)
        local = [_datetime(parse_timestamp(row['start'])).astimezone(ZoneInfo('Europe/London')) for row in repeated]
        self.assertEqual([(t.hour,t.fold) for t in local],[(1,0),(1,1)])

    def test_calendar_days_preserve_23_and_25_hour_lengths(self):
        for start,end,expected in (('2026-03-28T00:00:00Z','2026-03-30T23:00:00Z',[24,23,24]),
                                   ('2026-10-23T23:00:00Z','2026-10-27T00:00:00Z',[24,25,24])):
            with self.subTest(start=start):
                intervals = bounds(start,end,'day')
                self.assertEqual([(b.utc_ticks-a.utc_ticks)//(3600*TICKS_PER_SECOND) for a,b in intervals],expected)

    def test_partial_edge_buckets_keep_precise_effective_bounds_for_sql(self):
        result = self.page(**WINDOW,bucket='hour')
        self.assertEqual(len(result['data']),2)
        self.assertEqual(result['data'][0]['start'],'2026-10-14T12:00:00.0000000Z')
        self.assertEqual(result['data'][-1]['end'],'2026-10-14T14:00:00.0000000Z')
        self.assertEqual({k:result['meta'][k] for k in WINDOW},WINDOW)
        self.assertEqual(self.query.call_args.args[1][1:3],
                         ('2026-10-14T12:34:00.0000001+00:00','2026-10-14T13:45:00.0000002+00:00'))
        one = self.page(**{'from':'2026-10-14T12:59:59.9999999Z','to':'2026-10-14T13:00:00Z','bucket':'hour'})
        self.assertEqual(len(one['data']),1)

    def test_counts_are_observations_grouped_by_creation_not_start_or_end(self):
        def counts(*args, **kwargs):
            rows = self.zero_rows(*args,**kwargs)
            rows[0].update(created_count=3,started_count=1,succeeded_count=1,failed_count=1)
            return rows
        self.query.side_effect = counts
        result = self.page(**WINDOW,bucket='hour',status='7,4,5')
        self.assertEqual(result['meta']['selected_statuses'],[4,5,7])
        self.assertEqual(result['data'][0]['created_count'],3)
        self.assertEqual(result['data'][1]['created_count'],0)
        self.assertEqual(self.query.call_args.args[1][-9:],(4,5,7,None,None,None,None,None,None))

    def test_summary_effective_bounds_and_exact_pattern_names_are_shared(self):
        for selectors in ({'folder':"O'Brien/+#\\東京",'project':'😀'*64},
                          {'folder_pattern':r'A*\*%_[','project_pattern':'P*'}):
            with self.subTest(selectors=selectors):
                with patch('dashboard.metrics.utc_now',return_value=NOW), patch('dashboard.metrics.execute_query',return_value=[]) as summary_query:
                    response = self.client.get('/api/v1/metrics/summary',query_string={**selectors,'status':'7'})
                self.assertEqual(response.status_code,200)
                effective = {k:response.json['meta'][k] for k in ('from','to')}
                result = self.page(**selectors,**effective,status='7')
                self.assertEqual(self.query.call_args.args[1][1:7],summary_query.call_args.args[1])
                self.assertEqual(result['meta']['selected_statuses'],[7])

    def test_fixed_as_of_and_default_elapsed_range_survive_dst(self):
        app = create_app({'TESTING':True,'LOG_LEVEL':'ERROR','AS_OF_DATE':'2026-03-30T00:00:00+01:00','HOUR_SPAN':24})
        response = app.test_client().get(PATH)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['meta']['from'],'2026-03-28T23:00:00.0000000Z')
        self.assertEqual(response.json['meta']['to'],'2026-03-29T23:00:00.0000000Z')
        self.assertEqual(len(response.json['data']),2)

    def test_bucket_caps_count_partial_edges_and_reject_before_sql(self):
        self.app.config['API_MAX_TIMELINE_BUCKETS'] = 1
        response = self.client.get(PATH,query_string={**WINDOW,'bucket':'hour'})
        self.assertEqual(response.status_code,400)
        self.query.assert_not_called()
        self.app.config['API_MAX_RANGE_HOURS'] = 2000
        self.app.config['API_MAX_TIMELINE_BUCKETS'] = 1000
        result = self.page(**{'from':'2026-01-01T00:00:00Z','to':'2026-02-11T16:00:00Z','bucket':'hour'})
        self.assertEqual(len(result['data']),1000)
        before = self.query.call_count
        response = self.client.get(PATH,query_string={'from':'2026-01-01T00:00:00Z','to':'2026-02-11T16:00:00.0000001Z','bucket':'hour'})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.query.call_count,before)

    def test_invalid_selectors_http_encoding_and_page_inputs_short_circuit(self):
        for values in ({'bucket':'week'},{'bucket':'DAY'},{'status':'0'},{'folder':'x'*129},
                       {'folder':'Exact','folder_pattern':'*'},{'limit':'1'},{'cursor':'token'},{'sort':'created_at'},
                       {'from':'2026-10-14'},{'from':'2026-01-02T00:00:00Z','to':'2026-01-01T00:00:00Z'}):
            with self.subTest(values=values):
                self.assertEqual(self.client.get(PATH,query_string=values).status_code,400)
        for suffix in ('?bucket=day&bucket=hour','?folder=%GG','?folder=%FF','?bucket=','?folder=%00'):
            self.assertEqual(self.client.get(PATH+suffix).status_code,400)
        self.query.assert_not_called()

    def test_half_hour_transitions_and_quarter_hour_zones_are_contiguous(self):
        for start,end,count in (('2026-04-04T13:00:00Z','2026-04-05T13:30:00Z',25),
                                ('2026-10-03T13:30:00Z','2026-10-04T13:00:00Z',24)):
            intervals = bounds(start,end,zone='Australia/Lord_Howe')
            self.assertEqual(len(intervals),count)
            seconds = [(b.utc_ticks-a.utc_ticks)//TICKS_PER_SECOND for a,b in intervals]
            self.assertEqual(seconds.count(1800),1)
            self.assertTrue(all(n in (1800,3600) for n in seconds))
            self.assertTrue(all(a[1]==b[0] for a,b in zip(intervals,intervals[1:])))
        intervals = bounds('2026-10-14T00:00:00Z','2026-10-14T01:00:00Z',zone='Asia/Kathmandu')
        self.assertEqual(len(intervals),2)
        self.assertEqual(intervals[0][0].isoformat(),'2026-10-13T23:15:00.0000000Z')

    def test_midnight_gaps_repeated_midnights_and_skipped_dates_use_real_day_starts(self):
        cases = (('America/Sao_Paulo','2018-11-04T03:00:00Z','2018-11-05T02:00:00Z',1,23),
                 ('America/Havana','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z',1,25),
                 ('Pacific/Apia','2011-12-29T10:00:00Z','2011-12-31T10:00:00Z',2,48))
        for zone,start,end,count,hours in cases:
            with self.subTest(zone=zone):
                intervals = bounds(start,end,'day',zone)
                self.assertEqual(len(intervals),count)
                self.assertEqual(intervals[0][0],parse_timestamp(start))
                self.assertEqual(intervals[-1][1],parse_timestamp(end))
                self.assertEqual(sum(b.utc_ticks-a.utc_ticks for a,b in intervals),hours*3600*TICKS_PER_SECOND)

    def test_calendar_extremes_and_excessively_long_configured_ranges_are_safe(self):
        intervals = bounds('0001-01-01T00:00:00Z','0001-01-02T00:00:00Z','day','UTC')
        self.assertEqual(len(intervals),1)
        self.app.config.update(DISPLAY_TIMEZONE='UTC',API_MAX_RANGE_HOURS=100000000)
        for values in ({'from':'9999-12-31T00:00:00Z','to':'9999-12-31T23:59:59Z'},
                       {'from':'1900-01-01T00:00:00Z','to':'2026-01-01T00:00:00Z'}):
            self.assertEqual(self.client.get(PATH,query_string=values).status_code,400)
        self.query.assert_not_called()

    def test_unexpected_rows_counts_and_bucket_identities_are_safe_errors(self):
        zero = self.zero_rows('unused',('<buckets><b i="0" /></buckets>',))[0]
        bad = [[],[zero,zero],[{**zero,'bucket_id':True}],[{**zero,'bucket_id':1}],
               [{**zero,'created_count':-1}],[{**zero,'created_count':2**53}],
               [{**zero,'started_count':True}],[{**zero,'failed_count':1}],
               [{**zero,'started_count':1}],[{**zero,'created_count':1,'succeeded_count':1,'failed_count':1}]]
        self.query.side_effect = None
        for rows in bad:
            with self.subTest(rows=rows):
                self.query.return_value = rows
                with self.assertLogs(self.app.logger,level='ERROR'):
                    response = self.client.get(PATH,query_string={'from':'2026-10-14T12:00:00Z','to':'2026-10-14T13:00:00Z','bucket':'hour'})
                self.assertEqual(response.status_code,500)
                self.contract.validator('Problem').validate(response.json)

    def test_native_query_boundary_binds_intervals_and_owns_typed_cleanup(self):
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        cursor = Mock()
        cursor.description = [('bucket_id',),('created_count',),('started_count',),('succeeded_count',),('failed_count',)]
        cursor.fetchall.return_value = [(0,2,1,1,0),(1,0,0,0,0)]
        connection = ConnectionFixture(cursor,[])
        self.connect.side_effect = [connection]
        result = self.page(**WINDOW,bucket='hour',folder="x' OR 1=1 --",status='7,5')
        self.assertEqual(result['data'][0]['created_count'],2)
        sql,parameters = cursor.execute.call_args.args
        self.assertEqual(sql.count('?'),16)
        self.assertEqual(len(parameters),16)
        self.assertEqual(len(ET.fromstring(parameters[0])),2)
        self.assertEqual(parameters[3],"x' OR 1=1 --")
        self.assertNotIn(parameters[3],sql)
        self.assertNotIn('catalog.event',sql)
        self.assertNotIn('AT TIME ZONE',sql)
        connection.add_output_converter.assert_called_once()
        connection.close.assert_called_once()
        cursor.close.assert_called_once()

    def test_head_options_bodies_and_error_logs_retain_shared_guards(self):
        self.assertEqual(self.client.open(PATH,method='OPTIONS').status_code,200)
        self.assertEqual(self.client.get(PATH,data='private-canary').status_code,400)
        self.assertEqual(self.client.post(PATH).status_code,405)
        self.query.assert_not_called()
        response = self.client.head(PATH,query_string=WINDOW)
        self.assertEqual((response.status_code,response.data),(200,b''))
        for state,status in (('HYT00',504),('08001',503)):
            self.query.side_effect = pyodbc.OperationalError(state,'private-canary')
            with self.assertLogs(self.app.logger,level='ERROR') as logs:
                response = self.client.get(PATH,query_string={**WINDOW,'folder':'private-folder-canary'})
            self.assertEqual(response.status_code,status)
            self.assertNotIn('private-',response.get_data(as_text=True)+'\n'.join(logs.output))

    def test_pinned_timezone_fallback_also_drives_calendar_buckets(self):
        code = """from dashboard.timeline import bucket_bounds
from dashboard.timestamps import parse_timestamp as t
from zoneinfo import TZPATH
assert TZPATH == ()
assert len(bucket_bounds(t('2026-10-24T23:00:00Z'),t('2026-10-26T00:00:00Z'),timezone_name='Europe/London',bucket='hour',limit=1000)) == 25
print('calendar fallback OK')
"""
        result = subprocess.run([sys.executable,'-B','-c',code],cwd=Path(__file__).resolve().parents[1],
            env=dict(os.environ,PYTHONTZPATH=''),capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'calendar fallback OK')
