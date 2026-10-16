"""Filter, page and serialize visible executions without legacy presentation SQL."""

from datetime import datetime, timezone

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.execution_order import EXECUTION_SORTS, encode_key, seek_values
from dashboard.observability import record_query
from dashboard.timestamps import as_timestamp, parse_timestamp, sql_timestamp
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('folder', 'project', 'folder_pattern', 'project_pattern', 'from', 'to',
                    'status', 'limit', 'cursor', 'sort', 'direction')


def utc_now():
    return as_timestamp(datetime.now(timezone.utc))


def _selection(values, config, *, now, fixed_to):
    selection = {}
    for name in ('folder', 'project'):
        pattern = name + '_pattern'
        if name in values and pattern in values:
            raise InvalidInput('Exact and pattern selectors are mutually exclusive.')
        selection[name] = inputs.catalog_name(values[name]) if name in values else None
        selection[pattern] = inputs.catalog_pattern(values[pattern]) if pattern in values else None
    selection['status'] = inputs.statuses(values['status']) if 'status' in values else ()
    selection['limit'] = inputs.integer(values['limit']) if 'limit' in values else 50
    selection['sort'] = values.get('sort', 'execution_id')
    selection['direction'] = values.get('direction', 'desc')
    if selection['sort'] not in EXECUTION_SORTS or selection['direction'] not in ('asc', 'desc'):
        raise InvalidInput('Unsupported execution order.')
    if 'cursor' in values and not {'from', 'to'} <= values.keys():
        raise cursors.InvalidCursor()
    start, end = inputs.time_window(values, now=now, fixed_to=fixed_to,
                                    hours=config['HOUR_SPAN'], max_hours=config['API_MAX_RANGE_HOURS'])
    selection.update({'from': start.isoformat(), 'to': end.isoformat()})
    return selection, start, end


def _name(value, width=128, *, nullable=False):
    if value is None and nullable:
        return None
    try:
        return inputs.catalog_name(value, utf16_units=width)
    except InvalidInput:
        # Unexpected database shape is a server failure, never a bad request.
        raise ValueError('Invalid catalog output name.') from None


def serialize_execution(row, *, as_of):
    created = wire.utc_timestamp(row['created_at'])
    if created is None:
        raise ValueError('Missing catalog creation time.')
    return {
        'execution_id': wire.bigint(row['execution_id']),
        'folder_name': _name(row['folder_name']), 'project_name': _name(row['project_name']),
        'package_name': _name(row['package_name'], 260), 'project_lsn': wire.lsn(row['project_lsn']),
        'environment': {'folder_name': _name(row['environment_folder_name'], nullable=True),
                        'name': _name(row['environment_name'], nullable=True)},
        'status': wire.execution_status(row['status']), 'logging_level': wire.logging_level(row['logging_level']),
        'created_at': created, 'started_at': wire.utc_timestamp(row['started_at']),
        'ended_at': wire.utc_timestamp(row['ended_at']),
        'duration_seconds': wire.duration_seconds(row['started_at'], row['ended_at']),
        'elapsed_seconds': wire.elapsed_seconds(row['started_at'], row['ended_at'], as_of=as_of),
        'warning_count': wire.count(row['warning_count']), 'error_count': wire.count(row['error_count']),
    }


def execution_page(values, config, *, fixed_to):
    now = utc_now()
    try:
        selection, start, end = _selection(values, config, now=now, fixed_to=fixed_to)
        selection_digest = cursors.digest(selection)
        # The configured SQL identity and API policy define this local scope.
        # No browser identity/header participates; SQL visibility is rechecked.
        scope = cursors.digest({'connection': config['CONNECTION_STRING']['main'],
                                'policy': [config[name] for name in (
                                    'API_EVENTS_ENABLED', 'API_VALUES_ENABLED', 'API_OVERRIDE_VALUES_ENABLED')]})
        state = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/executions',
                                         selection=selection_digest, scope=scope, now=now)
            upper = inputs.execution_id(state['upper_id'])
            last = inputs.execution_id(state['last_id'])
            if last > upper:
                raise cursors.InvalidCursor()
        seek = seek_values(state, selection['sort'])
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'],
                             one_row=one_row, login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'],
                             query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'], typed_timestamps=True,
                             on_complete=record_query)

    status = selection['status']
    parameters = (sql_timestamp(start), sql_timestamp(end), selection['folder'], selection['project'],
                  selection['folder_pattern'], selection['project_pattern'], *status, *([None] * (9 - len(status))))
    as_of = parse_timestamp(state['as_of']) if state is not None else now
    if state is None:
        upper = query('api-executions-fence.sql', parameters, one_row=True)['upper_id']
        last = None
        if upper is not None:
            wire.bigint(upper)
    page_parameters = (*parameters, selection['limit'] + 1, upper, last, int(selection['direction'] == 'desc'))
    resource = 'api-executions-page.sql'
    if selection['sort'] != 'execution_id':
        resource = 'api-executions-sort.sql'
        page_parameters += (selection['sort'], *seek)
    rows = [] if upper is None else query(resource, page_parameters)
    has_more = len(rows) > selection['limit']
    page = rows[:selection['limit']]
    data = [serialize_execution(row, as_of=as_of) for row in page]
    token = None
    if has_more:
        key, nulls = encode_key(page[-1], selection['sort'])
        token = cursors.seal({'v': 2, 'resource': 'v1/executions', 'selection': selection_digest,
                              'scope': scope, 'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper),
                              'last_id': data[-1]['execution_id'], 'sort_key': key, 'sort_nulls': nulls})
    return data, {'from': selection['from'], 'to': selection['to'], 'limit': selection['limit'],
                  'sort': selection['sort'], 'direction': selection['direction'], 'as_of': as_of.isoformat(),
                  'upper_id': None if upper is None else wire.bigint(upper), 'next_cursor': token,
                  'has_more': has_more, 'consistency': 'live'}
