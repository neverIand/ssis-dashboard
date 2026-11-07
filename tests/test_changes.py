"""P5.1a change-detection state: scenarios plus a randomized replica oracle (no database).

The model is a catalog of operations: each ID holds either an execution (status, end time) or None
for another operation type. `seed_rows`/`poll_rows` reproduce the two SQL resources' row semantics.
A consumer replica of the executions starts from a snapshot and applies every event (`resync`
reloads); after each poll it must equal the visible executions. The native test checks real SQL.
"""
import random
import unittest
from datetime import datetime, timedelta, timezone

from dashboard.changes import ACTIVE_STATUSES, ChangeState, Limits, tracked_xml

T0 = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
TERMINAL = (3, 4, 6, 7, 9)


def executions(ops):
    return {i: v for i, v in ops.items() if v is not None}


def seed_rows(ops, limits, carry=()):
    high = max(ops, default=None)
    actives = sorted((i for i, v in ops.items() if v is not None and v[0] in ACTIVE_STATUSES), reverse=True)
    rows = [{'source': 0, 'execution_id': high, 'status': None, 'end_time': None}]
    rows += [{'source': 1, 'execution_id': i, 'status': ops[i][0], 'end_time': ops[i][1]}
             for i in actives[:limits.tracked + 1]]
    if high is not None:
        rows += [{'source': 2, 'execution_id': i, 'status': None, 'end_time': None}
                 for i in ops if i > high - limits.gaps]
        rows += [{'source': 2, 'execution_id': i, 'status': None, 'end_time': None}
                 for i in set(carry) if i in ops and i <= high - limits.gaps]
    return rows


def reseed(state, ops, limits, now):
    """What the detector does: a fresh state seeded with the replaced state's unexpired gaps."""
    fresh = ChangeState(limits)
    return fresh, fresh.seed(seed_rows(ops, limits, state.carry(now)), now, state)


def poll_rows(ops, after, requested, limits):
    window = sorted(i for i in ops if i > after)[:limits.new_rows + 1]
    rows = [{'source': 2, 'execution_id': i, 'status': None, 'end_time': None} for i in window]
    rows += [{'source': 0, 'execution_id': i, 'status': ops[i][0], 'end_time': ops[i][1]}
             for i in window if ops[i] is not None]
    return rows + [{'source': 1, 'execution_id': i, 'status': ops[i][0], 'end_time': ops[i][1]}
                   for i in set(requested) if ops.get(i) is not None and i <= after]


class Consumer:
    def __init__(self, ops):
        self.replica, self.reloads = executions(ops), 0

    def apply(self, events, ops):
        for event in events:
            if event['kind'] == 'resync':
                self.replica, self.reloads = executions(ops), self.reloads + 1
                continue
            key = int(event['execution_id'])
            if event['kind'] == 'removed':
                self.replica.pop(key, None)
            else:
                ended = event['ended_at']
                self.replica[key] = (event['status'], None if ended is None else
                                     datetime.fromisoformat(ended.replace('Z', '+00:00')))


def run_poll(state, ops, limits, now, consumer):
    events = []
    while True:
        requested = state.tracked()
        page, more = state.apply(poll_rows(ops, state.high, requested, limits), requested, now)
        consumer.apply(page, ops)
        events += page
        if not more:
            return events


class ChangeStateScenarios(unittest.TestCase):
    def setUp(self):
        self.limits = Limits(new_rows=3, tracked=4, gaps=8, gap_seconds=30)
        # 3 is a deployment (no execution); 5 is allocated but not yet committed.
        self.ops = {1: (7, T0), 2: (2, None), 3: None, 4: (4, T0), 6: (7, T0)}
        self.state = ChangeState(self.limits)
        self.consumer = Consumer(self.ops)
        self.assertEqual(self.state.seed(seed_rows(self.ops, self.limits), 0),
                         [{'kind': 'resync', 'reason': 'start'}])

    def poll(self, now=0):
        return run_poll(self.state, self.ops, self.limits, now, self.consumer)

    def test_seed_tracks_actives_the_operation_high_water_and_its_missing_ids(self):
        self.assertEqual((self.state.high, list(self.state.active), sorted(self.state.gaps)), (6, [2], [5]))
        self.assertTrue(self.state.complete)

    def test_a_late_commit_just_below_the_seed_high_water_is_reported(self):
        self.ops[5] = (2, None)
        self.assertEqual(self.poll(), [{'kind': 'created', 'execution_id': '5', 'status': 2, 'ended_at': None}])

    def test_new_executions_transitions_and_other_operations(self):
        self.ops.update({7: None, 8: (1, None)})
        self.assertEqual(self.poll(), [{'kind': 'created', 'execution_id': '8', 'status': 1, 'ended_at': None}])
        self.assertEqual(self.state.high, 8, 'the mark moves past the deployment at 7')
        self.ops[8] = (2, None)
        self.ops[2] = (7, T0 + timedelta(seconds=9))
        events = self.poll()
        self.assertEqual([(e['kind'], e['execution_id'], e['status']) for e in events], [('changed', '2', 7), ('changed', '8', 2)])
        self.assertEqual(events[0]['ended_at'], '2026-11-07T12:00:09.0000000Z')
        self.assertEqual(self.poll(), [], 'unchanged polls are silent')
        self.assertEqual(self.consumer.replica, executions(self.ops))

    def test_a_gap_is_read_one_last_time_when_it_expires(self):
        self.ops[5] = (1, None)
        self.assertEqual([e['execution_id'] for e in self.poll(now=30)], ['5'], 'expiry 30: read at 30, then dropped')
        self.ops[9] = None
        self.poll(now=31)
        self.assertEqual(sorted(self.state.gaps), [7, 8])
        self.poll(now=61)
        self.assertEqual(sorted(self.state.gaps), [], 'expired gaps go after their final read')
        self.ops[7] = (2, None)
        self.assertEqual(self.poll(now=62), [], 'an ID that commits after its gap expired is not seen')

    def test_removed_active_execution_is_reported(self):
        del self.ops[2]
        self.assertEqual(self.poll(), [{'kind': 'removed', 'execution_id': '2', 'status': None, 'ended_at': None}])

    def test_a_burst_pages_and_large_id_jumps_resync_instead_of_dropping_gaps_silently(self):
        for i in range(10, 18):
            self.ops[i] = (7, T0)
        self.poll()
        self.assertEqual((self.state.high, self.consumer.replica), (17, executions(self.ops)))
        self.ops[600] = (2, None)   # 582 IDs are allocated below it and could still commit
        events = self.poll()
        self.assertEqual(events[-1], {'kind': 'resync', 'reason': 'gap-limit'})
        self.assertFalse(self.state.complete)
        self.assertEqual(self.state.high, 600)
        self.ops[601] = (2, None)
        self.assertNotIn('resync', [e['kind'] for e in self.poll()], 'the resync is not repeated')

    def test_active_overflow_resyncs_once_and_reports_incomplete(self):
        for i in range(7, 11):
            self.ops[i] = (2, None)
        events = self.poll()
        self.assertEqual(events[-1], {'kind': 'resync', 'reason': 'active-limit'})
        self.assertFalse(self.state.complete)
        self.assertEqual(len(self.state.active), 4)
        state = ChangeState(self.limits)
        self.assertEqual(state.seed(seed_rows(self.ops, self.limits), 0), [{'kind': 'resync', 'reason': 'active-limit'}])

    def test_a_reseed_keeps_following_unexpired_gaps(self):
        self.ops[7] = (2, None)                 # 5 stays a gap (expiry 30)
        self.poll(now=0)
        for i in range(8, 20):
            self.ops[i] = None                  # deployments: 5 falls below the next seed's lookback
        self.poll(now=5)
        self.ops[3] = (4, T0)                   # not a gap: committed IDs are never carried
        state, events = reseed(self.state, self.ops, self.limits, 10)
        self.assertEqual((events, state.gaps), ([{'kind': 'resync', 'reason': 'start'}], {5: 30}))
        self.ops[5] = (2, None)
        self.assertEqual([e['execution_id'] for e in run_poll(state, self.ops, self.limits, 11, self.consumer)], ['5'])
        state.gaps[6] = 40                      # a carried gap that committed before the reseed
        fresh, _ = reseed(state, self.ops, self.limits, 12)
        self.assertNotIn(6, fresh.gaps, 'already in the reload, so not reported again')
        self.assertEqual(reseed(fresh, self.ops, self.limits, 50)[0].gaps, {}, 'expired gaps are not carried')

    def test_after_a_gap_overflow_or_a_jump_a_reseed_stays_incomplete_for_a_gap_window(self):
        self.ops[600] = (2, None)
        self.poll(now=10)
        self.assertEqual((self.state.complete, self.state.blind_until), (False, 40))
        self.assertFalse(self.state.can_complete(39))
        state, events = reseed(self.state, self.ops, self.limits, 20)
        self.assertEqual((events, state.complete), ([{'kind': 'resync', 'reason': 'gap-limit'}], False))
        self.assertTrue(state.can_complete(40))
        state, events = reseed(state, self.ops, self.limits, 40)
        self.assertEqual((events, state.complete, state.blind_until), ([{'kind': 'resync', 'reason': 'start'}], True, None))
        for i in range(601, 620):
            self.ops[i] = None                  # not yet polled: the next seed's lookback starts above 600
        state, events = reseed(state, self.ops, self.limits, 45)
        self.assertEqual((events, state.blind_until), ([{'kind': 'resync', 'reason': 'gap-limit'}], 75),
                         'IDs between the previous mark and the lookback were never examined')

    def test_the_seed_rejects_rows_above_its_mark_or_outside_its_ranges(self):
        rows = seed_rows(self.ops, self.limits)
        for extra in ({'source': 1, 'execution_id': 9, 'status': 2, 'end_time': None},
                      {'source': 2, 'execution_id': 9, 'status': None, 'end_time': None}):
            with self.assertRaises(ValueError):
                ChangeState(self.limits).seed(rows + [extra], 0)
        ops = {**self.ops, 30: None}
        with self.assertRaises(ValueError, msg='an ID below the lookback that was not carried'):
            ChangeState(self.limits).seed(seed_rows(ops, self.limits, [1]), 0)

    def test_an_execution_that_commits_between_the_seed_reads_is_followed_as_active(self):
        rows = [r for r in seed_rows({**self.ops, 5: (2, None)}, self.limits)
                if not (r['source'] == 2 and r['execution_id'] == 5)]   # the window read missed 5
        state = ChangeState(self.limits)
        state.seed(rows, 0)
        self.assertEqual((sorted(state.active), sorted(state.gaps)), ([2, 5], []))

    def test_empty_catalog_seed(self):
        state = ChangeState(self.limits)
        self.assertEqual(state.seed(seed_rows({}, self.limits), 0), [{'kind': 'resync', 'reason': 'start'}])
        self.assertEqual((state.high, state.gaps), (0, {}))

    def test_invalid_rows_fail_closed(self):
        requested = self.state.tracked()
        for rows in ([{'source': 2, 'execution_id': 6, 'status': None, 'end_time': None}],
                     [{'source': 0, 'execution_id': 9, 'status': 2, 'end_time': None}],
                     [{'source': 1, 'execution_id': 1, 'status': 7, 'end_time': T0}],
                     [{'source': 3, 'execution_id': 9, 'status': 2, 'end_time': None}],
                     [{'source': 2, 'execution_id': 9, 'status': None, 'end_time': None},
                      {'source': 0, 'execution_id': 9, 'status': 'x', 'end_time': None}]):
            with self.assertRaises(ValueError):
                ChangeState.apply(self.state, rows, requested, 0)
        with self.assertRaises(RuntimeError):
            ChangeState(self.limits).apply([], [], 0)

    def test_tracked_xml_accepts_only_bigint_ids_and_limits_validate(self):
        self.assertEqual(tracked_xml([1, 22]), '<t><i>1</i><i>22</i></t>')
        for ids in ([0], ['1'], [True], [2 ** 63]):
            with self.assertRaises(ValueError):
                tracked_xml(ids)
        for bad in ({'new_rows': 0}, {'tracked': 1001}, {'gaps': True}, {'gap_seconds': 0}):
            with self.assertRaises(ValueError):
                Limits(**bad)


class RandomizedReplicaOracle(unittest.TestCase):
    """Random operations and mutations; the replica must equal the visible executions."""

    def test_replica_matches_the_catalog_after_every_poll(self):
        total_reseeds = 0
        for seed in range(80):
            rng = random.Random(seed)
            limits = Limits(new_rows=rng.choice([1, 2, 5]), tracked=rng.choice([3, 50]), gaps=8, gap_seconds=30)
            ops, next_id = {}, 0
            # (ID, value, commit step): allocated IDs that commit late, at most 30 s (the gap window,
            # 6 polls of 5 s) after allocation; some are allocated before the seed.
            pending = []
            for _ in range(rng.randint(0, 12)):
                next_id += 1
                value = rng.choice([None, (2, None), (1, None)] + [(s, T0) for s in TERMINAL])
                if rng.random() < 0.25:
                    pending.append((next_id, value, rng.randint(0, 6)))
                else:
                    ops[next_id] = value
            # The seed looks back `gaps` IDs below its high-water mark; older IDs are outside the bound.
            for item in [p for p in pending if p[0] <= max(ops, default=0) - limits.gaps]:
                pending.remove(item)
                ops[item[0]] = item[1]
            state = ChangeState(limits)
            consumer = Consumer(ops)
            consumer.apply(state.seed(seed_rows(ops, limits), 0), ops)
            reseeds = 0
            for step in range(40):
                now = step * 5
                for item in [p for p in pending if p[2] <= step]:  # commit before this step's poll
                    pending.remove(item)
                    ops[item[0]] = item[1]
                for _ in range(rng.randint(0, 4)):
                    action = rng.random()
                    actives = [i for i, v in ops.items() if v is not None and v[0] in ACTIVE_STATUSES]
                    if action < 0.45:
                        # One new ID, or a burst that pushes older gaps below a reseed's lookback.
                        for _ in range(1 if action < 0.35 else rng.randint(4, 12)):
                            next_id += 1
                            value = rng.choice([None, None, (1, None), (2, None), (7, T0), (4, T0)])
                            if rng.random() < 0.3:
                                pending.append((next_id, value, step + rng.randint(1, 6)))
                            else:
                                ops[next_id] = value
                    elif action < 0.8 and actives:
                        status = rng.choice((2, 5, 8) + TERMINAL)
                        ops[rng.choice(actives)] = (status, None if status in ACTIVE_STATUSES else T0 + timedelta(seconds=step))
                    elif actives:
                        del ops[rng.choice(actives)]
                if not state.complete and state.can_complete(now):
                    # As the detector does: reseed (keeping unexpired gaps) to regain an exact state.
                    state, events = reseed(state, ops, limits, now)
                    consumer.apply(events, ops)
                    reseeds += 1
                else:
                    run_poll(state, ops, limits, now, consumer)
                if not state.complete:
                    # After an overflow resync the change set is best effort; consumers reload.
                    consumer.replica = executions(ops)
                with self.subTest(seed=seed, step=step):
                    self.assertEqual(consumer.replica, executions(ops))
            total_reseeds += reseeds
        self.assertGreater(total_reseeds, 50, 'incomplete states are reseeded and must then stay exact')
