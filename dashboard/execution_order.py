"""Wire sort keys and bound SQL seek values for execution paging."""

import re

from dashboard import api_validation as inputs, serialization as wire
from dashboard.cursors import InvalidCursor
from dashboard.timestamps import sql_timestamp
from dashboard.validation import InvalidInput


EXECUTION_SORTS = ('execution_id', 'created_at', 'started_at', 'ended_at', 'project_name',
                   'package_name', 'environment', 'status', 'logging_level', 'duration_seconds',
                   'warning_count', 'error_count')
_DATES = frozenset(('created_at', 'started_at', 'ended_at'))
_NUMBERS = frozenset(('status', 'logging_level', 'duration_seconds', 'warning_count', 'error_count'))


def _numeric_key(value, sort):
    if not isinstance(value, str) or re.fullmatch(r'0|-?[1-9][0-9]{0,18}', value) is None:
        raise ValueError('Invalid numeric sort key.')
    number = int(value)
    if sort in ('status', 'logging_level'):
        valid = -(2**31) <= number < 2**31
    else:
        valid = 0 <= number <= (2**53 - 1 if sort.endswith('_count') else 2**63 - 1)
    if not valid:
        raise ValueError('Invalid numeric sort key.')
    return number


def encode_key(row, sort):
    """Keep database keys exact; do not use JSON's rounded duration seconds."""
    if sort == 'execution_id':
        key = [wire.bigint(row['execution_id'])]
    elif sort in _DATES:
        key = [wire.utc_timestamp(row['sort_time'])]
    elif sort in _NUMBERS:
        number = row['sort_number']
        if number is not None and type(number) is not int:
            raise ValueError('Invalid numeric database key.')
        key = [None if number is None else str(number)]
    else:
        key = [row['sort_text1']]
        if sort == 'environment':
            key.append(row['sort_text2'])
    nulls = [value is None for value in key]
    try:
        seek_values({'sort_key': key, 'sort_nulls': nulls, 'last_id': wire.bigint(row['execution_id'])}, sort)
    except InvalidCursor:
        raise ValueError('Invalid database sort key.') from None
    return key, nulls


def seek_values(state, sort):
    """Validate authenticated state before SQL; return six fixed typed binds."""
    if state is None:
        return (None,) * 6
    try:
        key, nulls = state['sort_key'], state['sort_nulls']
        width = 2 if sort == 'environment' else 1
        if (type(key) is not list or len(key) != width or type(nulls) is not list or len(nulls) != width
                or any(type(flag) is not bool or flag != (value is None) for value, flag in zip(key, nulls))):
            raise ValueError('Invalid sort state.')
        number = stamp = text1 = text2 = None
        if sort == 'execution_id':
            if inputs.execution_id(key[0]) != inputs.execution_id(state['last_id']):
                raise ValueError('Invalid ID sort key.')
        elif sort in _DATES:
            stamp = sql_timestamp(inputs.timestamp(key[0])) if key[0] is not None else None
        elif sort in _NUMBERS:
            number = _numeric_key(key[0], sort) if key[0] is not None else None
        else:
            text1 = inputs.catalog_name(key[0], utf16_units=260 if sort == 'package_name' else 128) if key[0] is not None else None
            if sort == 'environment':
                text2 = inputs.catalog_name(key[1]) if key[1] is not None else None
        if sort in ('execution_id', 'created_at', 'project_name', 'package_name', 'status', 'warning_count', 'error_count') and nulls[0]:
            raise ValueError('Invalid NULL sort key.')
        return (int(nulls[0]), number, stamp, text1, int(nulls[1]) if width == 2 else 1, text2)
    except (ValueError, TypeError, KeyError, InvalidInput):
        raise InvalidCursor() from None
