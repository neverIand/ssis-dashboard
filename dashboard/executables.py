"""Page one visible execution's observations before retrieving paths/names."""

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.inspection import visible_execution
from dashboard.observability import record_query
from dashboard.timestamps import parse_timestamp, sql_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('limit', 'cursor', 'sort', 'direction')


def _seek(state, sort):
    if state is None:
        return None, None
    key, nulls = state['sort_key'], state['sort_nulls']
    if (type(key) is not list or len(key) != 1 or type(nulls) is not list or len(nulls) != 1
            or type(nulls[0]) is not bool or nulls[0] != (key[0] is None)):
        raise cursors.InvalidCursor()
    if sort == 'statistics_id':
        if nulls[0] or inputs.identifier(key[0]) != inputs.identifier(state['last_id']):
            raise cursors.InvalidCursor()
        return None, 0
    return (None if key[0] is None else sql_timestamp(inputs.timestamp(key[0]))), int(nulls[0])


def _serialize(row, identifier, upper):
    if wire.bigint(row['execution_id']) != identifier or not 0 < row['statistics_id'] <= upper:
        raise ValueError('Unexpected executable identity.')
    return {
        'statistics_id': wire.bigint(row['statistics_id']), 'execution_id': identifier,
        'executable_id': wire.bigint(row['executable_id']),
        'package_name': wire.catalog_text(row['package_name'], 260, units=True, name=True),
        'package_path': wire.catalog_text(row['package_path'], 16384),
        'execution_path': wire.catalog_text(row['execution_path'], 16384),
        'name': wire.catalog_text(row['name'], 4000, units=True),
        'started_at': wire.utc_timestamp(row['started_at']), 'ended_at': wire.utc_timestamp(row['ended_at']),
        'duration_seconds': wire.duration_seconds(row['started_at'], row['ended_at']),
        'result': wire.executable_result(row['execution_result']),
    }


def executable_page(value, values, config):
    now = utc_now()
    try:
        identifier = inputs.identifier(value)
        selection = {'execution_id': value, 'limit': inputs.integer(values['limit']) if 'limit' in values else 50,
                     'sort': values.get('sort', 'started_at'), 'direction': values.get('direction', 'asc')}
        if selection['sort'] not in ('started_at', 'statistics_id') or selection['direction'] not in ('asc', 'desc'):
            raise InvalidInput('Unsupported executable order.')
        selection_digest, scope = cursors.digest(selection), cursors.scope_digest(config)
        state = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/executables', selection=selection_digest,
                                         scope=scope, now=now)
            upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
            if last > upper:
                raise cursors.InvalidCursor()
        last_time, last_null = _seek(state, selection['sort'])
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    execution = visible_execution(value, config, as_of=now)

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'],
                             one_row=one_row, login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'],
                             query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
                             typed_timestamps=True, declared_parameters=True, on_complete=record_query)

    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        fence = query('api-executables-fence.sql', (identifier,), one_row=True)
        if not fence:
            raise NotFound()
        upper, last = fence['upper_id'], None
        if upper is not None:
            wire.bigint(upper)
    rows = []
    if upper is not None:
        rows = query('api-executables-page.sql', (identifier, selection['limit'] + 1, upper, last,
                     last_time, last_null, int(selection['sort'] == 'started_at'), int(selection['direction'] == 'desc')))
        if not rows:
            raise NotFound()
        if (len(rows) > selection['limit'] + 1
                or any(wire.bigint(row['execution_id']) != value for row in rows)):
            raise ValueError('Unexpected executable page.')
        if any(wire.boolean(row['page_empty']) for row in rows):
            if len(rows) != 1 or rows[0]['statistics_id'] is not None:
                raise ValueError('Unexpected empty executable page.')
            rows = []
        elif any(row['statistics_id'] is None for row in rows):
            raise ValueError('Missing executable statistics ID.')
    serialized = [_serialize(row, value, upper) for row in rows]
    if len({row['statistics_id'] for row in serialized}) != len(serialized):
        raise ValueError('Duplicate executable statistics ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        key = data[-1]['started_at'] if selection['sort'] == 'started_at' else data[-1]['statistics_id']
        token = cursors.seal({'v': 2, 'resource': 'v1/executables', 'selection': selection_digest, 'scope': scope,
                              'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': data[-1]['statistics_id'],
                              'sort_key': [key], 'sort_nulls': [key is None]})
    logging = execution['logging_level']
    availability = ('available' if data else 'not-recorded' if logging is not None and logging['code'] == 0 else 'unknown')
    return data, {'from': None, 'to': None, 'limit': selection['limit'], 'sort': selection['sort'],
                  'direction': selection['direction'], 'as_of': as_of.isoformat(),
                  'upper_id': None if upper is None else wire.bigint(upper), 'next_cursor': token,
                  'has_more': has_more, 'consistency': 'live', 'availability': availability}
