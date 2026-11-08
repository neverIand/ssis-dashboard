"""Opt-in History estimates for active executions (UX batch C3/C4), with a bounded per-process cache.

A started, unfinished execution's sample (its identity's five latest successes that ended by its start) gains
no new runs, but retention or a permission change can still remove, hide or reveal earlier successes. An
estimate, including "no sample", is therefore cached by execution ID and start time and may lag such a change
by up to API_ESTIMATE_CACHE_SECONDS. The cache belongs to one application, whose configured SQL identity and
policy define the scope for every browser user; no browser identity participates.
"""

from collections import OrderedDict
from threading import Lock
from time import monotonic

from dashboard import serialization as wire
from dashboard.changes import tracked_xml

MAX_ENTRIES = 4096
_MISSING = object()


class EstimateCache:
    """Thread-safe LRU with a fixed lifetime; values are serialized estimates or None (no sample)."""

    def __init__(self, seconds, entries=MAX_ENTRIES, clock=monotonic):
        self.seconds, self.entries, self.clock = seconds, entries, clock
        self._items, self._lock = OrderedDict(), Lock()

    def get(self, key):
        with self._lock:
            item = self._items.get(key, _MISSING)
            if item is _MISSING:
                return _MISSING
            expires, value = item
            if expires <= self.clock():
                del self._items[key]
                return _MISSING
            self._items.move_to_end(key)
            return value

    def put(self, key, value):
        with self._lock:
            self._items[key] = (self.clock() + self.seconds, value)
            self._items.move_to_end(key)
            while len(self._items) > self.entries:
                self._items.popitem(last=False)

    def __len__(self):
        with self._lock:
            return len(self._items)


def validate_config(config):
    if type(config['API_ACTIVE_ESTIMATES_ENABLED']) is not bool:
        raise ValueError('API_ACTIVE_ESTIMATES_ENABLED must be a Boolean.')
    seconds = config['API_ESTIMATE_CACHE_SECONDS']
    if type(seconds) is not int or not 1 <= seconds <= 3600:
        raise ValueError('API_ESTIMATE_CACHE_SECONDS must be an integer from 1 to 3600.')


def register(app):
    app.extensions['estimate_cache'] = EstimateCache(app.config['API_ESTIMATE_CACHE_SECONDS'])


def _active(item):
    return item['started_at'] is not None and item['ended_at'] is None


def _checked(row, expected_started_at):
    from dashboard.history import serialize_estimate  # history imports the execution serializer
    if row['started_at'] is None or wire.utc_timestamp(row['started_at']) != expected_started_at:
        raise ValueError('Unexpected execution estimate row.')
    return serialize_estimate(row)


def detail_estimate(item, query, config, cache):
    """One execution: NULL unless enabled and active; otherwise cached or read with the single-target query.
    query(resource, identifier) returns one row or {} when the execution is no longer visible."""
    if not config['API_ACTIVE_ESTIMATES_ENABLED'] or not _active(item):
        return None
    key = (item['execution_id'], item['started_at'])
    cached = cache.get(key)
    if cached is not _MISSING:
        return cached
    row = query('api-execution-estimate.sql', int(item['execution_id']))
    if not row:
        return _MISSING  # the caller maps a vanished execution to 404
    if wire.bigint(row['execution_id']) != item['execution_id']:
        raise ValueError('Unexpected execution estimate row.')
    value = _checked(row, item['started_at'])
    cache.put(key, value)
    return value


def page_estimates(items, query, config, cache):
    """A list page: estimates for its active rows, reading only cache misses, in one bounded query.
    A row the view no longer returns keeps NULL and is not cached."""
    if not config['API_ACTIVE_ESTIMATES_ENABLED']:
        return {}
    active = {item['execution_id']: item['started_at'] for item in items if _active(item)}
    found, missing = {}, []
    for identifier, started_at in active.items():
        cached = cache.get((identifier, started_at))
        if cached is _MISSING:
            missing.append(int(identifier))
        else:
            found[identifier] = cached
    if missing:
        requested, read = {str(i) for i in missing}, set()
        for row in query('api-executions-estimates.sql', (tracked_xml(sorted(missing)),)):
            identifier = wire.bigint(row['execution_id'])
            if identifier not in requested or identifier in read:
                raise ValueError('Unexpected execution estimate row.')
            read.add(identifier)
            found[identifier] = _checked(row, active[identifier])
        for identifier in read:
            cache.put((identifier, active[identifier]), found[identifier])
    return found


MISSING = _MISSING
