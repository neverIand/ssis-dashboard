"""Bounded exact/LIKE history; estimates stay within each visible package."""

from decimal import Decimal

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.executions import serialize_execution
from dashboard.observability import record_query
from dashboard.timestamps import TICKS_PER_SECOND, Timestamp, as_timestamp, parse_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('folder', 'project', 'package', 'match', 'status', 'limit', 'cursor', 'sort', 'direction')
_MAX_DURATION_TICKS = parse_timestamp('9999-12-31T23:59:59.9999999Z').utc_ticks


def serialize_estimate(row):
    """Keep the rational mean until JSON/100-ns timestamp rounding is required."""
    count, total = wire.count(row['estimate_sample_count']), row['estimate_total_ticks']
    if count > 5 or (count == 0 and total is not None):
        raise ValueError('Invalid history estimate aggregate.')
    if count == 0:
        return None
    if (row['started_at'] is None or type(total) is not Decimal or not total.is_finite()
            or total < 0 or total > count * _MAX_DURATION_TICKS or total != total.to_integral_value()):
        raise ValueError('Invalid history estimate aggregate.')
    total = int(total)
    if total == 0:
        return None
    # Nonnegative half ticks round up; duration retains the unrounded mean.
    mean_ticks = (2 * total + count) // (2 * count)
    start_ticks = as_timestamp(row['started_at']).utc_ticks
    try:
        end = Timestamp(start_ticks + mean_ticks)
    except ValueError:
        # A valid catalog instant plus a valid duration can exceed year 9999.
        return None
    return {'method': 'mean_last_5_successful', 'sample_count': count,
            'duration_seconds': total / (count * TICKS_PER_SECOND), 'ended_at': end.isoformat()}


def history_page(values, config):
    now = utc_now()
    try:
        if not {'folder', 'project', 'package'} <= values.keys():
            raise InvalidInput('A complete history scope is required.')
        matching = values.get('match', 'exact')
        if matching not in ('exact', 'like'):
            raise InvalidInput('Unsupported history matching mode.')
        selection = {name: inputs.catalog_name(values[name], utf16_units=512 if matching == 'like'
                                               else 260 if name == 'package' else 128)
                     for name in ('folder', 'project', 'package')}
        if matching == 'like':
            selection = {name: value.replace('*', '%') for name, value in selection.items()}
            selection['match'] = 'like'
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
    resource = 'api-history-pattern' if matching == 'like' else 'api-history'
    # Duplicate an included status rather than binding unused NULLs: identical
    # IN membership without pyodbc's per-NULL parameter-type descriptions.
    parameters = (selection['folder'], selection['project'], selection['package'], *status, *([status[0]] * (9 - len(status))))
    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        upper = query(resource + '-fence.sql', parameters, one_row=True)['upper_id']
        last = None
        if upper is not None:
            wire.bigint(upper)
    rows = [] if upper is None else query(resource + '-page.sql', (
        *parameters, selection['limit'] + 1, upper, 0 if last is None else last, int(selection['direction'] == 'desc')))
    if len(rows) > selection['limit'] + 1:
        raise ValueError('Unexpected history page size.')
    serialized = []
    for row in rows:
        wire.bigint(row['execution_id'])
        if (row['execution_id'] > upper
                or type(row['logging_rows']) is not int or row['logging_rows'] not in (0, 1)
                or (row['logging_rows'] == 0 and row['logging_level'] is not None)):
            raise ValueError('Unexpected history metadata.')
        serialized.append({**serialize_execution(row, as_of=as_of), 'estimate': serialize_estimate(row)})
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
