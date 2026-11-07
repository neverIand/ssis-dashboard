"""P5.1c: one owned, in-process SSISDB change detector.

A single background thread seeds, then polls at a fixed interval with capped backoff after failures.
Each poll opens and closes its own connection through execute_query; nothing holds a connection
between polls or per subscriber. A cycle reads at most MAX_PAGES pages and publishes each page as it
goes; a backlog continues on the next cycle without waiting. Events go into a bounded log with
increasing sequence numbers. Subscribers hold an opaque cursor, `<generation>:<sequence>`, where the
generation is random per detector instance; they read the events after it, or are told to resync
when it is from another instance or has been trimmed. Disabled by default; nothing streams the log
yet (P5.2 transport is deferred).
"""

from collections import deque
import logging
import os
import re
import secrets
import threading
import time

from dashboard import changes
from dashboard.observability import log_event

MAX_PAGES = 5
_CURSOR = re.compile(r'([0-9a-f]{16}):([0-9]{1,18})')


def backoff_delay(interval, failures, maximum):
    """Seconds to wait after `failures` consecutive failures: doubling from the interval, capped."""
    if failures <= 0:
        return interval
    return min(maximum, interval * 2 ** min(failures, 16))


def default_limits(interval):
    """Gaps stay followed for at least three polls, so a normal wait never looks like an outage."""
    return changes.Limits(gap_seconds=float(min(3600, max(60, 3 * interval))))


class Detector:
    def __init__(self, config, *, app=None, limits=None, interval=None, max_interval=60.0, log_size=1000,
                 read_seed=changes.read_seed, read_poll=changes.read_poll, clock=time.monotonic):
        self.config = config
        self._app = app  # the thread logs through this application's logger
        self.interval = float(interval if interval is not None else config['CHANGE_DETECTION_INTERVAL_SECONDS'])
        self.limits = limits or default_limits(self.interval)
        if self.limits.gap_seconds < 2 * self.interval:
            raise ValueError('gap_seconds must cover at least two poll intervals.')
        self.max_interval = max(self.interval, float(max_interval))
        # While incomplete (an overflow), reseed at most this often to regain an exact state.
        self.reseed_seconds = max(60.0, self.limits.gap_seconds)
        self._last_seed = None
        if type(log_size) is not int or not 1 <= log_size <= 100_000:
            raise ValueError('log_size must be an integer from 1 to 100000.')
        self._read_seed, self._read_poll, self._clock = read_seed, read_poll, clock
        self._state = changes.ChangeState(self.limits)
        self._previous = None  # a discarded state whose gaps the next seed still follows
        self._generation = secrets.token_hex(8)
        self._log = deque(maxlen=log_size)
        self._sequence = 0
        self._changed = threading.Condition()
        self._stop = threading.Event()
        self._thread = None
        self._failures = 0
        self._last_success = None
        self._lifecycle = threading.Lock()

    # --- lifecycle -------------------------------------------------------------------------------
    def start(self):
        """Start the polling thread once. Returns False if it is already running."""
        with self._lifecycle:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name='ssis-change-detector', daemon=True)
            self._thread.start()
            return True

    def stop(self, timeout=None):
        """Ask the thread to stop and wait for it. Returns True once it has exited."""
        with self._lifecycle:
            thread = self._thread
            self._stop.set()
            with self._changed:
                self._changed.notify_all()
            if thread is None:
                return True
            thread.join(self.config['DB_QUERY_TIMEOUT_SECONDS'] + self.config['DB_LOGIN_TIMEOUT_SECONDS'] + 1
                        if timeout is None else timeout)
            if not thread.is_alive():
                self._thread = None
            return self._thread is None

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    # --- polling ---------------------------------------------------------------------------------
    def poll_once(self):
        """One cycle: a seed, or up to MAX_PAGES poll pages, each published as soon as it is read.
        Returns (events, more); more means a backlog remains for the next cycle."""
        now = self._clock()
        state = self._state
        reseed = (not state.seeded
                  # After an outage longer than the gap window, late commits may have been missed.
                  or (self._last_success is not None and now - self._last_success > self.limits.gap_seconds)
                  # Regain an exact state, once no untracked gap can still commit.
                  or (not state.complete and now - self._last_seed >= self.reseed_seconds
                      and state.can_complete(now)))
        published, more = [], False
        try:
            if reseed:
                # The replaced state's unexpired gaps are re-read by the seed and kept. The state is
                # swapped only after a successful seed, so a failed one loses nothing.
                previous = state if state.seeded else self._previous
                carry = previous.carry(now) if previous is not None else {}
                fresh = changes.ChangeState(self.limits)
                events = fresh.seed(self._read_seed(self.config, self.limits, sorted(carry)), now, previous)
                self._state, self._previous, self._last_seed = fresh, None, now
                self._publish(events)
                published += events
            else:
                for _ in range(MAX_PAGES):
                    rows, requested = self._read_poll(self.config, state, self.limits)
                    events, more = state.apply(rows, requested, now)
                    self._publish(events)
                    published += events
                    if not more or self._stop.is_set():
                        break
        except Exception as error:
            self._failures += 1
            if isinstance(error, ValueError) and not reseed:
                # Unexpected rows: restart from a seed rather than trust the state, keeping its gaps.
                self._previous = state
                self._state = changes.ChangeState(self.limits)
            log_event('change_detection_failed', level=logging.ERROR, failures=self._failures,
                      error=type(error).__name__)
            raise
        self._failures = 0
        self._last_success = now
        return published, more

    def _run(self):
        if self._app is None:
            self._loop()
        else:
            with self._app.app_context():
                self._loop()

    def _loop(self):
        while not self._stop.is_set():
            try:
                _, more = self.poll_once()
                delay = 0 if more else self.interval
            except Exception:
                delay = backoff_delay(self.interval, self._failures, self.max_interval)
            self._stop.wait(delay)

    # --- subscribers -----------------------------------------------------------------------------
    def _publish(self, events):
        if not events:
            return
        with self._changed:
            for event in events:
                self._sequence += 1
                self._log.append((self._sequence, event))
            self._changed.notify_all()

    def _sequence_of(self, cursor):
        """The sequence in a cursor from this instance; None for no cursor or another instance."""
        if cursor is None:
            return None
        match = _CURSOR.fullmatch(cursor) if type(cursor) is str else None
        if match is None:
            raise ValueError('after must be a change cursor or None.')
        return int(match[2]) if match[1] == self._generation else None

    def read(self, after, timeout=0.0):
        """Events after the cursor `after`. Waits up to `timeout` seconds for new ones; never touches
        the database. `resync` is True for no cursor (a new subscriber: load, then follow `next`), a
        cursor from another detector instance, or one older than the log."""
        sequence = self._sequence_of(after)
        deadline = self._clock() + max(0.0, float(timeout))
        with self._changed:
            while True:
                cursor = f'{self._generation}:{self._sequence}'
                oldest = self._log[0][0] if self._log else self._sequence + 1
                if sequence is None or sequence > self._sequence or sequence < oldest - 1:
                    return {'events': [], 'next': cursor, 'resync': True}
                events = [event for number, event in self._log if number > sequence]
                remaining = deadline - self._clock()
                if events or remaining <= 0 or self._stop.is_set():
                    return {'events': events, 'next': cursor, 'resync': False}
                self._changed.wait(remaining)

    def status(self):
        return {'running': self.running, 'seeded': self._state.seeded, 'complete': self._state.complete,
                'sequence': self._sequence, 'failures': self._failures}


def validate_config(config):
    if type(config['CHANGE_DETECTION_ENABLED']) is not bool:
        raise ValueError('CHANGE_DETECTION_ENABLED must be a Boolean.')
    interval = config['CHANGE_DETECTION_INTERVAL_SECONDS']
    if type(interval) is not int or not 1 <= interval <= 300:
        raise ValueError('CHANGE_DETECTION_INTERVAL_SECONDS must be an integer from 1 to 300.')


def attach(app):
    """Create (not start) the application's detector when enabled. One per application."""
    validate_config(app.config)
    if app.config['CHANGE_DETECTION_ENABLED']:
        app.extensions['change_detector'] = Detector(app.config, app=app)


def start_for_process(app, *, reloader, environ=os.environ):
    """Start the attached detector unless this is the debug reloader's watcher process, which would
    otherwise run a duplicate beside the serving child. `reloader` must be the value the caller then
    passes to app.run(use_reloader=...). Returns the detector or None."""
    detector = app.extensions.get('change_detector')
    if detector is None:
        return None
    if reloader and environ.get('WERKZEUG_RUN_MAIN') != 'true':
        return None
    detector.start()
    return detector
