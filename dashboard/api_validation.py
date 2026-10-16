"""Strict API inputs; decode once and reject supplied invalid values before SQL."""

import re
from datetime import datetime, timezone
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
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


def identifier(value):
    if not isinstance(value, str) or value.startswith('0'):
        raise InvalidInput('Invalid catalog ID.')
    return integer(value, maximum=2**63 - 1)


execution_id = identifier


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


def catalog_pattern(value):
    """Translate the explicit * glob to a bound LIKE value using ESCAPE '~'."""
    catalog_name(value, utf16_units=512)
    translated = []
    index = 0
    while index < len(value):
        character = value[index]
        if character == '\\':
            index += 1
            if index == len(value) or value[index] not in ('*', '\\'):
                raise InvalidInput('Invalid pattern escape.')
            character = value[index]
        elif character == '*':
            translated.append('%')
            index += 1
            continue
        translated.append(('~' if character in '%_[~' else '') + character)
        index += 1
    return ''.join(translated)


def fixed_as_of(value, display_timezone):
    """Resolve a legacy fixed date once; ambiguous/missing local times fail startup."""
    if value == 'NOW':
        return None
    if not isinstance(value, str):
        raise ValueError('AS_OF_DATE must be NOW or a valid fixed timestamp.')
    normalized = value[:10] + value[10:].replace(' ', 'T', 1)
    if len(normalized) == 10:
        normalized += 'T00:00:00'
    try:
        # Explicit offsets use exactly the same seven-digit parser as requests.
        return parse_timestamp(normalized)
    except ValueError:
        pass
    try:
        local_ticks = parse_timestamp(normalized + 'Z').utc_ticks
        local = datetime.fromisoformat(normalized[:19])
        zone = ZoneInfo(display_timezone)
        instants = set()
        for fold in (0, 1):
            aware = local.replace(tzinfo=zone, fold=fold)
            if aware.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) == local:
                offset = int(aware.utcoffset().total_seconds())
                instants.add(Timestamp(local_ticks - offset * TICKS_PER_SECOND))
        if len(instants) == 1:
            return instants.pop()
    except (ValueError, OverflowError):
        pass
    raise ValueError('AS_OF_DATE must identify one valid instant; use an explicit offset for DST transitions.')


def time_window(values, *, now, fixed_to, hours, max_hours):
    end = timestamp(values['to']) if 'to' in values else (fixed_to or now)
    try:
        start = (timestamp(values['from']) if 'from' in values
                 else Timestamp(end.utc_ticks - hours * 3600 * TICKS_PER_SECOND))
    except ValueError:
        raise InvalidInput('Invalid time range.') from None
    span = end.utc_ticks - start.utc_ticks
    if not 0 < span <= max_hours * 3600 * TICKS_PER_SECOND:
        raise InvalidInput('Invalid time range.')
    return start, end
