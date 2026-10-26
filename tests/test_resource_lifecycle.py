"""Concurrent request ownership and recovery at the real query/logging boundary."""

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import json
import logging
from threading import Barrier, Lock
import unittest
from unittest.mock import patch

from flask import jsonify, request
import pyodbc

from dashboard import create_app
from dashboard.db import execute_query
from dashboard.observability import record_query


class ResourceLifecycleTests(unittest.TestCase):
    def test_mixed_concurrent_requests_close_their_own_resources_and_recover(self):
        app = create_app({'TESTING': True, 'LOG_LEVEL': 'INFO'})
        lock, barrier = Lock(), Barrier(4, timeout=5)
        active = {'connection': set(), 'cursor': set()}
        peak = Counter()
        closed, records = [], []
        cancellations = {}

        class Capture(logging.Handler):
            def emit(self, record):
                with lock:
                    records.append(json.loads(record.getMessage()))

        capture = Capture()
        app.logger.addHandler(capture)
        self.addCleanup(app.logger.removeHandler, capture)

        def acquire(kind, marker):
            with lock:
                self.assertNotIn(marker, active[kind])
                active[kind].add(marker)
                peak[kind] = max(peak[kind], len(active[kind]))

        def release(kind, marker):
            with lock:
                self.assertIn(marker, active[kind])
                if kind == 'connection':
                    self.assertNotIn(marker, active['cursor'])
                active[kind].remove(marker)
                closed.append((kind, marker))

        class Cursor:
            description = [('marker',)]

            def __init__(self, marker, mode):
                self.marker, self.mode = marker, mode
                acquire('cursor', marker)

            def execute(self, sql, parameters):
                barrier.wait()
                if self.mode == 'execute':
                    raise pyodbc.Error('HYT00', 'private-execute-canary')
                if self.mode == 'cancel':
                    error = KeyboardInterrupt('private-cancel-canary')
                    cancellations[self.marker] = error
                    raise error

            def fetchall(self):
                if self.mode == 'fetch':
                    raise pyodbc.Error('08S01', 'private-fetch-canary')
                return [(self.marker,)]

            def close(self):
                release('cursor', self.marker)

        class Connection:
            def __init__(self, marker, mode):
                self.marker, self.mode = marker, mode
                acquire('connection', marker)

            def cursor(self):
                return Cursor(self.marker, self.mode)

            def close(self):
                release('connection', self.marker)

        def connect(*args, **kwargs):
            return Connection(request.view_args['marker'], request.headers['X-Test-Mode'])

        @app.get('/api/v1/resource/<marker>')
        def resource(marker):
            rows = execute_query('api-readiness.sql', connection_string='synthetic',
                                 login_timeout=1, query_timeout=2, on_complete=record_query)
            return jsonify(rows)

        def read(work):
            marker, mode = work
            try:
                with app.test_client() as client:
                    response = client.get('/api/v1/resource/' + marker, headers={'X-Test-Mode': mode})
                    return marker, mode, response.status_code, response.headers['X-Request-ID'], response.json
            except KeyboardInterrupt as error:
                self.assertIs(error, cancellations[marker])
                return marker, mode, None, None, None

        responses = []
        with patch('dashboard.db.pyodbc.connect', side_effect=connect), ThreadPoolExecutor(max_workers=4) as workers:
            for wave in range(12):
                # The next wave retries the same worker positions successfully;
                # failures/cancellation must not contaminate those requests.
                modes = ('ok', 'execute', 'fetch', 'cancel') if wave % 2 == 0 else ('ok',) * 4
                responses.extend(workers.map(read, [(f'{wave}-{i}', mode) for i, mode in enumerate(modes)]))
                self.assertEqual(active, {'connection': set(), 'cursor': set()})

        self.assertEqual(dict(peak), {'connection': 4, 'cursor': 4})
        self.assertEqual(Counter(kind for kind, _ in closed), {'cursor': 48, 'connection': 48})
        summaries = {r['request_id']: r for r in records if r['event'] == 'request_completed'}
        queries = [r for r in records if r['event'] == 'query_completed']
        self.assertEqual(len(summaries), 48)
        self.assertEqual(len(queries), 48)
        self.assertEqual(len({q['request_id'] for q in queries}), 48)
        for marker, mode, status, identifier, body in responses:
            if mode == 'ok':
                self.assertEqual(status, 200)
                self.assertEqual(body, [{'marker': marker}])
            elif mode != 'cancel':
                self.assertEqual(status, 504 if mode == 'execute' else 503)
                self.assertEqual(body['request_id'], identifier)
        for query in queries:
            summary = summaries[query['request_id']]
            self.assertEqual(summary['query_count'], 1)
            self.assertEqual(query['query_index'], 1)
            self.assertEqual(summary['query_failures'], int(query['outcome'] != 'ok'))
            self.assertFalse(query['cleanup_failed'])
            if query['outcome'] == 'cancelled':
                self.assertEqual(summary['outcome'], 'aborted')
                self.assertIsNone(summary['status'])
        self.assertNotIn('private-', json.dumps(records))


if __name__ == '__main__':
    unittest.main()
