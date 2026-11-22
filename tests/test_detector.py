"""P5.1c owned detector: lifecycle, publication, subscriber reads, failures and process guard."""
import threading
import time
import unittest

from dashboard import create_app
from dashboard.changes import Limits
from dashboard.detector import MAX_PAGES, Detector, backoff_delay, default_limits, start_for_process, validate_config
from tests.test_changes import poll_rows, seed_rows

CONFIG = {'DB_LOGIN_TIMEOUT_SECONDS': 1, 'DB_QUERY_TIMEOUT_SECONDS': 1, 'CHANGE_DETECTION_INTERVAL_SECONDS': 1}


class Fake:
    """Seed/poll readers over an in-memory operation catalog; counts calls; can be told to fail."""

    def __init__(self, ops=None):
        self.ops = dict(ops or {})
        self.seeds = self.polls = 0
        self.carried = []
        self.fail = None
        self.on_poll = None

    def read_seed(self, config, limits, carry=()):
        self.seeds += 1
        self.carried.append(list(carry))
        if self.fail:
            raise self.fail
        return seed_rows(self.ops, limits, carry)

    def read_poll(self, config, state, limits):
        self.polls += 1
        if self.on_poll:
            self.on_poll()
        if self.fail:
            raise self.fail
        requested = state.tracked()
        return poll_rows(self.ops, state.high, requested, limits), requested


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def seq(cursor):
    return int(cursor.split(':')[1])


def at(d, sequence):
    """A cursor of this detector instance at `sequence`."""
    return d.read(None)['next'].split(':')[0] + f':{sequence}'


def detector(fake, clock=None, **kwargs):
    kwargs.setdefault('limits', Limits(gap_seconds=30))
    return Detector(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll, clock=clock or Clock(), **kwargs)


class DetectorTests(unittest.TestCase):
    def test_disabled_by_default_and_attached_but_not_started_when_enabled(self):
        self.assertNotIn('change_detector', create_app({}).extensions)
        app = create_app({'CHANGE_DETECTION_ENABLED': True})
        self.assertIsInstance(app.extensions['change_detector'], Detector)
        self.assertFalse(app.extensions['change_detector'].running)

    def test_configuration_is_validated_and_gap_windows_cover_the_interval(self):
        for bad in ({'CHANGE_DETECTION_ENABLED': 1}, {'CHANGE_DETECTION_INTERVAL_SECONDS': 0},
                    {'CHANGE_DETECTION_INTERVAL_SECONDS': 301}, {'CHANGE_DETECTION_INTERVAL_SECONDS': 1.5}):
            with self.assertRaises(ValueError):
                validate_config({'CHANGE_DETECTION_ENABLED': False, 'CHANGE_DETECTION_INTERVAL_SECONDS': 5, **bad})
        self.assertEqual([default_limits(i).gap_seconds for i in (1, 5, 30, 120, 300)], [60, 60, 90, 360, 900])
        with self.assertRaises(ValueError):
            Detector(CONFIG, interval=60, limits=Limits(gap_seconds=60))

    def test_seed_then_poll_publish_ordered_events_and_reads_never_query(self):
        fake = Fake({1: (7, None), 2: (2, None)})
        d = detector(fake)
        start = d.read(None)
        self.assertEqual((start['events'], start['resync'], seq(start['next'])), ([], True, 0),
                         'a new subscriber loads, then follows the cursor')
        self.assertEqual(d.poll_once(), ([{'kind': 'resync', 'reason': 'start'}], False))
        fake.ops.update({2: (7, None), 3: None, 4: (1, None)})
        d.poll_once()
        calls = (fake.seeds, fake.polls)
        first = d.read(start['next'])
        self.assertEqual([e['kind'] for e in first['events']], ['resync', 'changed', 'created'])
        self.assertEqual((seq(first['next']), first['resync']), (3, False))
        self.assertEqual(d.read(first['next']), {'events': [], 'next': first['next'], 'resync': False})
        self.assertEqual(d.read(at(d, 9))['resync'], True, 'a sequence from the future')
        self.assertEqual((fake.seeds, fake.polls), calls, 'subscriber reads do not touch the database')

    def test_a_cursor_from_another_instance_resyncs_even_when_its_sequence_exists(self):
        fake = Fake({1: (2, None)})
        old = detector(fake)
        old.poll_once()
        fake.ops[2] = (2, None)
        old.poll_once()
        cursor = old.read(at(old, 0))['next']
        new = detector(fake)
        new.poll_once()
        fake.ops.update({3: (2, None), 4: (2, None)})
        new.poll_once()
        self.assertEqual(seq(cursor), 2)
        self.assertEqual(new.read(cursor), {'events': [], 'next': at(new, 3), 'resync': True})
        generation = cursor.split(':')[0]
        # 'A' * 16: an uppercase generation is rejected even when a random one has no letters to uppercase.
        for bad in (0, 2, '2', 'x:1', generation + ':-1', 'A' * 16 + ':1', generation + ':' + '9' * 19):
            with self.assertRaises(ValueError):
                old.read(bad)

    def test_poll_results_and_each_read_are_independent_of_the_replay_log(self):
        # Full review of 19 November 2026, R-06: an in-process consumer may annotate the events it receives.
        fake = Fake({1: (2, None)})
        d = detector(fake)
        start = d.read(None)['next']
        d.poll_once()
        fake.ops[1] = (7, None)
        polled, _ = d.poll_once()
        polled[0]['client'] = 'poller'
        polled[0]['status'] = 99
        first = d.read(start)['events']
        first[-1]['client'] = 'first reader'
        first[-1].pop('kind')
        second = d.read(start)['events']
        self.assertEqual([e['kind'] for e in second], ['resync', 'changed'])
        self.assertEqual(second[-1], {'kind': 'changed', 'execution_id': '1', 'status': 7, 'ended_at': None})
        self.assertIsNot(second[-1], first[-1])
        self.assertIsNot(second[-1], polled[0])

    def test_a_trimmed_log_tells_slow_readers_to_resync(self):
        fake = Fake({1: (2, None)})
        d = detector(fake, log_size=2)
        d.poll_once()
        for status in (5, 8, 2):
            fake.ops[1] = (status, None)
            d.poll_once()
        self.assertEqual(d.read(at(d, 0))['resync'], True)
        self.assertEqual(d.read(at(d, 1))['resync'], True)
        self.assertEqual(len(d.read(at(d, 2))['events']), 2)

    def test_read_waits_for_the_next_event_without_polling(self):
        fake = Fake({1: (2, None)})
        d = Detector(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll)
        d.poll_once()
        cursor = at(d, 1)
        result, started = {}, threading.Event()

        def reader():
            started.set()
            result.update(d.read(cursor, timeout=5))
        thread = threading.Thread(target=reader)
        thread.start()
        started.wait(5)
        fake.ops[1] = (7, None)
        d.poll_once()
        thread.join(5)
        self.assertEqual([e['kind'] for e in result['events']], ['changed'])

    def test_a_cycle_reads_at_most_max_pages_and_publishes_each_page_as_it_goes(self):
        fake = Fake({1: (7, None)})
        d = detector(fake, limits=Limits(new_rows=10, gap_seconds=30))
        d.poll_once()
        fake.ops.update({i: (7, None) for i in range(2, 2002)})
        published = []
        fake.on_poll = lambda: published.append(seq(d.read(None)['next']))
        events, more = d.poll_once()
        self.assertEqual((fake.polls, more, len(events)), (MAX_PAGES, True, 10 * MAX_PAGES))
        self.assertEqual(published, [1, 11, 21, 31, 41], 'each page was published before the next read')
        self.assertEqual(d.poll_once()[1], True, 'the backlog continues on the next cycle')

    def test_failures_bad_rows_long_outages_and_incomplete_states_reseed(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = detector(fake, clock)
        d.poll_once()
        fake.fail = OSError('network')
        with self.assertRaises(OSError):
            d.poll_once()
        self.assertEqual(d.status()['failures'], 1)
        self.assertTrue(d.status()['seeded'], 'a transient failure keeps the state')
        fake.fail = ValueError('bad row')
        with self.assertRaises(ValueError):
            d.poll_once()
        self.assertFalse(d.status()['seeded'], 'unexpected rows discard the state')
        fake.fail = None
        self.assertEqual(d.poll_once()[0], [{'kind': 'resync', 'reason': 'start'}])
        self.assertEqual(d.status()['failures'], 0)
        clock.now += 31
        self.assertEqual(d.poll_once()[0], [{'kind': 'resync', 'reason': 'start'}], 'an outage longer than the gap window')
        fake.ops[900] = (2, None)  # a large ID jump overflows the gaps
        self.assertEqual(d.poll_once()[0][-1], {'kind': 'resync', 'reason': 'gap-limit'})
        seeds = fake.seeds
        clock.now += 20
        d.poll_once()
        self.assertEqual(fake.seeds, seeds, 'no reseed before reseed_seconds')
        clock.now += d.reseed_seconds
        d.poll_once()
        self.assertEqual((fake.seeds, d.status()['complete']), (seeds + 1, True), 'an incomplete state reseeds')

    def test_a_reseed_keeps_unexpired_gaps_through_failures(self):
        """Codex P5.1 R2-1: a gap recorded at 55 (expiry 115) must survive the reseed at 60."""
        fake, clock = Fake({1: (7, None)}), Clock()
        d = detector(fake, clock, limits=Limits(tracked=1, gaps=4, gap_seconds=60))
        d.poll_once()
        clock.now = 55
        fake.ops.update({3: (2, None), 4: (2, None)})       # 2 is allocated but not committed
        self.assertEqual(d.poll_once()[0][-1], {'kind': 'resync', 'reason': 'active-limit'})
        clock.now = 57
        fake.ops.update({3: (7, None), 4: (7, None), **{i: None for i in range(5, 21)}})
        d.poll_once()                                        # 2 is now below any seed's lookback
        clock.now = 60
        fake.fail = OSError('network')
        with self.assertRaises(OSError):
            d.poll_once()
        self.assertEqual((d.status()['seeded'], d.status()['complete']), (True, False), 'a failed reseed keeps the state')
        fake.fail = None
        self.assertEqual(d.poll_once()[0], [{'kind': 'resync', 'reason': 'start'}])
        self.assertEqual((fake.carried[-1], d.status()['complete']), ([2], True))
        clock.now = 61
        fake.fail = ValueError('bad row')
        with self.assertRaises(ValueError):
            d.poll_once()
        fake.fail = None
        clock.now = 62
        d.poll_once()
        self.assertEqual(fake.carried[-1], [2], 'a state discarded for bad rows still hands over its gaps')
        fake.ops[2] = (2, None)
        clock.now = 63
        self.assertEqual(d.poll_once()[0], [{'kind': 'created', 'execution_id': '2', 'status': 2, 'ended_at': None}])

    def test_a_long_interval_is_not_mistaken_for_an_outage(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = Detector(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll, clock=clock, interval=120)
        d.poll_once()
        for _ in range(3):
            clock.now += 120
            d.poll_once()
        self.assertEqual(fake.seeds, 1)

    def test_backoff_doubles_from_the_interval_and_is_capped(self):
        self.assertEqual([backoff_delay(5, f, 60) for f in range(6)], [5, 10, 20, 40, 60, 60])
        self.assertEqual(backoff_delay(1, 10_000, 60), 60)

    def test_malformed_rows_of_any_shape_reseed_instead_of_repeating_the_same_poll(self):
        seeds, polls = [], []

        def seed(config, limits, carry=()):
            seeds.append(1)
            return [{'source': 0, 'execution_id': 5, 'status': None, 'end_time': None}]

        bad = {
            'no status': [{'source': 2, 'execution_id': 6, 'status': None, 'end_time': None},
                          {'source': 0, 'execution_id': 6, 'status': None, 'end_time': None}],
            'missing column': [{'source': 0, 'execution_id': 6}],
            'not a row': [None],
        }
        for name, rows in bad.items():
            with self.subTest(rows=name):
                seeds.clear()
                d = Detector(CONFIG, read_seed=seed, read_poll=lambda config, state, limits: (rows, state.tracked()))
                d.poll_once()
                with self.assertRaises((ValueError, TypeError, LookupError)):
                    d.poll_once()
                self.assertFalse(d.status()['seeded'], 'the state is discarded')
                d.poll_once()
                self.assertEqual(len(seeds), 2, 'the next cycle reseeds')

    def test_persistent_bad_polls_back_off_and_a_cleared_fault_recovers_after_the_cap(self):
        clock, calls, bad = Clock(), [], {'left': 6}

        def seed(config, limits, carry=()):
            clock.now += 0.5  # the read takes time
            calls.append(('seed', clock.now))
            return [{'source': 0, 'execution_id': 5, 'status': None, 'end_time': None}]

        def poll(config, state, limits):
            clock.now += 0.5
            calls.append(('poll', clock.now))
            if bad['left']:
                bad['left'] -= 1
                return [None], state.tracked()
            return [], state.tracked()

        d = Detector(CONFIG, interval=5, max_interval=60, read_seed=seed, read_poll=poll, clock=clock)
        waits = []

        def wait(delay):
            waits.append(delay)
            clock.now += delay
            return False

        d._stop.wait = wait
        d._stop.is_set = lambda: len(waits) >= 16
        d._loop()
        # seed, bad poll, seed, bad poll, ...: the wait after each bad poll doubles to the cap; each reseed is
        # followed by a poll at the normal interval, so the reseed never looks like an outage.
        self.assertEqual(waits[:12], [5, 10, 5, 20, 5, 40, 5, 60, 5, 60, 5, 60])
        self.assertEqual([kind for kind, _ in calls[:14]], ['seed', 'poll'] * 7)
        # The fault is gone after six bad polls: the seventh poll succeeds and polling continues without a reseed.
        self.assertEqual([kind for kind, _ in calls[12:]], ['seed', 'poll', 'poll', 'poll'])
        self.assertEqual(waits[12:], [5, 5, 5, 5])
        self.assertEqual((d._bad_polls, d.status()['failures'], d.status()['seeded']), (0, 0, True))

    def test_a_clean_poll_ends_the_failure_streak(self):
        fake = Fake({1: (2, None)})
        d = Detector(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll)
        d.poll_once()
        fake.fail = ValueError('bad row')
        with self.assertRaises(ValueError):
            d.poll_once()
        fake.fail = None
        d.poll_once()
        self.assertEqual((d.status()['failures'], d._bad_polls), (0, 1), 'the reseed keeps the bad-poll streak')
        d.poll_once()
        self.assertEqual(d._bad_polls, 0)
        fake.fail = OSError('network')
        with self.assertRaises(OSError):
            d.poll_once()
        self.assertEqual(d._bad_polls, 0, 'an outage is not a bad poll')

    def test_start_after_a_timed_out_stop_waits_for_the_old_thread_and_runs_again(self):
        release, entered = threading.Event(), threading.Event()

        def slow_seed(config, limits, carry=()):
            entered.set()
            release.wait(10)
            return [{'source': 0, 'execution_id': 5, 'status': None, 'end_time': None}]

        d = Detector(CONFIG, interval=1, read_seed=slow_seed, read_poll=lambda config, state, limits: ([], state.tracked()))
        self.assertTrue(d.start())
        self.assertTrue(entered.wait(5))
        self.assertFalse(d.stop(timeout=0.05), 'the read is still in flight')
        threading.Timer(0.2, release.set).start()
        self.assertTrue(d.start(), 'start waits for the stopping thread, then starts a new one')
        self.assertTrue(d.running)
        self.assertTrue(d.stop(timeout=5))

    def test_start_is_idempotent_and_stop_joins(self):
        fake = Fake({1: (2, None)})
        fake.fail = OSError('down')
        d = Detector(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll)
        self.assertTrue(d.start())
        self.assertFalse(d.start(), 'one thread per detector')
        self.assertTrue(d.stop(timeout=5))
        self.assertFalse(d.running)
        self.assertTrue(d.stop(timeout=1), 'stop is idempotent')
        self.assertTrue(d.start())
        self.assertTrue(d.stop(timeout=5))

    def test_the_reloader_watcher_process_never_starts_a_duplicate(self):
        app = create_app({'CHANGE_DETECTION_ENABLED': True})
        d = app.extensions['change_detector']
        d._read_seed, d._read_poll = Fake().read_seed, Fake().read_poll
        self.assertIsNone(start_for_process(app, reloader=True, environ={}))
        self.assertFalse(d.running)
        self.assertIs(start_for_process(app, reloader=True, environ={'WERKZEUG_RUN_MAIN': 'true'}), d)
        self.assertTrue(d.stop(timeout=5))
        self.assertIs(start_for_process(app, reloader=False, environ={}), d)
        self.assertTrue(d.stop(timeout=5))
        self.assertIsNone(start_for_process(create_app({}), reloader=False, environ={}))


class Running(Detector):
    """A detector whose thread counts as running, so health can be driven by poll_once and a fake clock."""
    running = property(lambda self: True)


class HealthTests(unittest.TestCase):
    """P5.2a: health is published with the cursor; only a poll after the latest seed makes it healthy."""

    def make(self, fake, clock, **kwargs):
        kwargs.setdefault('limits', Limits(gap_seconds=30))
        return Running(CONFIG, read_seed=fake.read_seed, read_poll=fake.read_poll, clock=clock, **kwargs)

    def test_a_seed_alone_is_not_healthy_and_a_poll_stays_fresh_for_the_bound(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = self.make(fake, clock, freshness=10)
        self.assertEqual(d.health(), {'healthy': False, 'running': True, 'stopping': False, 'seeded': False,
                                      'complete': False, 'poll_age': None, 'run': 0})
        d.poll_once()
        self.assertEqual((d.health()['seeded'], d.health()['complete'], d.health()['healthy']), (True, True, False))
        clock.now = 1
        d.poll_once()
        self.assertTrue(d.health()['healthy'])
        clock.now = 11
        self.assertEqual((d.health()['healthy'], d.health()['poll_age']), (True, 10))
        clock.now = 11.5
        self.assertFalse(d.health()['healthy'], 'no poll within the freshness bound')
        d.poll_once()
        self.assertTrue(d.health()['healthy'])
        with self.assertRaises(ValueError):
            Detector(CONFIG, interval=5, freshness=4)

    def test_a_reseed_after_a_bad_poll_waits_for_a_good_poll(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = self.make(fake, clock)
        d.poll_once()
        d.poll_once()
        self.assertTrue(d.health()['healthy'])
        fake.fail = OSError('network')
        with self.assertRaises(OSError):
            d.poll_once()
        self.assertTrue(d.health()['healthy'], 'a transient failure ages out by the freshness bound only')
        fake.fail = ValueError('bad row')
        with self.assertRaises(ValueError):
            d.poll_once()
        self.assertEqual((d.health()['seeded'], d.health()['healthy']), (False, False))
        fake.fail = None
        d.poll_once()
        self.assertEqual((d.status()['failures'], d.health()['seeded'], d.health()['healthy']), (0, True, False),
                         'the reseed clears failures but proves nothing about the next poll')
        d.poll_once()
        self.assertTrue(d.health()['healthy'])

    def test_an_incomplete_state_is_unhealthy_until_a_reseed_and_a_poll(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = self.make(fake, clock, limits=Limits(tracked=1, gap_seconds=30))
        d.poll_once()
        d.poll_once()
        fake.ops[2] = (2, None)
        events, _ = d.poll_once()
        self.assertEqual(events[-1], {'kind': 'resync', 'reason': 'active-limit'})
        self.assertEqual((d.health()['complete'], d.health()['healthy']), (False, False))
        fake.ops.update({1: (7, None), 2: (7, None)})
        clock.now += d.reseed_seconds
        d.poll_once()
        self.assertEqual((d.health()['complete'], d.health()['healthy']), (True, False), 'reseeded, no poll yet')
        d.poll_once()
        self.assertTrue(d.health()['healthy'])

    def test_read_with_health_returns_the_cursor_and_health_together(self):
        fake, clock = Fake({1: (2, None)}), Clock()
        d = self.make(fake, clock)
        start = d.read_with_health(None)
        self.assertEqual((start['resync'], start['health']['healthy']), (True, False))
        d.poll_once()
        d.poll_once()
        result = d.read_with_health(start['next'])
        self.assertEqual(([e['kind'] for e in result['events']], seq(result['next']), result['health']['healthy']),
                         (['resync'], 1, True))
        self.assertNotIn('health', d.read(start['next']), 'read() keeps its shape')

    def test_a_stop_in_progress_is_unhealthy_and_reads_return_at_once(self):
        # Codex round 2 of the P5.2 record: a stop that times out while a poll is in flight must not look healthy.
        fake, entered, release = Fake({1: (2, None)}), threading.Event(), threading.Event()
        d = Detector(CONFIG, interval=1, read_seed=fake.read_seed, read_poll=fake.read_poll)
        self.assertTrue(d.start())
        for _ in range(200):
            if d.health()['healthy']:
                break
            threading.Event().wait(0.02)
        self.assertTrue(d.health()['healthy'])
        cursor = d.read(None)['next']

        def block():
            entered.set()
            release.wait(10)
        fake.on_poll = block
        self.assertTrue(entered.wait(5))
        self.assertFalse(d.stop(timeout=0))
        began = time.monotonic()
        result = d.read_with_health(cursor, timeout=2)
        self.assertLess(time.monotonic() - began, 1)
        self.assertEqual((result['events'], result['health']['running'], result['health']['stopping'],
                          result['health']['healthy']), ([], True, True, False))
        release.set()
        self.assertTrue(d.stop(timeout=5))
        self.assertEqual((d.health()['running'], d.health()['healthy'], d.health()['poll_age']), (False, False, None),
                         'the poll that finished after stop() is not counted')
        run = d.health()['run']
        fake.on_poll = lambda: time.sleep(0.3)
        self.assertTrue(d.start())
        self.assertEqual((d.health()['run'], d.health()['poll_age'], d.health()['healthy']), (run + 1, None, False))
        self.assertTrue(d.stop(timeout=5))

    def test_stop_wakes_a_waiting_reader_and_a_restart_needs_a_new_poll(self):
        fake = Fake({1: (2, None)})
        d = Detector(CONFIG, interval=1, read_seed=fake.read_seed, read_poll=fake.read_poll)
        self.assertTrue(d.start())
        for _ in range(200):
            if d.health()['healthy']:
                break
            time.sleep(0.02)
        cursor = d.read(None)['next']
        result, waiting = {}, threading.Event()

        def reader():
            waiting.set()
            result.update(d.read_with_health(cursor, timeout=10))
        thread = threading.Thread(target=reader)
        thread.start()
        waiting.wait(5)
        time.sleep(0.2)                                    # the reader is inside the condition wait
        began = time.monotonic()
        self.assertTrue(d.stop(timeout=5))
        thread.join(5)
        self.assertLess(time.monotonic() - began, 3)
        self.assertEqual((result['events'], result['health']['stopping'], result['health']['healthy']), ([], True, False))
        fake.on_poll = lambda: time.sleep(0.3)
        self.assertTrue(d.start())
        self.assertEqual((d.health()['stopping'], d.health()['poll_age'], d.health()['healthy']), (False, None, False),
                         'a restart is not healthy on the previous run\'s poll')
        self.assertTrue(d.stop(timeout=5))


class RunserverTests(unittest.TestCase):
    """FLASK_DEBUG must decide both the reloader and the detector guard (Codex P5.1 R1-5)."""

    def serve(self, env, app_debug=False):
        import os
        from unittest import mock
        import runserver
        app = create_app({'CHANGE_DETECTION_ENABLED': True, 'DEBUG': app_debug})
        d = app.extensions['change_detector']
        d._read_seed, d._read_poll = Fake().read_seed, Fake().read_poll
        calls, exits = [], []
        with mock.patch.dict(os.environ, env, clear=False):
            if 'FLASK_DEBUG' not in env:
                os.environ.pop('FLASK_DEBUG', None)
            started = runserver.serve(app, env=env, run=lambda *a, **k: calls.append(k), register_exit=exits.append)
        if started is not None:
            self.assertTrue(started.stop(timeout=5))
        return started, calls[0], exits

    def test_flask_debug_in_the_watcher_process_starts_no_detector_and_enables_the_reloader(self):
        started, run, exits = self.serve({'FLASK_DEBUG': '1'})
        self.assertIsNone(started)
        self.assertEqual((run['debug'], run['use_reloader'], exits), (True, True, []))

    def test_the_reloader_child_or_a_plain_run_starts_exactly_one(self):
        started, run, exits = self.serve({'FLASK_DEBUG': '1', 'WERKZEUG_RUN_MAIN': 'true'})
        self.assertIsNotNone(started)
        self.assertEqual(len(exits), 1)
        started, run, _ = self.serve({}, app_debug=False)
        self.assertIsNotNone(started)
        self.assertEqual((run['debug'], run['use_reloader']), (False, False))
        started, run, _ = self.serve({'FLASK_DEBUG': '0'}, app_debug=True)
        self.assertIsNotNone(started, 'FLASK_DEBUG=0 overrides a debug config, as app.run does')
