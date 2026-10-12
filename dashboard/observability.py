"""Safe application log events and request-local timing; no catalog data."""

import json
import logging
from time import perf_counter
from uuid import uuid4

from flask import current_app, g, has_request_context, request


_METHODS = {'GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT'}
_LEVELS = {'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'}


def request_id():
    if 'request_id' not in g:
        g.request_id = uuid4().hex
    return g.request_id


def log_event(event, *, level=logging.INFO, **fields):
    """Emit only caller-selected safe fields; a failed sink cannot break a page."""
    record = {'event': event, **fields}
    try:
        current_app.logger.log(
            level, json.dumps(record, sort_keys=True, separators=(',', ':')),
            extra={'dashboard_event': record},
        )
    except Exception:
        pass


def record_query(report):
    query_index = None
    correlation = None
    if has_request_context():
        correlation = request_id()
        if 'request_started' in g:
            g.query_count += 1
            g.query_failures += report['outcome'] != 'ok'
            g.query_duration_ms += report['duration_ms']
            query_index = g.query_count
    log_event(
        'query_completed',
        level=logging.INFO if report['outcome'] == 'ok' else logging.ERROR,
        request_id=correlation, query_index=query_index, **report,
    )


def _start_request():
    # g may survive across requests under a manually retained app context.
    g.request_id = uuid4().hex
    g.request_started = perf_counter()
    g.request_timing_logged = False
    g.query_count = 0
    g.query_failures = 0
    g.query_duration_ms = 0.0


def _finish_request(status):
    if 'request_started' not in g or g.request_timing_logged:
        return
    g.request_timing_logged = True
    log_event(
        'request_completed',
        level=logging.ERROR if status is None or status >= 500 else logging.INFO,
        request_id=request_id(),
        endpoint=request.endpoint or 'unmatched',
        method=request.method if request.method in _METHODS else 'OTHER',
        status=status,
        outcome='aborted' if status is None else 'response',
        duration_ms=round(max(0.0, perf_counter() - g.request_started) * 1000, 3),
        query_count=g.query_count,
        query_failures=g.query_failures,
        query_duration_ms=round(g.query_duration_ms, 3),
    )


def _after_request(response):
    response.headers['X-Request-ID'] = request_id()
    _finish_request(response.status_code)
    return response


def _teardown_request(error):
    # Also covers dispatch cancellation; manually pushed contexts have no start.
    _finish_request(None)


def register_observability(app):
    level = app.config['LOG_LEVEL']
    if not isinstance(level, str) or level not in _LEVELS:
        raise ValueError('LOG_LEVEL must be DEBUG, INFO, WARNING, ERROR, or CRITICAL.')
    # Python logger levels are process configuration; request counters live in g.
    app.logger.setLevel(level)
    app.before_request(_start_request)
    app.after_request(_after_request)
    app.teardown_request(_teardown_request)
