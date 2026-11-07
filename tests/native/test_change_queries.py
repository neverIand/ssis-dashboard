"""P5.1a native check: the detector SQL resources over a connection-local catalog on a real server.

`catalog.operations` and `catalog.executions` are replaced by temporary tables with the columns the
resources use (executions are a subset of operations), so deployments, late lower IDs, status
transitions, deletions and bursts can be scripted without writing to SSISDB. After every poll, a
consumer replica built from the seed snapshot and the emitted events must equal an independent read
of the temporary executions. One test uses global temporary tables so a second connection can commit
rows while the seed runs.
"""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import random
import threading
import time
import unittest

import pyodbc

from dashboard import create_app
from dashboard.changes import ACTIVE_STATUSES, ChangeState, Limits, tracked_xml
from dashboard.db import load_query
from dashboard.timestamps import SQL_SS_TIMESTAMPOFFSET, as_timestamp, decode_datetimeoffset

CONFIG = os.environ.get('SSIS_DASHBOARD_NATIVE_TEST_CONFIG')
T0 = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)


def wire(value):
    return None if value is None else as_timestamp(value).isoformat()


@unittest.skipUnless(CONFIG, 'Set SSIS_DASHBOARD_NATIVE_TEST_CONFIG to run native SQL tests.')
class ChangeDetectionSQLTests(unittest.TestCase):
    def setUp(self):
        app = create_app({'LOG_LEVEL': 'CRITICAL'}, config_path=str(Path(CONFIG).resolve()))
        self.connection_string = app.config['CONNECTION_STRING']['main']
        self.connection = pyodbc.connect(self.connection_string, timeout=5)
        self.addCleanup(self.connection.close)
        self.connection.timeout = 30
        self.connection.add_output_converter(SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset)
        self.cursor = self.connection.cursor()
        self.cursor.execute('CREATE TABLE #det_operations (operation_id bigint NOT NULL PRIMARY KEY); '
                            'CREATE TABLE #det_executions (execution_id bigint NOT NULL PRIMARY KEY, '
                            'status int NOT NULL, end_time datetimeoffset(7) NULL)')
        self.sql = {name: self.substituted(name, '#det_operations', '#det_executions') for name in ('seed', 'poll')}

    def substituted(self, name, operations, executions):
        sql = load_query(f'detector-{name}.sql')
        sql = sql.replace('catalog.operations', operations).replace('catalog.executions', executions)
        self.assertNotIn('catalog.operations', sql)
        self.assertNotIn('catalog.executions', sql)
        return sql

    def run_sql(self, name, parameters):
        self.cursor.execute(self.sql[name], parameters)
        columns = [column[0] for column in self.cursor.description]
        return [dict(zip(columns, row)) for row in self.cursor.fetchall()]

    def write(self, operation_id, status=None, end_time=None):
        """Commit an operation; with a status it is also an execution."""
        self.cursor.execute('IF NOT EXISTS (SELECT 1 FROM #det_operations WHERE operation_id = ?) '
                            'INSERT #det_operations VALUES (?)', operation_id, operation_id)
        self.cursor.execute('DELETE #det_executions WHERE execution_id = ?', operation_id)
        if status is not None:
            self.cursor.execute('INSERT #det_executions VALUES (?, ?, CONVERT(datetimeoffset(7), ?))',
                                operation_id, status, None if end_time is None else wire(end_time))

    def delete(self, execution_id):
        self.cursor.execute('DELETE #det_executions WHERE execution_id = ?; DELETE #det_operations WHERE operation_id = ?',
                            execution_id, execution_id)

    def snapshot(self):
        return {row.execution_id: (row.status, wire(row.end_time))
                for row in self.cursor.execute('SELECT execution_id, status, end_time FROM #det_executions')}

    def start(self, limits, now=0, previous=None):
        state = ChangeState(limits)
        carry = sorted(previous.carry(now)) if previous is not None else []
        events = state.seed(self.run_sql('seed', (limits.tracked, limits.gaps, tracked_xml(carry))), now, previous)
        return state, events, self.snapshot()

    def poll(self, state, limits, now, replica):
        events = []
        while True:
            requested = state.tracked()
            rows = self.run_sql('poll', (state.high, limits.new_rows, tracked_xml(requested)))
            page, more = state.apply(rows, requested, now)
            for event in page:
                if event['kind'] == 'resync':
                    replica.clear()
                    replica.update(self.snapshot())
                elif event['kind'] == 'removed':
                    replica.pop(int(event['execution_id']), None)
                else:
                    replica[int(event['execution_id'])] = (event['status'], event['ended_at'])
            events += page
            if not more:
                return events

    def test_deployments_late_ids_transitions_deletions_and_bursts(self):
        limits = Limits(new_rows=3, tracked=8, gaps=16, gap_seconds=30)
        state, events, replica = self.start(limits)
        self.assertEqual((state.high, events), (0, [{'kind': 'resync', 'reason': 'start'}]))
        self.write(2, 2)
        self.write(3)                              # a deployment
        self.write(5, 1)
        self.poll(state, limits, 0, replica)
        self.assertEqual((state.high, sorted(state.gaps)), (5, [1, 4]))
        self.write(4, 7, T0)                       # a lower ID that commits after 5
        self.write(2, 4, T0 + timedelta(milliseconds=1))
        self.write(5, 2)
        events = self.poll(state, limits, 10, replica)
        self.assertEqual([(e['kind'], e['execution_id']) for e in events],
                         [('changed', '2'), ('changed', '5'), ('created', '4')])
        self.assertEqual(events[0]['ended_at'], '2026-11-07T12:00:00.0010000Z')
        self.delete(5)
        for operation_id in range(10, 30):         # a burst of executions and deployments
            self.write(operation_id, 7 if operation_id % 2 else None, T0)
        self.poll(state, limits, 20, replica)
        self.assertEqual(state.high, 29)
        self.assertEqual(replica, self.snapshot())

    def test_the_seed_looks_back_for_late_commits_and_reports_overflow(self):
        limits = Limits(new_rows=10, tracked=4, gaps=8)
        for operation_id in (1, 2, 4, 5, 6, 7, 8):   # 3 is allocated but not yet committed
            self.write(operation_id, 2)
        state, events, replica = self.start(limits)
        self.assertEqual(events, [{'kind': 'resync', 'reason': 'active-limit'}])
        self.assertEqual((sorted(state.active), sorted(state.gaps)), ([5, 6, 7, 8], [3]))
        self.write(3, 7, T0)
        self.assertIn({'kind': 'created', 'execution_id': '3', 'status': 7, 'ended_at': wire(T0)},
                      self.poll(state, limits, 5, replica))

    def test_a_reseed_keeps_carried_gaps_that_have_not_committed(self):
        limits = Limits(new_rows=10, tracked=8, gaps=4, gap_seconds=30)
        for operation_id in range(1, 21):
            if operation_id not in (3, 5):
                self.write(operation_id, 7, T0)
        previous = ChangeState(limits)
        previous.high, previous.gaps, previous.complete = 20, {3: 25.0, 5: 25.0, 7: 5.0}, False
        self.write(5, 2)                           # committed before the reseed: in the reload
        state, events, replica = self.start(limits, 10, previous)
        self.assertEqual((events, state.gaps), ([{'kind': 'resync', 'reason': 'start'}], {3: 25.0}))
        self.write(3, 1)
        self.assertEqual(self.poll(state, limits, 11, replica),
                         [{'kind': 'created', 'execution_id': '3', 'status': 1, 'ended_at': None}])
        self.assertEqual(replica, self.snapshot())

    def global_catalog(self, executions_count, status):
        """Global temporary operations/executions with IDs 1..executions_count, all executions; a second
        connection can write them while this test reads. Returns the table names and a reader."""
        suffix = os.urandom(4).hex()
        operations, executions = f'##det_operations_{suffix}', f'##det_executions_{suffix}'
        owner = pyodbc.connect(self.connection_string, timeout=5, autocommit=True)
        self.addCleanup(owner.close)
        owner.timeout = 30
        owner.execute(f'CREATE TABLE {operations} (operation_id bigint NOT NULL PRIMARY KEY); '
                      f'CREATE TABLE {executions} (execution_id bigint NOT NULL PRIMARY KEY, '
                      'status int NOT NULL, end_time datetimeoffset(7) NULL)')
        self.addCleanup(owner.execute, f'DROP TABLE {operations}; DROP TABLE {executions}')
        owner.execute(f'WITH k AS (SELECT TOP (?) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS id '
                      f'FROM sys.all_objects a CROSS JOIN sys.all_objects b) '
                      f'INSERT {operations} SELECT id FROM k; '
                      f'INSERT {executions} SELECT operation_id, ?, NULL FROM {operations}', executions_count, status)
        reader = pyodbc.connect(self.connection_string, timeout=5, autocommit=True)
        self.addCleanup(reader.close)
        reader.timeout = 10
        reader.add_output_converter(SQL_SS_TIMESTAMPOFFSET, decode_datetimeoffset)
        return operations, executions, reader

    def concurrently(self, write, check, *, checks=100, writes=300, seconds=60):
        """Run `check()` until both counts are reached while `write(connection)` loops on a second
        connection. A writer error fails the test; so does the deadline."""
        stop, errors, written = threading.Event(), [], [0]

        def writer():
            try:
                connection = pyodbc.connect(self.connection_string, timeout=5, autocommit=True)
                connection.timeout = 10
                try:
                    while not stop.is_set():
                        write(connection)
                        written[0] += 1
                finally:
                    connection.close()
            except Exception as error:      # surfaced on the test thread below
                errors.append(error)
        thread = threading.Thread(target=writer, daemon=True)
        thread.start()
        deadline, done = time.monotonic() + seconds, 0
        try:
            while (done < checks or written[0] < writes) and not errors:
                self.assertLess(time.monotonic(), deadline, 'the concurrent check did not finish in time')
                check()
                done += 1
        finally:
            stop.set()
            thread.join(30)
        self.assertFalse(thread.is_alive(), 'the writer did not exit')
        if errors:
            raise errors[0]
        self.assertGreaterEqual(written[0], writes, 'rows were committed while the checks ran')

    @staticmethod
    def fetch(connection, sql, parameters):
        cursor = connection.execute(sql, *parameters)
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    def test_the_seed_is_bounded_by_its_mark_while_rows_commit(self):
        """Codex P5.1 R2-2: rows committed above the mark during the seed must not reach it."""
        operations, executions, reader = self.global_catalog(50, 2)
        sql = self.substituted('seed', operations, executions)
        limits = Limits(tracked=8, gaps=16)
        next_id = [50]

        def write(connection):
            next_id[0] += 1
            connection.execute(f'INSERT {operations} VALUES (?); INSERT {executions} VALUES (?, 2, NULL)',
                               next_id[0], next_id[0])
        self.concurrently(write, lambda: ChangeState(limits).seed(   # raises on any row above the mark
            self.fetch(reader, sql, (limits.tracked, limits.gaps, tracked_xml([]))), 0))

    def test_an_execution_committing_below_the_mark_during_the_seed_stays_followed(self):
        """Codex P5.1 R3-1: an ID below the mark that commits while the seed runs must end up either
        active or a gap, whichever of the seed's reads sees it, so its transitions are followed."""
        operations, executions, reader = self.global_catalog(20000, 7)   # terminal: actives scan far
        sql = self.substituted('seed', operations, executions)
        limits = Limits(tracked=1000, gaps=64)
        next_id = [20000]

        def write(connection):
            # A higher ID commits first, then the lower one as a running execution.
            k = next_id[0]
            connection.execute(f'INSERT {operations} VALUES (?)', k + 2)
            connection.execute(f'BEGIN TRANSACTION; INSERT {operations} VALUES (?); '
                               f'INSERT {executions} VALUES (?, 2, NULL); COMMIT', k + 1, k + 1)
            next_id[0] = k + 2
            time.sleep(0.002)

        def check():
            state = ChangeState(limits)
            state.seed(self.fetch(reader, sql, (limits.tracked, limits.gaps, tracked_xml([]))), 0)
            running = {row[0] for row in reader.execute(
                f'SELECT execution_id FROM {executions} WHERE status = 2 AND execution_id BETWEEN ? AND ?',
                state.high - 16, state.high)}
            self.assertLessEqual(running, set(state.active) | set(state.gaps), 'neither active nor a gap')
        self.concurrently(write, check, checks=150, writes=150)

    def test_the_maximum_tracked_list_round_trips(self):
        for operation_id in range(1, 8):
            self.write(operation_id, 2)
        rows = self.run_sql('poll', (7, 1000, tracked_xml(list(range(1, 2001)))))
        self.assertEqual(sorted(row['execution_id'] for row in rows if row['source'] == 1), list(range(1, 8)))

    def test_randomized_mutations_keep_the_replica_exact(self):
        for seed in range(6):
            with self.subTest(seed=seed):
                self.cursor.execute('TRUNCATE TABLE #det_executions; TRUNCATE TABLE #det_operations')
                rng = random.Random(seed)
                limits = Limits(new_rows=rng.choice([2, 5]), tracked=64, gaps=16, gap_seconds=30)
                next_id = 0
                for _ in range(rng.randint(0, 10)):
                    next_id += 1
                    self.write(next_id, rng.choice((None, 1, 2, 7, 4)))
                state, _, replica = self.start(limits)
                pending = []
                for step in range(25):
                    for item in [p for p in pending if p[2] <= step]:
                        pending.remove(item)
                        self.write(item[0], item[1])
                    for _ in range(rng.randint(0, 4)):
                        actives = [i for i, (status, _) in self.snapshot().items() if status in ACTIVE_STATUSES]
                        action = rng.random()
                        if action < 0.4:
                            next_id += 1
                            status = rng.choice((None, None, 1, 2, 7, 4))
                            if rng.random() < 0.3:
                                pending.append((next_id, status, step + rng.randint(1, 6)))
                            else:
                                self.write(next_id, status)
                        elif action < 0.85 and actives:
                            status = rng.choice((2, 5, 8, 3, 4, 6, 7, 9))
                            self.write(rng.choice(actives), status,
                                       None if status in ACTIVE_STATUSES else T0 + timedelta(seconds=step))
                        elif actives:
                            self.delete(rng.choice(actives))
                    self.poll(state, limits, step * 5, replica)
                    self.assertTrue(state.complete)
                    self.assertEqual(replica, self.snapshot(), f'step {step}')
