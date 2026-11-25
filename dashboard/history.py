"""Bounded exact/LIKE history; estimates stay within each visible package."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.estimates import serialize_estimate
from dashboard.executions import serialize_execution
from dashboard.timestamps import utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('folder', 'project', 'package', 'match', 'status', 'limit', 'cursor', 'sort', 'direction')


def history_page(values, config):
    now = utc_now()
    with paging.cursor_inputs(values):
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
        state, upper, last, as_of = paging.continuation(values, resource='v1/history', selection=digest,
                                                        scope=scope, now=now)
        if state is not None and (type(state['sort_key']) is not list or state['sort_key'] != [state['last_id']]
                                  or type(state['sort_nulls']) is not list or len(state['sort_nulls']) != 1
                                  or state['sort_nulls'][0] is not False):
            raise cursors.InvalidCursor()

    # These batches bind no NULL: an unused status slot repeats an included status (below).
    query = catalog_query(config, declared_parameters=False)
    status = selection['status']
    resource = 'api-history-pattern' if matching == 'like' else 'api-history'
    # Duplicate an included status rather than binding unused NULLs: identical
    # IN membership without pyodbc's per-NULL parameter-type descriptions.
    parameters = (selection['folder'], selection['project'], selection['package'], *status, *([status[0]] * (9 - len(status))))
    if state is None:
        upper, _ = paging.fence(query, resource + '-fence.sql', parameters)
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
        serialized.append({**serialize_execution(row, as_of=now), 'estimate': serialize_estimate(row)})
    paging.unique(serialized, 'execution_id', 'Duplicate history execution ID.')
    has_more = len(serialized) > selection['limit']
    data = serialized[:selection['limit']]
    token = None
    if has_more:
        last_id = data[-1]['execution_id']
        token = paging.next_cursor(resource='v1/history', selection=digest, scope=scope, as_of=as_of,
                                   upper=upper, last_id=last_id, key=[last_id], nulls=[False])
    return data, paging.page_meta(limit=selection['limit'], sort='execution_id', direction=selection['direction'],
                                  as_of=as_of, upper=upper, token=token, has_more=has_more)
