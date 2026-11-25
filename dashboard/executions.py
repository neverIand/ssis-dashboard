"""Filter, page and serialize visible executions without legacy presentation SQL."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.estimates import page_estimates
from dashboard.execution_order import CALCULATED_SORTS, EXECUTION_SORTS, encode_key, seek_values
from dashboard.observability import observed_duration
from dashboard.timestamps import sql_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = (*inputs.COHORT_PARAMETERS, 'limit', 'cursor', 'sort', 'direction')


def _selection(values, config, *, now, fixed_to):
    if 'cursor' in values and not {'from', 'to'} <= values.keys():
        raise cursors.InvalidCursor()
    selection, start, end = inputs.execution_cohort(values, config, now=now, fixed_to=fixed_to)
    selection['limit'] = inputs.integer(values['limit']) if 'limit' in values else 50
    selection['sort'] = values.get('sort', 'execution_id')
    selection['direction'] = values.get('direction', 'desc')
    if selection['sort'] not in EXECUTION_SORTS or selection['direction'] not in ('asc', 'desc'):
        raise InvalidInput('Unsupported execution order.')
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
        'duration_seconds': observed_duration(row['started_at'], row['ended_at']),
        'elapsed_seconds': wire.elapsed_seconds(row['started_at'], row['ended_at'], as_of=as_of),
        'warning_count': wire.count(row['warning_count']), 'error_count': wire.count(row['error_count']),
    }


def execution_page(values, config, *, fixed_to, estimate_cache):
    now = utc_now()
    with paging.cursor_inputs(values):
        selection, start, end = _selection(values, config, now=now, fixed_to=fixed_to)
        selection_digest = cursors.digest(selection)
        # The configured SQL identity and API policy define this local scope.
        # No browser identity/header participates; SQL visibility is rechecked.
        scope = cursors.scope_digest(config)
        state, upper, last, as_of = paging.continuation(values, resource='v1/executions', selection=selection_digest,
                                                        scope=scope, now=now)
        seek = seek_values(state, selection['sort'])

    query = catalog_query(config)
    status = selection['status']
    parameters = (sql_timestamp(start), sql_timestamp(end), selection['folder'], selection['project'], selection['package'],
                  selection['folder_pattern'], selection['project_pattern'], *status, *([None] * (9 - len(status))))
    if state is None:
        upper, _ = paging.fence(query, 'api-executions-fence.sql', parameters)
    page_parameters = (*parameters, selection['limit'] + 1, upper, last, int(selection['direction'] == 'desc'))
    resource = 'api-executions-page.sql'
    if selection['sort'] != 'execution_id':
        resource = ('api-executions-sort.sql' if selection['sort'] in CALCULATED_SORTS
                    else 'api-executions-ordered-page.sql')
        page_parameters += (selection['sort'], *seek)
    rows = [] if upper is None else query(resource, page_parameters)
    for row in rows:
        # Every list batch counts system LOGGING_LEVEL rows, as detail and History do. The look-ahead row is
        # checked too, so a conflict fails the same way wherever it falls (R-07 of the 19 November review).
        if (type(row['logging_rows']) is not int or row['logging_rows'] not in (0, 1)
                or (row['logging_rows'] == 0 and row['logging_level'] is not None)):
            raise ValueError('Unexpected execution metadata.')
    has_more = len(rows) > selection['limit']
    page = rows[:selection['limit']]
    # Elapsed time follows this request's clock; the cursor's first-page as_of only fences and expires the chain.
    # A duplicate is, for example, two system LOGGING_LEVEL rows joined to one execution.
    data = paging.unique([serialize_execution(row, as_of=now) for row in page], 'execution_id',
                         'Duplicate execution ID.')
    # Opt-in History estimates for active rows (UX batch C4): cache misses only, in one bounded read.
    estimates = page_estimates(data, query, config, estimate_cache)
    for item in data:
        item['estimate'] = estimates.get(item['execution_id'])
    token = None
    if has_more:
        key, nulls = encode_key(page[-1], selection['sort'])
        token = paging.next_cursor(resource='v1/executions', selection=selection_digest, scope=scope, as_of=as_of,
                                   upper=upper, last_id=data[-1]['execution_id'], key=key, nulls=nulls)
    return data, paging.page_meta(limit=selection['limit'], sort=selection['sort'], direction=selection['direction'],
                                  as_of=as_of, upper=upper, token=token, has_more=has_more,
                                  start=selection['from'], end=selection['to'])
