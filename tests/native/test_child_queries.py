"""Execute the child-observation page SQL against temporary sources.

Pairing is checked against an independent Python control over the same rows,
for every cursor page of both orders and directions.
"""
from collections import defaultdict
import os
from pathlib import Path
import unittest

import pyodbc

from dashboard import create_app
from dashboard.db import load_query
from dashboard.timestamps import (SQL_SS_TIMESTAMPOFFSET, Timestamp, decode_datetimeoffset, parse_timestamp,
                                  sql_timestamp)


CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
BASE_TICKS = parse_timestamp('2026-10-01T00:00:00Z').utc_ticks
EXECUTION = 7
SOURCES = """
CREATE TABLE #child_executions(execution_id bigint PRIMARY KEY);
INSERT #child_executions VALUES(7),(8),(9);
CREATE TABLE #child_events(event_message_id bigint NULL,operation_id bigint NOT NULL,message_time datetimeoffset(7) NOT NULL,
 event_name nvarchar(1024),package_name nvarchar(260),package_path nvarchar(max) COLLATE Latin1_General_100_CI_AS_SC,
 execution_path nvarchar(max) COLLATE Latin1_General_100_CI_AS_SC,message_source_id nvarchar(38),
 message_source_name nvarchar(4000),message_source_type smallint);
CREATE INDEX IX_child_events_id ON #child_events(operation_id,event_message_id);
"""


def keyed(path, source='s', package='Child.dtsx', source_type=40):
    return dict(package_name=package, execution_path=path, message_source_id=source, message_source_type=source_type)


def build_events():
    """Repeated, ambiguous, distant and unidentified child identities."""
    events, state = [], {'id': 1000, 'tick': 0}

    def add(name, key, *, operation=EXECUTION, identified=True, package_path='\\Package', tick=None, id_step=1):
        state['id'] += id_step
        state['tick'] += 10
        events.append(dict(event_message_id=state['id'] if identified else None, operation_id=operation,
                           message_time=BASE_TICKS + (state['tick'] if tick is None else tick), event_name=name,
                           package_path=package_path, message_source_name='Call', **key))

    def noise(count):
        for index in range(count):
            # Same-shape posts of another key and non-child events; both lie
            # between neighbors and must be passed over without pairing.
            add('OnPostExecute', keyed('\\Parent\\Noise', 'n'))
            add('OnInformation', keyed('\\Parent\\A', 'a'), package_path='\\Package\\Task')
            add('OnPreExecute', keyed('\\Parent\\A', 'a'), operation=8)

    a, spaced, untyped = keyed('\\Parent\\A', 'a'), keyed('\\Parent\\A ', 'a'), keyed('\\Parent\\B', 'b', source_type=None)
    tainted, far, ambiguous = keyed('\\Parent\\C', 'c'), keyed('\\Parent\\Far', 'f'), keyed('\\Parent\\Twice', 't')
    add('OnPreExecute', ambiguous)
    noise(700)
    for index in range(40):
        add('OnPreExecute', a)
        add('OnPreExecute', spaced if index % 3 else untyped)
        if index % 7 != 3:
            add('OnPostExecute', a, tick=state['tick'] - 15 if index == 5 else None)
        if index % 9 == 4:
            add('OnPreExecute', a)
        add('OnPostExecute', spaced if index % 3 else untyped)
        add('OnPreExecute', tainted)
        add('OnPostExecute', tainted)
        add('OnPreExecute', keyed('\\Parent\\Unkeyed', None))
        add('OnPreExecute', keyed('\\Parent\\Unnamed', 'u', package=None))
        add('OnPreExecute', a, tick=state['tick'])
        add('OnPostExecute', a, tick=state['tick'])
        noise(index % 4)
    # Repeating early start times scatter one time-ordered page across the ID
    # range, with unselected same-key starts/posts between its rows.
    wrap = keyed('\\Parent\\Wrap', 'w')
    for index in range(60):
        add('OnPreExecute', wrap, tick=(index % 6) * 7)
        add('OnInformation', wrap, package_path='\\Package\\Task')
        if index % 5 != 2:
            add('OnPostExecute', wrap, tick=(index % 6) * 7 + 3)
        noise(1)
    add('OnPostExecute', tainted, identified=False)
    add('OnPreExecute', keyed('\\Parent\\Hidden', 'h'), identified=False)
    add('OnPreExecute', far)
    add('OnPreExecute', ambiguous)
    add('OnPostExecute', ambiguous)
    noise(900)
    add('OnPostExecute', far, id_step=10**12)
    add('OnPostExecute', a)
    return events


def control(events, sort, descending):
    rows = [e for e in events if e['operation_id'] == EXECUTION]
    starts = [e for e in rows if e['event_name'] == 'OnPreExecute' and e['package_path'] == '\\Package'
              and '\\' in e['execution_path'][1:] and e['event_message_id'] is not None]
    starts.sort(key=lambda e: (e['message_time'], e['event_message_id']) if sort == 'time' else e['event_message_id'],
                reverse=descending)
    groups = defaultdict(list)
    for e in rows:
        if e['package_path'] == '\\Package' and e['event_name'] in ('OnPreExecute', 'OnPostExecute'):
            groups[tuple(e[k] for k in ('package_name', 'execution_path', 'message_source_id', 'message_source_type'))].append(e)
    ends = {}
    for key, sequence in groups.items():
        if key[0] is None or key[2] is None or any(e['event_message_id'] is None for e in sequence):
            continue
        sequence.sort(key=lambda e: e['event_message_id'])
        for index, e in enumerate(sequence):
            previous = sequence[index - 1] if index else None
            following = sequence[index + 1] if index + 1 < len(sequence) else None
            if (e['event_name'] == 'OnPreExecute' and (previous is None or previous['event_name'] != 'OnPreExecute')
                    and following is not None and following['event_name'] == 'OnPostExecute'
                    and following['message_time'] >= e['message_time']):
                ends[e['event_message_id']] = following['message_time']
    return [(s['event_message_id'], s['package_name'], s['execution_path'], s['message_source_name'],
             s['message_source_type'], s['message_time'], ends.get(s['event_message_id'])) for s in starts]


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class ChildPairingSQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection = pyodbc.connect(app.config['CONNECTION_STRING']['main'], timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.connection.add_output_converter(SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset)
        self.cursor = self.connection.cursor()
        self.addCleanup(self.cursor.close)
        self.run_batch(SOURCES)
        self.events = build_events()
        self.cursor.fast_executemany = False
        self.cursor.executemany(
            'INSERT #child_events VALUES(?,?,CONVERT(datetimeoffset(7),?),?,?,?,?,?,?,?)',
            [(e['event_message_id'], e['operation_id'], sql_timestamp(Timestamp(e['message_time'])), e['event_name'],
              e['package_name'], e['package_path'], e['execution_path'], e['message_source_id'],
              e['message_source_name'], e['message_source_type']) for e in self.events])

    def run_batch(self, sql, parameters=()):
        self.cursor.execute(sql, tuple(pyodbc.BinaryNull if p is None else p for p in parameters))
        rows = []
        while True:
            if self.cursor.description:
                names = [c[0] for c in self.cursor.description]
                rows = [dict(zip(names, row)) for row in self.cursor.fetchall()]
            if not self.cursor.nextset():
                return rows

    def query(self, resource, parameters):
        self.run_batch('DROP TABLE IF EXISTS #child_page;')
        sql = load_query(resource).replace('catalog.executions', '#child_executions').replace('catalog.event_messages', '#child_events')
        self.assertNotIn('catalog.', sql)
        return self.run_batch(sql, parameters)

    def chain(self, sort, descending, take=7):
        fence = self.query('api-children-fence.sql', (EXECUTION,))[0]
        actual, last, last_time = [], None, None
        for _ in range(100):
            rows = self.query('api-children-page.sql', (EXECUTION, take + 1, fence['upper_id'], last, last_time,
                                                         int(sort == 'time'), int(descending)))
            self.assertTrue(all(r['has_unidentified_starts'] for r in rows))
            page = [r for r in rows if not r['page_empty']][:take]
            actual.extend((r['observation_id'], r['package_name'], r['execution_path'], r['source_name'], r['source_type'],
                           r['started_at'].utc_ticks, None if r['ended_at'] is None else r['ended_at'].utc_ticks) for r in page)
            if len(rows) <= take:
                return fence, actual
            last = page[-1]['observation_id']
            last_time = sql_timestamp(page[-1]['started_at']) if sort == 'time' else None
        self.fail('Unbounded or non-progressing cursor chain')

    def test_fixture_covers_each_pairing_outcome(self):
        expected = control(self.events, 'id', False)
        ends = [row[6] for row in expected]
        self.assertGreater(sum(e is not None for e in ends), 40)
        self.assertGreater(sum(e is None for e in ends), 40)
        far = [row for row in expected if row[2] == '\\Parent\\Far']
        self.assertIsNotNone(far[0][6])
        self.assertEqual([row[6] for row in expected if row[2] == '\\Parent\\Twice'], [None, None])
        self.assertTrue(all(row[6] is None for row in expected if row[2] == '\\Parent\\C'))

    def test_every_page_of_both_orders_matches_independent_pairing(self):
        for sort in ('id', 'time'):
            for descending in (False, True):
                with self.subTest(sort=sort, descending=descending):
                    fence, actual = self.chain(sort, descending)
                    self.assertTrue(fence['has_unidentified_starts'])
                    self.assertEqual(actual, control(self.events, sort, descending))

    def test_post_above_the_start_fence_still_pairs(self):
        fence = self.query('api-children-fence.sql', (EXECUTION,))[0]
        posts = [e['event_message_id'] for e in self.events if e['event_name'] == 'OnPostExecute'
                 and e['operation_id'] == EXECUTION and e['event_message_id'] is not None]
        self.assertGreater(max(posts), fence['upper_id'])
        _, actual = self.chain('id', True, take=200)
        self.assertEqual(actual, control(self.events, 'id', True))
