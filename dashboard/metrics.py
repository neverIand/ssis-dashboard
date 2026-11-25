"""Execution-cohort metrics, separate from page enrichment and event access."""

from dashboard import api_validation as inputs, serialization as wire
from dashboard.db import catalog_query
from dashboard.timestamps import sql_timestamp, utc_now


def execution_summary(values, config, *, fixed_to):
    selection, start, end = inputs.execution_cohort(values, config, now=utc_now(), fixed_to=fixed_to)
    # A selected table status is validated above, but cards always count all statuses.
    rows = catalog_query(config)('api-metrics-summary.sql', (
        sql_timestamp(start), sql_timestamp(end), selection['folder'], selection['project'], selection['package'],
        selection['folder_pattern'], selection['project_pattern']))
    counts = dict.fromkeys(wire.EXECUTION_STATUSES, 0)
    observed = set()
    for row in rows:
        code = wire.execution_status(row['status_code'])['code']
        if code in observed:
            raise ValueError('Duplicate summary status.')
        observed.add(code)
        counts[code] = wire.count(row['execution_count'])
    if len(counts) > 65536:
        raise ValueError('Summary exceeds the status-group limit.')
    data = {'total': wire.count(sum(counts.values())),
            'by_status': [{**wire.execution_status(code), 'count': counts[code]} for code in sorted(counts)]}
    return data, {'from': selection['from'], 'to': selection['to'], 'status_scope': 'all'}
