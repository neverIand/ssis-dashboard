"""Bounded invocation starts and conservative, path-specific observed end times."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.inspection import visible_execution
from dashboard.timestamps import sql_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('limit', 'cursor', 'sort', 'direction')


def _seek(state, sort):
    if state is None:
        return None
    key, nulls = state['sort_key'], state['sort_nulls']
    if (type(key) is not list or len(key) != 1 or type(nulls) is not list
            or len(nulls) != 1 or nulls[0] is not False):
        raise cursors.InvalidCursor()
    if sort == 'observation_id':
        if inputs.identifier(key[0]) != inputs.identifier(state['last_id']):
            raise cursors.InvalidCursor()
        return None
    return sql_timestamp(inputs.timestamp(key[0]))


def _serialize(row, identifier, upper):
    if wire.bigint(row['execution_id']) != identifier or not 0 < row['observation_id'] <= upper:
        raise ValueError('Unexpected child identity.')
    path = wire.catalog_text(row['execution_path'], 16384)
    if row['package_path'] != '\\Package' or path is None or '\\' not in path[1:] or row['started_at'] is None:
        raise ValueError('Invalid child start.')
    source_type = row['source_type']
    if source_type is not None and (type(source_type) is not int or not -32768 <= source_type <= 32767):
        raise ValueError('Invalid child source type.')
    duration = wire.duration_seconds(row['started_at'], row['ended_at'])
    if row['ended_at'] is not None and duration is None:
        # SQL pairs an end only at or after its start; a reversed pair here is an unexpected shape.
        raise ValueError('Invalid child timing.')
    return {
        'observation_id': wire.bigint(row['observation_id']), 'execution_id': identifier,
        'package_name': wire.catalog_text(row['package_name'], 260, units=True, name=True),
        'package_path': row['package_path'], 'execution_path': path,
        'source_name': wire.catalog_text(row['source_name'], 4000, units=True), 'source_type': source_type,
        'started_at': wire.utc_timestamp(row['started_at']), 'ended_at': wire.utc_timestamp(row['ended_at']),
        'duration_seconds': duration,
        'state': 'incomplete' if row['ended_at'] is None else 'complete',
    }


def child_page(value, values, config):
    now = utc_now()
    with paging.cursor_inputs(values):
        identifier = inputs.identifier(value)
        selection = {'execution_id': value, 'limit': inputs.integer(values['limit']) if 'limit' in values else 50,
                     'sort': values.get('sort', 'started_at'), 'direction': values.get('direction', 'asc')}
        if selection['sort'] not in ('started_at', 'observation_id') or selection['direction'] not in ('asc', 'desc'):
            raise InvalidInput('Unsupported child order.')
        selection_digest, scope = cursors.digest(selection), cursors.scope_digest(config)
        state, upper, last, as_of = paging.continuation(values, resource='v1/children', selection=selection_digest,
                                                        scope=scope, now=now)
        last_time = _seek(state, selection['sort'])

    execution = visible_execution(value, config, as_of=now)
    query = catalog_query(config)
    if state is None:
        upper, unidentified = paging.fence(query, 'api-children-fence.sql', (identifier,), scoped=True,
                                           flag='has_unidentified_starts')
    rows = []
    if upper is not None:
        rows, unidentified = paging.observation_rows(
            query('api-children-page.sql', (identifier, selection['limit'] + 1, upper, last, last_time,
                  int(selection['sort'] == 'started_at'), int(selection['direction'] == 'desc'))),
            limit=selection['limit'], execution_id=value, identity='observation_id', label='child',
            flag='has_unidentified_starts')
    serialized = paging.unique([_serialize(row, value, upper) for row in rows], 'observation_id',
                               'Duplicate child observation ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        key = data[-1]['started_at'] if selection['sort'] == 'started_at' else data[-1]['observation_id']
        token = paging.next_cursor(resource='v1/children', selection=selection_digest, scope=scope, as_of=as_of,
                                   upper=upper, last_id=data[-1]['observation_id'], key=[key], nulls=[False])
    logging = execution['logging_level']
    availability = ('unknown' if unidentified else 'available' if data else
                    'not-recorded' if logging is not None and logging['code'] == 0 else 'unknown')
    return data, paging.page_meta(limit=selection['limit'], sort=selection['sort'], direction=selection['direction'],
                                  as_of=as_of, upper=upper, token=token, has_more=has_more,
                                  availability=availability, has_unidentified_starts=unidentified)
