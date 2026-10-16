"""Exact-package history with bounded ID paging and observed timings only."""

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.executions import serialize_execution
from dashboard.observability import record_query
from dashboard.timestamps import parse_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('folder', 'project', 'package', 'status', 'limit', 'cursor', 'sort', 'direction')


def history_page(values, config):
    now = utc_now()
    try:
        if not {'folder', 'project', 'package'} <= values.keys():
            raise InvalidInput('An exact package identity is required.')
        selection = {name: inputs.catalog_name(values[name], utf16_units=260 if name == 'package' else 128)
                     for name in ('folder', 'project', 'package')}
        selection.update(status=inputs.statuses(values['status']) if 'status' in values else (2, 7),
                         limit=inputs.integer(values['limit']) if 'limit' in values else 50,
                         sort=values.get('sort', 'execution_id'), direction=values.get('direction', 'desc'))
        if selection['sort'] != 'execution_id' or selection['direction'] not in ('asc', 'desc'):
            raise InvalidInput('Unsupported history order.')
        digest, scope = cursors.digest(selection), cursors.scope_digest(config)
        state = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/history', selection=digest, scope=scope, now=now)
            upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
            if (last > upper or type(state['sort_key']) is not list or state['sort_key'] != [state['last_id']]
                    or type(state['sort_nulls']) is not list or len(state['sort_nulls']) != 1
                    or state['sort_nulls'][0] is not False):
                raise cursors.InvalidCursor()
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'], one_row=one_row,
                             login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
                             typed_timestamps=True, on_complete=record_query)

    status = selection['status']
    parameters = (selection['folder'], selection['project'], selection['package'], *status, *([None] * (9 - len(status))))
    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        upper = query('api-history-fence.sql', parameters, one_row=True)['upper_id']
        last = None
        if upper is not None:
            wire.bigint(upper)
    rows = [] if upper is None else query('api-history-page.sql', (
        *parameters, selection['limit'] + 1, upper, last, int(selection['direction'] == 'desc')))
    if len(rows) > selection['limit'] + 1:
        raise ValueError('Unexpected history page size.')
    serialized = []
    for row in rows:
        wire.bigint(row['execution_id'])
        if (row['execution_id'] > upper
                or type(row['logging_rows']) is not int or row['logging_rows'] not in (0, 1)
                or (row['logging_rows'] == 0 and row['logging_level'] is not None)):
            raise ValueError('Unexpected history metadata.')
        serialized.append({**serialize_execution(row, as_of=as_of), 'estimate': None})
    if len({row['execution_id'] for row in serialized}) != len(serialized):
        raise ValueError('Duplicate history execution ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        last_id = data[-1]['execution_id']
        token = cursors.seal({'v': 2, 'resource': 'v1/history', 'selection': digest, 'scope': scope,
                             'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': last_id,
                             'sort_key': [last_id], 'sort_nulls': [False]})
    return data, {'from': None, 'to': None, 'limit': selection['limit'], 'sort': 'execution_id',
                  'direction': selection['direction'], 'as_of': as_of.isoformat(),
                  'upper_id': None if upper is None else wire.bigint(upper), 'next_cursor': token,
                  'has_more': has_more, 'consistency': 'live'}
