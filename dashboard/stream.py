"""P5.2 change-stream prototype: GET /api/v1/changes as Server-Sent Events, notification-only.

Development server only, loopback peers only, off by default (CHANGE_STREAM_ENABLED). A stream holds a
thread but never a database connection: it waits on the detector's condition and picks one frame per
read by the frame table of the P5.2 record (docs/MODERNIZATION_PLAN.md, Production live updates).
"""

import itertools
import json
import logging
import re
import threading
import time

from flask import current_app, request
from werkzeug.exceptions import Forbidden, NotFound

from dashboard.observability import log_event, request_id

_CURSOR = re.compile(r'[0-9a-f]{16}:[0-9]{1,18}')
_LOOPBACK = frozenset({'127.0.0.1', '::1'})
RETRY_MILLISECONDS = 1000
MAX_STREAM_BYTES = 256 * 1024   # end with a retry hint before this much output
MAX_NAMED_IDS = 100             # a larger batch asks for a refresh of everything shown
_SETTINGS = {  # name: (lowest, highest)
    'CHANGE_STREAM_MAX_STREAMS': (1, 64),
    'CHANGE_STREAM_LIFETIME_SECONDS': (10, 3600),
    'CHANGE_STREAM_HEARTBEAT_SECONDS': (1, 300),
}


def validate_config(config):
    for name in ('CHANGE_STREAM_ENABLED', 'CHANGE_STREAM_NAMES_IDS'):
        if type(config[name]) is not bool:
            raise ValueError(f'{name} must be a Boolean.')
    for name, (low, high) in _SETTINGS.items():
        value = config[name]
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f'{name} must be an integer from {low} to {high}.')
    if config['CHANGE_STREAM_HEARTBEAT_SECONDS'] >= config['CHANGE_STREAM_LIFETIME_SECONDS']:
        raise ValueError('CHANGE_STREAM_HEARTBEAT_SECONDS must be shorter than the stream lifetime.')
    if config['CHANGE_STREAM_ENABLED'] and not config['CHANGE_DETECTION_ENABLED']:
        raise ValueError('CHANGE_STREAM_ENABLED requires CHANGE_DETECTION_ENABLED.')


class Slots:
    """Concurrent streams per process. acquire() never waits; each slot is released exactly once."""

    def __init__(self, limit):
        self.limit = limit
        self.open = 0
        self.released = 0
        self._lock = threading.Lock()

    def acquire(self):
        with self._lock:
            if self.open >= self.limit:
                return None
            self.open += 1
        return _Slot(self)

    def _release(self):
        with self._lock:
            self.open -= 1
            self.released += 1


class _Slot:
    def __init__(self, slots):
        self._slots = slots
        self._lock = threading.Lock()
        self._held = True

    def release(self):
        with self._lock:
            if not self._held:
                return False
            self._held = False
        self._slots._release()
        return True


def frame(event, data, *, cursor=None):
    """One dispatchable frame; cursor '' sends an empty id field, which clears the browser's cursor."""
    lines = [f'event: {event}']
    if cursor is not None:
        lines.append(f'id: {cursor}' if cursor else 'id:')
    lines.append('data: ' + json.dumps(data, separators=(',', ':')))
    return ('\n'.join(lines) + '\n\n').encode('utf-8')


HEARTBEAT = b':\n\n'
RETRY = f'retry: {RETRY_MILLISECONDS}\n\n'.encode('ascii')


def changes_data(events, names_ids):
    """`ids` for a batch with events: named only when allowed, no event is `removed`, and the set is small."""
    if not names_ids or any(e['kind'] == 'removed' for e in events):
        return {'ids': None}
    ids = sorted({e['execution_id'] for e in events}, key=int)
    return {'ids': ids if len(ids) <= MAX_NAMED_IDS else None}


def frames(detector, header_cursor, *, deadline, heartbeat, names_ids, clock=time.monotonic):
    """Yield (outcome, bytes) pairs by the P5.2 frame table until `deadline` (a `clock` time);
    outcome is None while the stream continues."""
    cursor = header_cursor if isinstance(header_cursor, str) and _CURSOR.fullmatch(header_cursor) else None
    last_write = clock()
    opening = True
    run = None   # the detector run this stream opened under; a stop and restart ends the stream
    while True:
        now = clock()
        if now >= deadline:
            yield 'lifetime', RETRY
            return
        timeout = 0.0 if opening else max(0.0, min(last_write + heartbeat, deadline) - now)
        result = detector.read_with_health(cursor, timeout)
        health = result['health']
        if run is None:
            run = health['run']
        if not health['healthy'] or health['run'] != run:
            data, end = frame('stale', {'reason': 'detector'}, cursor=''), 'stale'
        else:
            end = None
            events = result['events']
            if result['resync'] or any(e['kind'] == 'resync' for e in events):
                if any(e['kind'] == 'resync' for e in events):
                    reason = 'detector'
                elif opening and cursor is None:
                    reason = 'subscribe'
                else:
                    reason = 'cursor'
                data = frame('resync', {'reason': reason}, cursor=result['next'])
            elif events:
                data = frame('changes', changes_data(events, names_ids), cursor=result['next'])
            elif opening:
                data = frame('changes', {'ids': []}, cursor=result['next'])
            elif clock() - last_write >= heartbeat:
                data = HEARTBEAT
            else:
                continue
        if clock() >= deadline:
            yield 'lifetime', RETRY        # nothing read here is lost: the browser's cursor has not moved
            return
        yield end, data
        if end is not None:
            return
        cursor = result['next']
        opening = False
        last_write = clock()


# Room kept for the longest frame that ends a stream, so the total never passes MAX_STREAM_BYTES.
_FINAL_RESERVE = max(len(RETRY), len(frame('stale', {'reason': 'detector'}, cursor='')))


class _Stream:
    """One stream's slot and log line: finish() releases and logs once, whichever path ends it."""

    def __init__(self, app, slot):
        self.app, self.slot = app, slot
        self.request_id = request_id()
        self.began = time.monotonic()
        # One deadline for the frame source and the body, so no frame is sent after it.
        self.deadline = self.began + app.config['CHANGE_STREAM_LIFETIME_SECONDS']
        self.sent = self.count = 0
        self._done = threading.Lock()
        self._finished = False

    def finish(self, outcome):
        with self._done:
            if self._finished:
                return
            self._finished = True
        self.slot.release()
        with self.app.app_context():
            log_event('change_stream_closed', level=logging.INFO, request_id=self.request_id, outcome=outcome,
                      frames=self.count, bytes=self.sent,
                      duration_ms=round((time.monotonic() - self.began) * 1000, 3))

    def body(self, first, rest):
        outcome = 'closed'
        try:
            for end, data in itertools.chain([first], rest):
                if data is not RETRY and time.monotonic() >= self.deadline:
                    end, data = 'lifetime', RETRY    # e.g. the opening frame, built before the body started
                elif end is None and self.sent + len(data) + _FINAL_RESERVE > MAX_STREAM_BYTES:
                    end, data = 'output', RETRY
                self.sent += len(data)
                self.count += 1
                yield data
                if end is not None:
                    outcome = end
                    return
        except Exception:
            outcome = 'error'
            raise
        finally:
            self.finish(outcome)


def _admit():
    """Before Fetch Metadata and query checks, for every method on this route: loopback, same origin."""
    if request.routing_exception is not None or request.endpoint != 'api.changes':
        return
    if request.remote_addr not in _LOOPBACK:
        raise NotFound()
    if request.headers.get('Sec-Fetch-Site', 'same-origin') != 'same-origin':
        raise Forbidden()


def changes():
    app = current_app._get_current_object()
    if request.method == 'HEAD':
        return app.response_class(mimetype='text/event-stream')
    slot = app.extensions['change_stream']['slots'].acquire()
    if slot is None:
        from dashboard.api import problem_response
        refused = problem_response(503, capacity=True)
        refused.headers['Retry-After'] = '5'
        return refused
    stream = _Stream(app, slot)
    config = app.config
    rest = frames(app.extensions['change_detector'], request.headers.get('Last-Event-ID'),
                  deadline=stream.deadline,
                  heartbeat=config['CHANGE_STREAM_HEARTBEAT_SECONDS'], names_ids=config['CHANGE_STREAM_NAMES_IDS'])
    try:
        # The opening read happens here, so a failure is an ordinary Problem response with its headers.
        first = next(rest)
    except Exception:
        stream.finish('error')
        raise
    response = app.response_class(stream.body(first, rest), mimetype='text/event-stream')
    response.headers['X-Accel-Buffering'] = 'no'
    # A response that is never iterated still returns its slot and logs; finish() acts once.
    response.call_on_close(lambda: stream.finish('not_started'))
    return response


def register_stream(app):
    """Validate the settings and add the admission check; the route itself comes from enable_stream()."""
    validate_config(app.config)
    app.before_request(_admit)


def enable_stream(app):
    """Add /api/v1/changes when CHANGE_STREAM_ENABLED. Only the development entry point (runserver.py),
    the local harness and tests call this, so a WSGI host such as dashboard/wsgi.py never serves it."""
    if not app.config['CHANGE_STREAM_ENABLED'] or 'change_stream' in app.extensions:
        return False
    app.extensions['change_stream'] = {'slots': Slots(app.config['CHANGE_STREAM_MAX_STREAMS'])}
    app.add_url_rule('/api/v1/changes', 'api.changes', changes, methods=['GET'], merge_slashes=False)
    return True
