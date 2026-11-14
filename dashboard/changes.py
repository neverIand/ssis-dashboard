"""SSISDB change detection state (P5.1a): which executions appeared or changed between polls.

Execution IDs are operation IDs: deployments, validations and other operations share the sequence.
The high-water mark is therefore an operation ID. A seed read takes it, the active executions and
the committed IDs among the newest operation IDs. Each poll reads, in one bounded query, the next
operation IDs above the mark (at most a page), the executions among them, and a capped list of
tracked IDs: active executions, whose status and end time can still change, and ID gaps — IDs below
the mark that no visible operation holds yet, because a lower ID can commit after a higher one.

Notifications carry only an execution ID, status code and end time; never names, messages or values.
Whatever this state cannot follow exactly becomes an explicit `resync` and marks the state
incomplete, so a consumer reloads instead of trusting a partial change set. A reseed keeps the
unexpired gaps of the state it replaces; after a gap overflow, a new state stays incomplete until the
untracked IDs are past their gap window. Terminal executions are assumed not to change again.
"""

from dataclasses import dataclass

from dashboard import serialization as wire
from dashboard.db import execute_query
from dashboard.observability import record_query

# created, running, pending, stopping: statuses that SSIS still moves to another state.
ACTIVE_STATUSES = frozenset({1, 2, 5, 8})
_BIGINT_MAX = 2 ** 63 - 1


@dataclass(frozen=True)
class Limits:
    """Bounds for one poll; validated so a misconfiguration fails at construction."""
    new_rows: int = 200       # operation IDs read above the mark per page
    tracked: int = 256        # active executions followed
    gaps: int = 256           # unresolved ID gaps followed
    gap_seconds: float = 60.0

    def __post_init__(self):
        for name in ('new_rows', 'tracked', 'gaps'):
            value = getattr(self, name)
            if type(value) is not int or not 1 <= value <= 1000:
                raise ValueError(f'{name} must be an integer from 1 to 1000.')
        if not isinstance(self.gap_seconds, (int, float)) or isinstance(self.gap_seconds, bool) \
                or not 1 <= self.gap_seconds <= 3600:
            raise ValueError('gap_seconds must be from 1 to 3600.')


def _event(kind, execution_id=None, status=None, end_time=None, reason=None):
    event = {'kind': kind}
    if execution_id is not None:
        event.update(execution_id=wire.bigint(execution_id), status=status,
                     ended_at=wire.utc_timestamp(end_time))
    if reason is not None:
        event['reason'] = reason
    return event


def _identifier(value):
    if type(value) is not int or not 1 <= value <= _BIGINT_MAX:
        raise ValueError('Invalid change-detection ID.')
    return value


def _rows(rows):
    """Split and validate a result; anything unexpected fails closed (the detector then reseeds)."""
    split = {0: [], 1: [], 2: []}
    for row in rows:
        source = row['source']
        if source not in split:
            raise ValueError('Invalid change-detection source.')
        if source == 2 or (source == 0 and row['status'] is None):
            split[source].append(row['execution_id'])
            continue
        wire.execution_status(row['status'])
        split[source].append((_identifier(row['execution_id']), (row['status'], row['end_time'])))
    return split


class ChangeState:
    """Pure state: no I/O, no clock. Callers pass query rows and a monotonic `now` in seconds."""

    def __init__(self, limits=Limits()):
        self.limits = limits
        self.high = None          # highest operation ID read; None until seeded
        self.active = {}          # execution ID -> (status, end time)
        self.gaps = {}            # ID -> expiry (monotonic seconds)
        self.complete = False     # False after an overflow, until the next seed
        self.blind_until = None   # after a gap overflow: untracked IDs may commit until then

    @property
    def seeded(self):
        return self.high is not None

    def _add_gaps(self, previous, top, present, now):
        """Record IDs in (previous, top) that hold no visible operation. Returns False on overflow."""
        missing = (top - previous - 1) - sum(1 for i in present if previous < i < top)
        if missing <= 0:
            return True
        if missing + len(self.gaps) > self.limits.gaps:
            self._blind(now)
            return False
        for execution_id in range(previous + 1, top):
            if execution_id not in present:
                self.gaps[execution_id] = now + self.limits.gap_seconds
        return True

    def _blind(self, now):
        self.blind_until = max(self.blind_until or now, now + self.limits.gap_seconds)

    def can_complete(self, now):
        """Whether a reseed now can restore an exact state (no untracked gap is still owed)."""
        return self.blind_until is None or now >= self.blind_until

    def carry(self, now):
        """Gaps a reseed must keep following: those whose final read is still to come."""
        return {i: expiry for i, expiry in self.gaps.items() if expiry > now}

    def _incomplete(self, reason, events):
        if self.complete:
            self.complete = False
            events.append(_event('resync', reason=reason))

    def seed(self, rows, now, previous=None):
        """Start (or restart) from a seed read. Consumers must reload: the only event is `resync`.
        `previous` is the state being replaced: its unexpired gaps (`carry`, sent to the seed query)
        stay followed. Its gap overflow, or a mark that moved past the lookback since its own mark,
        keeps this state incomplete until `blind_until`."""
        carry = previous.carry(now) if previous is not None else {}
        split = _rows(rows)
        if len(split[0]) != 1:
            raise ValueError('The seed must return one high-water row.')
        high = split[0][0]
        high = 0 if high is None else _identifier(high)
        window = {_identifier(i) for i in split[2]}
        actives = split[1]
        if (any(value[0] not in ACTIVE_STATUSES or i > high for i, value in actives)
                or len({i for i, _ in actives}) != len(actives)
                or any(i > high or not (i > high - self.limits.gaps or i in carry) for i in window)):
            raise ValueError('Inconsistent change-detection seed.')
        actives.sort(reverse=True)
        self.high = high
        self.active = dict(actives[:self.limits.tracked])
        # IDs just below the mark that no operation holds yet may still commit; so may carried gaps.
        # The query reads the committed IDs before the actives, so an execution that committed in
        # between is missing from `window` but active: it is followed as active, not as a gap.
        seen = window | {i for i, _ in actives}
        gaps = {i: now + self.limits.gap_seconds
                for i in range(max(0, high - self.limits.gaps) + 1, high) if i not in seen}
        for i, expiry in carry.items():
            if i <= high and i not in seen:
                gaps[i] = max(expiry, gaps.get(i, expiry))
        blind = previous.blind_until if previous is not None else None
        self.blind_until = blind if blind is not None and blind > now else None
        if previous is not None and previous.seeded and previous.high < high - self.limits.gaps:
            # IDs between the previous mark and the lookback were never examined; they may commit.
            self._blind(now)
        if len(gaps) > self.limits.gaps:
            gaps = dict(sorted(gaps.items())[-self.limits.gaps:])
            self._blind(now)
        self.gaps = gaps
        reason = 'start'
        if self.blind_until is not None:
            reason = 'gap-limit'
        if len(actives) > self.limits.tracked:
            reason = 'active-limit'
        self.complete = reason == 'start'
        return [_event('resync', reason=reason)]

    def tracked(self):
        """IDs to re-read this poll: every tracked active execution and every unexpired gap."""
        return sorted(self.active) + sorted(self.gaps)

    def apply(self, rows, requested, now):
        """Turn one poll result into events. Returns (events, more): more means the page was full
        and the caller should read the next one."""
        if not self.seeded:
            raise RuntimeError('Seed the change state before applying a poll.')
        requested = set(requested)
        split = _rows(rows)
        if any(type(item) is not tuple for item in split[0]):
            # Only the seed's high-water row may lack a status.
            raise ValueError('A window execution has no status.')
        window = sorted(_identifier(i) for i in split[2])
        if len(set(window)) != len(window) or (window and window[0] <= self.high):
            raise ValueError('Invalid operation window.')
        more = len(window) > self.limits.new_rows
        window = window[:self.limits.new_rows]
        present = set(window)
        top = window[-1] if window else self.high
        new, tracked = [], {}
        for execution_id, value in split[0]:
            if execution_id not in present and not (more and execution_id > top):
                raise ValueError('A new execution is outside the operation window.')
            if execution_id <= top:
                new.append((execution_id, value))
        for execution_id, value in split[1]:
            if execution_id > self.high or execution_id not in requested or execution_id in tracked:
                raise ValueError('An unrequested or duplicate tracked execution was returned.')
            tracked[execution_id] = value
        new.sort()
        if len({i for i, _ in new}) != len(new):
            raise ValueError('Duplicate new execution.')
        events = []
        for execution_id in sorted(self.active):
            if execution_id not in requested:
                continue
            value = tracked.get(execution_id)
            if value is None:
                # Deleted by retention or no longer visible to this SQL identity.
                del self.active[execution_id]
                events.append(_event('removed', execution_id))
            elif value != self.active[execution_id]:
                events.append(_event('changed', execution_id, *value))
                if value[0] in ACTIVE_STATUSES:
                    self.active[execution_id] = value
                else:
                    del self.active[execution_id]
        for execution_id in sorted(self.gaps):
            value = tracked.get(execution_id)
            if execution_id in requested and value is not None:
                # A lower ID that committed after a higher one.
                del self.gaps[execution_id]
                events.append(_event('created', execution_id, *value))
                if value[0] in ACTIVE_STATUSES:
                    self.active[execution_id] = value
            elif execution_id in requested and self.gaps[execution_id] <= now:
                # Its final re-read has happened; stop following it.
                del self.gaps[execution_id]
        for execution_id, value in new:
            events.append(_event('created', execution_id, *value))
            if value[0] in ACTIVE_STATUSES:
                self.active[execution_id] = value
        if window:
            if not self._add_gaps(self.high, top, present, now):
                self._incomplete('gap-limit', events)
            self.high = top
        if len(self.active) > self.limits.tracked:
            for execution_id in sorted(self.active)[:len(self.active) - self.limits.tracked]:
                del self.active[execution_id]
            self._incomplete('active-limit', events)
        return events, more


def seed_parameters(limits, carry=()):
    """Bindings of detector-seed.sql, shared with the native SQL test."""
    return (limits.tracked, limits.gaps, tracked_xml(sorted(carry)))


def poll_parameters(state, limits, requested):
    """Bindings of detector-poll.sql, shared with the native SQL test."""
    return (state.high, limits.new_rows, tracked_xml(requested))


def read_seed(config, limits, carry=()):
    """The seed query; `carry` is the replaced state's unexpired gap IDs (at most limits.gaps)."""
    return execute_query(
        'detector-seed.sql', seed_parameters(limits, carry), connection_string=config['CONNECTION_STRING']['main'],
        login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
        typed_timestamps=True, declared_parameters=True, on_complete=record_query)


def tracked_xml(ids):
    """Integers only, so the XML cannot carry markup from anywhere else."""
    if any(type(i) is not int or not 1 <= i <= _BIGINT_MAX for i in ids):
        raise ValueError('Tracked IDs must be positive BIGINT values.')
    return '<t>' + ''.join(f'<i>{i}</i>' for i in ids) + '</t>'


def read_poll(config, state, limits):
    """One bounded poll query. Returns (rows, requested IDs)."""
    requested = state.tracked()
    rows = execute_query(
        'detector-poll.sql', poll_parameters(state, limits, requested),
        connection_string=config['CONNECTION_STRING']['main'],
        login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
        typed_timestamps=True, declared_parameters=True, on_complete=record_query)
    return rows, requested
