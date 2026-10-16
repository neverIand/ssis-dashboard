"""Capability-gated, bounded event text with full-source category/search filters."""

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.inspection import visible_execution
from dashboard.observability import record_query
from dashboard.timestamps import parse_timestamp, sql_timestamp, utc_now
from dashboard.validation import EVENT_QUERIES, InvalidInput


QUERY_PARAMETERS = ('limit', 'cursor', 'sort', 'direction', 'kind', 'q')
KINDS = tuple(EVENT_QUERIES)


def _search(value):
    if value is None:
        return None
    inputs.catalog_name(value, utf16_units=1024)
    if len(value) > 512:
        raise InvalidInput('Search text is too long.')
    return value


def _seek(state, sort):
    if state is None:
        return None
    keys, nulls = state['sort_key'], state['sort_nulls']
    if (type(keys) is not list or len(keys) != 1 or type(nulls) is not list
            or len(nulls) != 1 or nulls[0] is not False):
        raise cursors.InvalidCursor()
    if sort == 'event_id':
        if inputs.identifier(keys[0]) != inputs.identifier(state['last_id']):
            raise cursors.InvalidCursor()
        return None
    return sql_timestamp(inputs.timestamp(keys[0]))


def _serialize(row, identifier, upper):
    if wire.bigint(row['execution_id']) != identifier or not 0 < row['event_id'] <= upper:
        raise ValueError('Unexpected event identity.')
    if row['message_time'] is None:
        raise ValueError('Missing event time.')
    for field in ('message_type', 'source_type'):
        code = row[field]
        if (code is None and field == 'message_type') or (code is not None and
                (type(code) is not int or not -32768 <= code <= 32767)):
            raise ValueError('Invalid event code.')
    # SQL bounds UTF-16 units and removes only a clipped high-surrogate edge.
    # The prefix still contains a full character sentinel beyond the wire cap.
    message = wire.catalog_text(row['message'], 32770)
    return {
        'event_id': wire.bigint(row['event_id']), 'execution_id': identifier,
        'message_time': wire.utc_timestamp(row['message_time']),
        'event_name': wire.catalog_text(row['event_name'], 1024, units=True),
        'message_type': row['message_type'], 'source_type': row['source_type'],
        'message': None if message is None else message[:16384],
        'truncated': message is not None and len(message) > 16384,
        'package_name': wire.catalog_text(row['package_name'], 260, units=True, name=True),
        'package_path': wire.catalog_text(row['package_path'], 16384),
        'execution_path': wire.catalog_text(row['execution_path'], 16384),
        'source_name': wire.catalog_text(row['source_name'], 4000, units=True),
        'subcomponent_name': wire.catalog_text(row['subcomponent_name'], 4000, units=True),
    }


def event_page(value, values, config):
    now = utc_now()
    try:
        identifier = inputs.identifier(value)
        selection = {'execution_id': value, 'limit': inputs.integer(values['limit']) if 'limit' in values else 50,
                     'sort': values.get('sort', 'message_time'), 'direction': values.get('direction', 'asc'),
                     'kind': values.get('kind', 'all'), 'q': values.get('q')}
        if (selection['sort'] not in ('message_time', 'event_id') or selection['direction'] not in ('asc', 'desc')
                or selection['kind'] not in KINDS):
            raise InvalidInput('Unsupported event selection.')
        search = _search(selection['q'])
        selection_digest, scope = cursors.digest(selection), cursors.scope_digest(config)
        state = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/events', selection=selection_digest, scope=scope, now=now)
            upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
            if last > upper:
                raise cursors.InvalidCursor()
        last_time = _seek(state, selection['sort'])
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    execution = visible_execution(value, config, as_of=now)

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'], one_row=one_row,
                             login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
                             typed_timestamps=True, on_complete=record_query)

    kind = KINDS.index(selection['kind'])
    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        fence = query('api-events-fence.sql', (identifier, kind, search), one_row=True)
        if not fence:
            raise NotFound()
        upper, last = fence['upper_id'], None
        unidentified = wire.boolean(fence['has_unidentified_events'])
        if upper is not None:
            wire.bigint(upper)
    rows = []
    if upper is not None:
        rows = query('api-events-page.sql', (identifier, selection['limit'] + 1, upper, last, last_time,
                     int(selection['sort'] == 'message_time'), int(selection['direction'] == 'desc'), kind, search))
        if not rows:
            raise NotFound()
        unidentified = wire.boolean(rows[0]['has_unidentified_events'])
        if (len(rows) > selection['limit'] + 1 or any(wire.bigint(r['execution_id']) != value
                or wire.boolean(r['has_unidentified_events']) != unidentified for r in rows)):
            raise ValueError('Unexpected event page.')
        if any(wire.boolean(r['page_empty']) for r in rows):
            if len(rows) != 1 or rows[0]['event_id'] is not None:
                raise ValueError('Unexpected empty event page.')
            rows = []
    serialized = [_serialize(r, value, upper) for r in rows]
    if len({r['event_id'] for r in serialized}) != len(serialized):
        raise ValueError('Duplicate event ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        key = data[-1]['message_time'] if selection['sort'] == 'message_time' else data[-1]['event_id']
        token = cursors.seal({'v': 2, 'resource': 'v1/events', 'selection': selection_digest, 'scope': scope,
            'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': data[-1]['event_id'],
            'sort_key': [key], 'sort_nulls': [False]})
    logging = execution['logging_level']
    availability = ('unknown' if unidentified else 'available' if data else
                    'not-recorded' if logging is not None and logging['code'] == 0 else 'unknown')
    return data, {'from': None, 'to': None, 'limit': selection['limit'], 'sort': selection['sort'],
        'direction': selection['direction'], 'as_of': as_of.isoformat(), 'upper_id': None if upper is None else wire.bigint(upper),
        'next_cursor': token, 'has_more': has_more, 'consistency': 'live', 'availability': availability,
        'has_unidentified_events': unidentified}
