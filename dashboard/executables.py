"""Page one visible execution's observations before retrieving paths/names."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.inspection import visible_execution
from dashboard.observability import observed_duration
from dashboard.timestamps import sql_timestamp, utc_now
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
        'duration_seconds': observed_duration(row['started_at'], row['ended_at']),
        'result': wire.executable_result(row['execution_result']),
    }


def executable_page(value, values, config):
    now = utc_now()
    with paging.cursor_inputs(values):
        identifier = inputs.identifier(value)
        selection = {'execution_id': value, 'limit': inputs.integer(values['limit']) if 'limit' in values else 50,
                     'sort': values.get('sort', 'started_at'), 'direction': values.get('direction', 'asc')}
        if selection['sort'] not in ('started_at', 'statistics_id') or selection['direction'] not in ('asc', 'desc'):
            raise InvalidInput('Unsupported executable order.')
        selection_digest, scope = cursors.digest(selection), cursors.scope_digest(config)
        state, upper, last, as_of = paging.continuation(values, resource='v1/executables', selection=selection_digest,
                                                        scope=scope, now=now)
        last_time, last_null = _seek(state, selection['sort'])

    execution = visible_execution(value, config, as_of=now)
    query = catalog_query(config)
    if state is None:
        upper, _ = paging.fence(query, 'api-executables-fence.sql', (identifier,), scoped=True)
    rows = []
    if upper is not None:
        rows, _ = paging.observation_rows(
            query('api-executables-page.sql', (identifier, selection['limit'] + 1, upper, last, last_time, last_null,
                  int(selection['sort'] == 'started_at'), int(selection['direction'] == 'desc'))),
            limit=selection['limit'], execution_id=value, identity='statistics_id', label='executable')
        if any(row['statistics_id'] is None for row in rows):
            raise ValueError('Missing executable statistics ID.')
    serialized = paging.unique([_serialize(row, value, upper) for row in rows], 'statistics_id',
                               'Duplicate executable statistics ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        key = data[-1]['started_at'] if selection['sort'] == 'started_at' else data[-1]['statistics_id']
        token = paging.next_cursor(resource='v1/executables', selection=selection_digest, scope=scope, as_of=as_of,
                                   upper=upper, last_id=data[-1]['statistics_id'], key=[key], nulls=[key is None])
    logging = execution['logging_level']
    availability = ('available' if data else 'not-recorded' if logging is not None and logging['code'] == 0 else 'unknown')
    return data, paging.page_meta(limit=selection['limit'], sort=selection['sort'], direction=selection['direction'],
                                  as_of=as_of, upper=upper, token=token, has_more=has_more, availability=availability)
