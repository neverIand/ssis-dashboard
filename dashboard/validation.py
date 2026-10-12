"""Validate legacy selectors without opening a connection or accepting SQL names."""


class InvalidInput(ValueError):
    """A request selector failed validation; messages must not include input values."""


PACKAGE_STATUS_CODES = {
    0: 'all',
    1: 'created',
    2: 'running',
    3: 'cancelled',
    4: 'failed',
    5: 'pending',
    6: 'halted',
    7: 'succeeded',
    8: 'stopping',
    9: 'completed',
}
_STATUS_CODES_BY_NAME = {name: code for code, name in PACKAGE_STATUS_CODES.items()}

EVENT_QUERIES = {
    'all': 'package-events-all.sql',
    'errors': 'package-events-errors.sql',
    'warnings': 'package-events-warnings.sql',
    'duplicate-warnings': 'package-events-duplicate-warnings.sql',
    'memory-warnings': 'package-events-memory-warnings.sql',
}
DETAIL_QUERIES = {
    'execution-values': 'package-details-execution-values.sql',
    'execution-overrides': 'package-details-execution-overrides.sql',
}


def _select(value, choices, message):
    if not isinstance(value, str) or value not in choices:
        raise InvalidInput(message)
    return choices[value]


def status_code(status):
    return _select(status, _STATUS_CODES_BY_NAME, 'Select a supported execution status.')


def event_query(event_type):
    return _select(event_type, EVENT_QUERIES, 'Select a supported event category.')


def detail_query(detail_type):
    return _select(detail_type, DETAIL_QUERIES, 'Select a supported detail category.')


def validate_execution_id(execution_id):
    if type(execution_id) is not int or not 1 <= execution_id <= 2**63 - 1:
        raise InvalidInput('Execution ID must be a positive 64-bit integer.')
    return execution_id
