"""Read one visible execution before querying its recorded observations."""

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, serialization as wire
from dashboard.db import execute_query
from dashboard.executions import serialize_execution
from dashboard.observability import record_query
from dashboard.timestamps import utc_now


def execution_detail(value, config):
    identifier = inputs.identifier(value)
    now = utc_now()

    def query(resource):
        return execute_query(resource, (identifier,), connection_string=config['CONNECTION_STRING']['main'],
                             one_row=True, login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'],
                             query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'], typed_timestamps=True,
                             on_complete=record_query)

    row = query('api-execution.sql')
    if not row:
        raise NotFound()
    if (wire.bigint(row['execution_id']) != value or type(row['logging_rows']) is not int
            or row['logging_rows'] not in (0, 1)
            or (row['logging_rows'] == 0 and row['logging_level'] is not None)):
        raise ValueError('Unexpected execution metadata.')
    data = serialize_execution({**row, 'warning_count': 0, 'error_count': 0}, as_of=now)
    recorded = query('api-execution-event-counts.sql')
    if not recorded:
        # The second connection can observe retention or revoked visibility.
        raise NotFound()
    counts = {name: wire.count(recorded[name]) for name in (
        'all', 'errors', 'warnings', 'duplicate_warnings', 'memory_warnings')}
    if (counts['duplicate_warnings'] > counts['warnings']
            or counts['errors'] + counts['warnings'] + counts['memory_warnings'] > counts['all']):
        raise ValueError('Inconsistent recorded event counts.')
    data.update(warning_count=counts['warnings'], error_count=counts['errors'], event_counts=counts)
    return data
