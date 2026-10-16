"""Read one visible execution before querying its recorded observations."""

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, serialization as wire
from dashboard.db import execute_query
from dashboard.executions import serialize_execution
from dashboard.observability import record_query
from dashboard.timestamps import utc_now


def _query(resource, identifier, config):
    return execute_query(resource, (identifier,), connection_string=config['CONNECTION_STRING']['main'],
                         one_row=True, login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'],
                         query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'], typed_timestamps=True,
                         on_complete=record_query)


def visible_execution(value, config, *, as_of):
    """Validate one visible execution before any scoped follow-up query."""
    identifier = inputs.identifier(value)
    row = _query('api-execution.sql', identifier, config)
    if not row:
        raise NotFound()
    if (wire.bigint(row['execution_id']) != value or type(row['logging_rows']) is not int
            or row['logging_rows'] not in (0, 1)
            or (row['logging_rows'] == 0 and row['logging_level'] is not None)):
        raise ValueError('Unexpected execution metadata.')
    return serialize_execution({**row, 'warning_count': 0, 'error_count': 0}, as_of=as_of)


def execution_detail(value, config):
    data = visible_execution(value, config, as_of=utc_now())
    recorded = _query('api-execution-event-counts.sql', int(data['execution_id']), config)
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
