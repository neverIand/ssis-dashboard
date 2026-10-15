"""Strict API inputs; decode once and reject supplied invalid values before SQL."""

import re
from urllib.parse import parse_qsl

from dashboard.timestamps import parse_timestamp
from dashboard.validation import InvalidInput


def query_arguments(raw, allowed):
    if re.search(rb'%(?![0-9A-Fa-f]{2})', raw):
        raise InvalidInput('Invalid query encoding.')
    try:
        pairs = parse_qsl(raw.decode('utf-8'), keep_blank_values=True, strict_parsing=True,
                          encoding='utf-8', errors='strict', max_num_fields=max(1, len(allowed)))
    except (ValueError, UnicodeError):
        raise InvalidInput('Invalid query encoding.') from None
    values = {}
    for key, value in pairs:
        if key not in allowed or key in values or not value or '\0' in key or '\0' in value:
            raise InvalidInput('Unsupported or invalid query parameter.')
        values[key] = value
    return values


def integer(value, *, minimum=1, maximum=200):
    if (not isinstance(value, str) or len(value) > len(str(maximum))
            or re.fullmatch(r'[0-9]+', value) is None):
        raise InvalidInput('Invalid integer parameter.')
    result = int(value)
    if not minimum <= result <= maximum:
        raise InvalidInput('Integer parameter is out of range.')
    return result


def execution_id(value):
    if not isinstance(value, str) or value.startswith('0'):
        raise InvalidInput('Invalid execution ID.')
    return integer(value, maximum=2**63 - 1)


def catalog_name(value, *, utf16_units=128):
    if not isinstance(value, str) or not value or '\0' in value:
        raise InvalidInput('Invalid catalog name.')
    try:
        width = len(value.encode('utf-16-le')) // 2
    except UnicodeError:
        raise InvalidInput('Invalid catalog name.') from None
    if width > utf16_units:
        raise InvalidInput('Catalog name is too long.')
    return value


def statuses(value):
    tokens = value.split(',') if isinstance(value, str) else []
    if not tokens or len(tokens) != len(set(tokens)) or any(token not in '123456789' or len(token) != 1 for token in tokens):
        raise InvalidInput('Invalid status selection.')
    return tuple(sorted(int(token) for token in tokens))


def timestamp(value):
    try:
        return parse_timestamp(value)
    except ValueError:
        raise InvalidInput('Invalid timestamp parameter.') from None
