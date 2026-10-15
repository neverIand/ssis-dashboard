"""Explicit SQL-to-JSON primitives; no Flask defaults or stringifying fallbacks."""

from decimal import Decimal
import math

from dashboard.timestamps import TICKS_PER_SECOND, as_timestamp
from dashboard.validation import PACKAGE_STATUS_CODES


EXECUTION_STATUSES = {code: name for code, name in PACKAGE_STATUS_CODES.items() if code != 0}
LOGGING_LEVELS = {0: 'none', 1: 'basic', 2: 'performance', 3: 'verbose', 4: 'runtime-lineage', 100: 'custom'}
EXECUTABLE_RESULTS = {0: 'success', 1: 'failure', 2: 'completion', 3: 'cancelled'}
PARAMETER_OBJECT_TYPES = {20: 'project', 30: 'package', 50: 'system'}
_BIGINT_MAX = 2**63 - 1
_EXACT_COUNT_MAX = 2**53 - 1


def bigint(value, *, allow_zero=False):
    if type(value) is not int or not (0 if allow_zero else 1) <= value <= _BIGINT_MAX:
        raise ValueError('Invalid SQL BIGINT identifier.')
    return str(value)


def lsn(value):
    return None if value is None else bigint(value, allow_zero=True)


def count(value):
    if type(value) is not int or not 0 <= value <= _EXACT_COUNT_MAX:
        raise ValueError('Invalid JSON count.')
    return value


def boolean(value):
    if type(value) is bool:
        return value
    if type(value) is int and value in (0, 1):
        return bool(value)
    raise ValueError('Invalid SQL Boolean flag.')


def seconds(value):
    if value is None:
        return None
    if type(value) not in (int, float, Decimal):
        raise ValueError('Invalid numeric duration.')
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise ValueError('Invalid numeric duration.') from None
    if not math.isfinite(result) or result < 0:
        raise ValueError('Invalid numeric duration.')
    return result


def utc_timestamp(value):
    return None if value is None else as_timestamp(value).isoformat()


def duration_seconds(start, end):
    if start is None or end is None:
        return None
    ticks = as_timestamp(end).utc_ticks - as_timestamp(start).utc_ticks
    if ticks < 0:
        raise ValueError('Invalid observed duration.')
    return ticks / TICKS_PER_SECOND


def elapsed_seconds(start, end, *, as_of):
    if start is None:
        return None
    finish = as_timestamp(end if end is not None else as_of)
    ticks = max(0, finish.utc_ticks - as_timestamp(start).utc_ticks)
    return ticks / TICKS_PER_SECOND


def _code(value, vocabulary, *, bits, nullable=False):
    if value is None and nullable:
        return None
    if type(value) is not int or not -(2**(bits - 1)) <= value < 2**(bits - 1):
        raise ValueError('Invalid catalog code.')
    return {'code': value, 'name': vocabulary.get(value, 'unknown')}


def execution_status(value):
    return _code(value, EXECUTION_STATUSES, bits=32)


def logging_level(value):
    return _code(value, LOGGING_LEVELS, bits=32, nullable=True)


def executable_result(value):
    return _code(value, EXECUTABLE_RESULTS, bits=16, nullable=True)


def parameter_object_type(value):
    return _code(value, PARAMETER_OBJECT_TYPES, bits=16)
