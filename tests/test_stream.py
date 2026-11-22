"""P5.2 change-stream prototype: admission, frame table, slots and lifetime, without a database."""
import json
import time
import unittest
from unittest import mock

from werkzeug.test import EnvironBuilder

from dashboard import create_app, stream
from dashboard.changes import Limits
from dashboard.stream import HEARTBEAT, RETRY, Slots, changes_data, enable_stream, frame, frames, validate_config
from tests.test_detector import CONFIG, Clock, Fake, Running

GEN = '0123456789abcdef'
HEALTHY = {'healthy': True, 'run': 1}
SICK = {'healthy': False, 'run': 1}


def cur(n):
    return f'{GEN}:{n}'


class Script:
    """read_with_health returning scripted results; records each (after, timeout)."""

    def __init__(self, clock, results, advance=0.0):
        """`advance`: seconds each read takes, one number or a list per read."""
        self.clock, self.results, self.calls = clock, list(results), []
        self.advance = list(advance) if isinstance(advance, list) else [advance] * len(self.results)

    def read_with_health(self, after, timeout):
        self.calls.append((after, timeout))
        self.clock.now += self.advance.pop(0) if self.results else timeout
        if not self.results:
            return {'events': [], 'next': cur(99), 'resync': False, 'health': SICK}
        return self.results.pop(0)


def result(events=(), n=1, resync=False, health=HEALTHY):
    return {'events': list(events), 'next': cur(n), 'resync': resync, 'health': health}


def changed(i):
    return {'kind': 'changed', 'execution_id': str(i), 'status': 7, 'ended_at': None}


def run(script, header=None, *, lifetime=100, heartbeat=10, names_ids=False):
    return list(frames(script, header, deadline=script.clock.now + lifetime, heartbeat=heartbeat,
                       names_ids=names_ids, clock=script.clock))


def parse(data):
    fields = {}
    for line in data.decode('utf-8').rstrip('\n').split('\n'):
        name, _, value = line.partition(':')
        fields[name] = value[1:] if value.startswith(' ') else value
    return fields


class FrameTableTests(unittest.TestCase):
    def test_frames_are_dispatchable_utf8_with_data_and_a_final_blank_line(self):
        self.assertEqual(frame('stale', {'reason': 'detector'}, cursor=''),
                         b'event: stale\nid:\ndata: {"reason":"detector"}\n\n')
        self.assertEqual(frame('changes', {'ids': []}, cursor=cur(3)),
                         b'event: changes\nid: 0123456789abcdef:3\ndata: {"ids":[]}\n\n')
        self.assertEqual((HEARTBEAT, RETRY), (b':\n\n', b'retry: 1000\n\n'))

    def test_an_unhealthy_detector_sends_stale_with_an_empty_id_and_ends(self):
        clock = Clock()
        script = Script(clock, [result(health=SICK)])
        out = run(script, cur(4))
        self.assertEqual([(end, parse(data)) for end, data in out],
                         [('stale', {'event': 'stale', 'id': '', 'data': '{"reason":"detector"}'})])

    def test_opening_without_a_usable_cursor_resyncs_and_reads_at_once(self):
        for header, reason in ((None, 'subscribe'), ('garbage', 'subscribe'), (GEN.upper() + ':1', 'subscribe'),
                               (cur(7), 'cursor')):
            with self.subTest(header=header):
                script = Script(Clock(), [result(n=5, resync=True)])
                first = run(script, header)[0]
                self.assertEqual(parse(first[1]), {'event': 'resync', 'id': cur(5), 'data': json.dumps({'reason': reason}).replace(' ', '')})
                self.assertEqual(script.calls[0], (header if reason == 'cursor' else None, 0.0))

    def test_a_valid_cursor_with_nothing_new_opens_with_an_empty_acknowledgement(self):
        script = Script(Clock(), [result(n=4)])
        first = run(script, cur(4))[0]
        self.assertEqual(parse(first[1]), {'event': 'changes', 'id': cur(4), 'data': '{"ids":[]}'})

    def test_batches_are_anonymous_unless_names_are_allowed_and_safe(self):
        self.assertEqual(changes_data([changed(3), changed(2), changed(3)], False), {'ids': None})
        self.assertEqual(changes_data([changed(10), changed(9), changed(10)], True), {'ids': ['9', '10']})
        removed = {'kind': 'removed', 'execution_id': '4'}
        self.assertEqual(changes_data([changed(3), removed], True), {'ids': None})
        self.assertEqual(changes_data([changed(i) for i in range(1, stream.MAX_NAMED_IDS + 2)], True), {'ids': None})
        script = Script(Clock(), [result(n=4), result([changed(5)], n=6)])
        out = run(script, cur(4), names_ids=True)
        self.assertEqual(parse(out[1][1]), {'event': 'changes', 'id': cur(6), 'data': '{"ids":["5"]}'})

    def test_resyncs_mid_stream_and_detector_resync_events_send_one_resync(self):
        trimmed = Script(Clock(), [result(n=4), result(n=9, resync=True)])
        self.assertEqual(parse(run(trimmed, cur(4))[1][1]),
                         {'event': 'resync', 'id': cur(9), 'data': '{"reason":"cursor"}'})
        detector = Script(Clock(), [result(n=4), result([changed(5), {'kind': 'resync', 'reason': 'active-limit'}], n=7)])
        self.assertEqual(parse(run(detector, cur(4))[1][1]),
                         {'event': 'resync', 'id': cur(7), 'data': '{"reason":"detector"}'})

    def test_each_read_continues_from_the_cursor_sent_and_waits_for_the_heartbeat_or_lifetime(self):
        clock = Clock()
        script = Script(clock, [result(n=4), result([changed(5)], n=6), result(n=6)], advance=2)
        out = run(script, cur(4), lifetime=30, heartbeat=10)
        self.assertEqual([after for after, _ in script.calls[:3]], [cur(4), cur(4), cur(6)])
        self.assertEqual([timeout for _, timeout in script.calls[:3]], [0.0, 10.0, 10.0])
        self.assertEqual([parse(d).get('event') for _, d in out[:2]], ['changes', 'changes'])

    def test_an_empty_read_sends_a_heartbeat_only_when_due_and_the_lifetime_ends_with_retry(self):
        clock = Clock()
        script = Script(clock, [result(n=4)] + [result(n=4) for _ in range(20)], advance=5)
        out = run(script, cur(4), lifetime=30, heartbeat=10)
        self.assertEqual(out[0][0], None)
        self.assertEqual([d for _, d in out[1:-1]], [HEARTBEAT, HEARTBEAT])
        self.assertEqual(out[-1], ('lifetime', RETRY))

    def test_a_read_that_crosses_the_deadline_after_the_opening_frame_sends_retry_instead(self):
        clock = Clock()
        script = Script(clock, [result(n=4), result([changed(5)], n=6)], advance=[0, 50])
        out = run(script, cur(4), lifetime=30, heartbeat=10)
        self.assertEqual(parse(out[0][1])['data'], '{"ids":[]}', 'the opening frame went out first')
        self.assertEqual(out[1:], [('lifetime', RETRY)])

    def test_the_deadline_is_checked_after_the_frame_is_built(self):
        # Codex P5.2 prototype round 1: a read returning at 9.9 s whose encoding ends past 10 s.
        clock = Clock()
        script = Script(clock, [result(n=4), result([changed(5)], n=6)], advance=[0, 9.9])
        encode = stream.changes_data

        def slow(events, names_ids):
            clock.now += 0.2
            return encode(events, names_ids)
        with mock.patch.object(stream, 'changes_data', slow):
            out = run(script, cur(4), lifetime=10, heartbeat=10)
        self.assertEqual(out[1:], [('lifetime', RETRY)])

    def test_a_stream_ends_stale_when_the_detector_run_it_opened_under_has_ended(self):
        restarted = {'healthy': True, 'run': 2}
        script = Script(Clock(), [result(n=4), result(n=4, health=restarted)], advance=10)
        out = run(script, cur(4), lifetime=100, heartbeat=10)
        self.assertEqual([end for end, _ in out], [None, 'stale'])

    def test_a_real_detector_feeds_the_table(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = Running(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll, clock=clock,
                    limits=Limits(gap_seconds=30))
        self.assertEqual(parse(next(frames(d, None, deadline=clock.now + 100, heartbeat=10, names_ids=True, clock=clock))[1])['event'],
                         'stale', 'no poll yet')
        d.poll_once()
        d.poll_once()
        opening = next(frames(d, None, deadline=clock.now + 100, heartbeat=10, names_ids=True, clock=clock))[1]
        cursor = parse(opening)['id']
        fake.ops[1] = (7, None)
        d.poll_once()
        out = next(frames(d, cursor, deadline=clock.now + 100, heartbeat=10, names_ids=True, clock=clock))[1]
        self.assertEqual(parse(out)['data'], '{"ids":["1"]}', 'the replay is the opening frame for a valid cursor')


def stream_app(enable=True, **config):
    app = create_app({'CHANGE_DETECTION_ENABLED': True, 'CHANGE_STREAM_ENABLED': True, **config})
    fake = Fake({1: (2, None)})
    d = app.extensions['change_detector']
    d._read_seed, d._read_poll = fake.read_seed, fake.read_poll
    if enable:
        enable_stream(app)
    return app, d


def wsgi(app, method='GET', **headers):
    """Call the WSGI app directly: (status, headers, iterable), nothing iterated yet."""
    environ = EnvironBuilder(path='/api/v1/changes', method=method, headers=headers,
                             environ_base={'REMOTE_ADDR': '127.0.0.1'}).get_environ()
    captured = {}

    def start_response(status, response_headers, exc_info=None):
        captured.update(status=status, headers=dict(response_headers))
    iterable = app(environ, start_response)
    return captured, iterable


def closed_lines(logs):
    return [json.loads(line.split(':', 2)[2]) for line in logs.output if 'change_stream_closed' in line]


class EndpointTests(unittest.TestCase):
    def test_disabled_by_default_validated_and_absent_from_a_wsgi_host(self):
        self.assertEqual(create_app({}).test_client().get('/api/v1/changes').status_code, 404)
        app, _ = stream_app(enable=False)          # dashboard/wsgi.py never calls enable_stream()
        self.assertEqual(app.test_client().get('/api/v1/changes').status_code, 404)
        self.assertFalse(enable_stream(create_app({})), 'the flag is off')
        app, _ = stream_app()
        self.assertFalse(enable_stream(app), 'once per application')
        base = {'CHANGE_DETECTION_ENABLED': True, 'CHANGE_STREAM_ENABLED': True, 'CHANGE_STREAM_NAMES_IDS': False,
                'CHANGE_STREAM_MAX_STREAMS': 4, 'CHANGE_STREAM_LIFETIME_SECONDS': 300, 'CHANGE_STREAM_HEARTBEAT_SECONDS': 15}
        validate_config(base)
        for bad in ({'CHANGE_DETECTION_ENABLED': False}, {'CHANGE_STREAM_ENABLED': 1}, {'CHANGE_STREAM_NAMES_IDS': 'no'},
                    {'CHANGE_STREAM_MAX_STREAMS': 0}, {'CHANGE_STREAM_MAX_STREAMS': 65},
                    {'CHANGE_STREAM_LIFETIME_SECONDS': 9}, {'CHANGE_STREAM_HEARTBEAT_SECONDS': 300},
                    {'CHANGE_STREAM_HEARTBEAT_SECONDS': 1.5}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_config({**base, **bad})

    def test_admission_comes_first_for_every_method_and_head_and_options_take_no_slot(self):
        app, _ = stream_app()
        client = app.test_client()
        slots = app.extensions['change_stream']['slots']
        remote = {'REMOTE_ADDR': '192.0.2.8'}
        for method in ('GET', 'HEAD', 'OPTIONS'):
            with self.subTest(method=method):
                self.assertEqual(client.open('/api/v1/changes', method=method, environ_base=remote).status_code, 404)
                self.assertEqual(client.open('/api/v1/changes?cursor=1', method=method, environ_base=remote,
                                             headers={'Sec-Fetch-Site': 'cross-site'}).status_code, 404,
                                 'a remote peer is refused before the query and Fetch Metadata checks')
                for site in ('same-site', 'cross-site', 'none'):
                    self.assertEqual(client.open('/api/v1/changes', method=method,
                                                 headers={'Sec-Fetch-Site': site}).status_code, 403)
        self.assertEqual(client.get('/api/v1/changes?cursor=1').status_code, 400)
        head = client.head('/api/v1/changes', headers={'Sec-Fetch-Site': 'same-origin'})
        options = client.options('/api/v1/changes')
        self.assertEqual((head.status_code, head.mimetype, head.data), (200, 'text/event-stream', b''))
        self.assertEqual((options.status_code, slots.open, slots.released), (200, 0, 0))
        self.assertIn('GET', options.headers['Allow'])
        ipv6 = client.get('/api/v1/changes', environ_base={'REMOTE_ADDR': '::1'}, buffered=False)
        self.assertEqual(ipv6.status_code, 200)
        ipv6.close()

    def test_a_stopped_detector_opens_stale_and_the_response_headers_suit_a_stream(self):
        app, _ = stream_app()
        response = app.test_client().get('/api/v1/changes')
        self.assertEqual((response.status_code, response.mimetype, response.headers['Cache-Control'],
                          response.headers['X-Accel-Buffering']), (200, 'text/event-stream', 'no-store', 'no'))
        self.assertTrue(response.headers['X-Request-ID'])
        self.assertEqual(parse(response.data), {'event': 'stale', 'id': '', 'data': '{"reason":"detector"}'})

    def test_capacity_is_refused_before_any_frame(self):
        app, _ = stream_app(CHANGE_STREAM_MAX_STREAMS=1)
        client = app.test_client()
        held = client.get('/api/v1/changes', buffered=False)
        refused = client.get('/api/v1/changes')
        body = refused.get_json()
        self.assertEqual((refused.status_code, refused.mimetype, body['code'], refused.headers['Retry-After']),
                         (503, 'application/problem+json', 'stream_capacity', '5'))
        held.close()
        self.assertEqual(app.extensions['change_stream']['slots'].open, 0)

    def test_every_way_of_ending_returns_one_slot_and_logs_once(self):
        app, _ = stream_app(CHANGE_STREAM_MAX_STREAMS=1)
        slots = app.extensions['change_stream']['slots']
        with self.assertLogs(app.logger, 'INFO') as logs:
            _, iterable = wsgi(app)                   # closed without a single iteration
            iterable.close()
            self.assertEqual((slots.open, slots.released), (0, 1))
            _, iterable = wsgi(app)                   # a client gone after the first frame
            next(iter(iterable))
            iterable.close()
            self.assertEqual((slots.open, slots.released), (0, 2))
            _, iterable = wsgi(app)                   # stale, then the generator ends by itself
            self.assertIn(b'stale', b''.join(iterable))
            iterable.close()
            self.assertEqual((slots.open, slots.released), (0, 3))
        self.assertEqual([line['outcome'] for line in closed_lines(logs)], ['not_started', 'closed', 'stale'])

    def test_a_failing_opening_read_is_a_problem_response_and_a_later_failure_releases_once(self):
        app, d = stream_app(CHANGE_STREAM_NAMES_IDS=True)
        slots = app.extensions['change_stream']['slots']
        with mock.patch.object(type(d), 'read_with_health', side_effect=RuntimeError('boom')), \
                self.assertLogs(app.logger, 'INFO') as logs:
            captured, iterable = wsgi(app)
            body = b''.join(iterable)
            iterable.close()
        self.assertTrue(captured['status'].startswith('500'))
        self.assertEqual((captured['headers']['Content-Type'], captured['headers']['Cache-Control']),
                         ('application/problem+json', 'no-store'))
        self.assertEqual(json.loads(body)['request_id'], captured['headers']['X-Request-ID'])
        self.assertEqual((slots.open, slots.released, [line['outcome'] for line in closed_lines(logs)]),
                         (0, 1, ['error']))
        reads = iter([result(n=4)])

        def later(self, after, timeout):
            try:
                return next(reads)
            except StopIteration:
                raise RuntimeError('boom') from None
        with mock.patch.object(type(d), 'read_with_health', later), self.assertLogs(app.logger, 'INFO') as logs:
            _, iterable = wsgi(app, **{'Last-Event-ID': cur(4)})
            frames_seen = iter(iterable)
            next(frames_seen)
            with self.assertRaises(RuntimeError):
                next(frames_seen)
            iterable.close()
        self.assertEqual((slots.open, slots.released, [line['outcome'] for line in closed_lines(logs)]),
                         (0, 2, ['error']))

    def test_an_opening_frame_built_before_the_deadline_is_not_sent_after_it(self):
        # Codex P5.2 prototype round 2: the view builds the opening frame; the body may start later.
        app, d = stream_app(CHANGE_STREAM_LIFETIME_SECONDS=10, CHANGE_STREAM_HEARTBEAT_SECONDS=5)
        for name, opening in (('resync', result(n=4, resync=True)), ('stale', result(health=SICK))):
            with self.subTest(opening=name), \
                    mock.patch.object(type(d), 'read_with_health', lambda self, after, timeout: opening):
                _, iterable = wsgi(app)
                later = time.monotonic() + 10.001
                with mock.patch.object(stream.time, 'monotonic', lambda: later):
                    body = b''.join(iterable)
                iterable.close()
            self.assertEqual(body, RETRY, 'a stale frame would also clear the cursor after the deadline')
        self.assertEqual(app.extensions['change_stream']['slots'].open, 0)

    def test_the_wait_never_passes_the_shared_deadline(self):
        clock = Clock()
        script = Script(clock, [result(n=4), result(n=4)], advance=[0, 0])
        list(frames(script, cur(4), deadline=1.0, heartbeat=10, names_ids=False, clock=clock))
        self.assertEqual(script.calls[1], (cur(4), 1.0))

    def test_the_slot_counter_and_each_slot_release_once(self):
        slots = Slots(2)
        a, b = slots.acquire(), slots.acquire()
        self.assertIsNone(slots.acquire())
        self.assertEqual((a.release(), a.release(), slots.open), (True, False, 1))
        self.assertIsNotNone(slots.acquire())
        self.assertEqual((b.release(), slots.released), (True, 2))

    def test_output_never_passes_the_cap_whichever_frame_ends_the_stream(self):
        app, d = stream_app(CHANGE_STREAM_NAMES_IDS=True)
        healthy = [{'events': [changed(i)], 'next': cur(i), 'resync': False, 'health': HEALTHY} for i in range(1, 50)]
        sizes = [len(frame('changes', {'ids': [str(i)]}, cursor=cur(i))) for i in (1, 2)]
        cap = sum(sizes) + stream._FINAL_RESERVE      # room for two frames and the longest final frame
        for name, reads in (('retry', healthy), ('stale', healthy[:2] + [result(health=SICK)])):
            with self.subTest(end=name):
                batches = iter(reads)
                with mock.patch.object(type(d), 'read_with_health', lambda self, after, timeout: next(batches)), \
                        mock.patch.object(stream, 'MAX_STREAM_BYTES', cap):
                    data = app.test_client().get('/api/v1/changes', headers={'Last-Event-ID': cur(0)}).data
                self.assertLessEqual(len(data), cap)
                self.assertEqual(data.count(b'event: changes'), 2)
                self.assertTrue(data.endswith(RETRY if name == 'retry' else b'{"reason":"detector"}\n\n'))
        self.assertEqual(app.extensions['change_stream']['slots'].open, 0)


if __name__ == '__main__':
    unittest.main()
