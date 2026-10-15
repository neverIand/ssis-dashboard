"""Exact SQL datetimeoffset instants, kept separate from display formatting.

Python datetime stops at microseconds. Integer UTC ticks retain SQL's seventh
fractional digit for JSON, cursor comparisons and explicit SQL parameter casts.
"""

from dataclasses import dataclass
from datetime import date, datetime
import re
import struct


SQL_SS_TIMESTAMPOFFSET = -155
TICKS_PER_SECOND = 10_000_000
_TICKS_PER_DAY = 86_400 * TICKS_PER_SECOND
_MAX_TICKS = date.max.toordinal() * _TICKS_PER_DAY - 1
_NATIVE_TIMESTAMP = struct.Struct('<6hI2h')
_INPUT = re.compile(
    r'([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})'
    r'(?:\.([0-9]{1,7}))?(Z|[+-](?:0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)'
)
_INVALID = 'Invalid offset-aware SQL timestamp.'


@dataclass(frozen=True, slots=True, order=True)
class Timestamp:
    """One UTC instant in 100-nanosecond ticks since 0001-01-01; never JSON."""

    utc_ticks: int

    def __post_init__(self):
        if type(self.utc_ticks) is not int or not 0 <= self.utc_ticks <= _MAX_TICKS:
            raise ValueError(_INVALID)

    def isoformat(self):
        days, within_day = divmod(self.utc_ticks, _TICKS_PER_DAY)
        day = date.fromordinal(days + 1)
        seconds, fraction = divmod(within_day, TICKS_PER_SECOND)
        hours, seconds = divmod(seconds, 3600)
        minutes, seconds = divmod(seconds, 60)
        return (
            f'{day.year:04d}-{day.month:02d}-{day.day:02d}T'
            f'{hours:02d}:{minutes:02d}:{seconds:02d}.{fraction:07d}Z'
        )


def _from_parts(year, month, day, hour, minute, second, fraction, offset_minutes):
    try:
        local = datetime(year, month, day, hour, minute, second)
    except (ValueError, OverflowError):
        raise ValueError(_INVALID) from None
    if not 0 <= fraction < TICKS_PER_SECOND or not -840 <= offset_minutes <= 840:
        raise ValueError(_INVALID)
    ticks = ((local.toordinal() - 1) * 86_400 + hour * 3600 + minute * 60 + second)
    return Timestamp((ticks - offset_minutes * 60) * TICKS_PER_SECOND + fraction)


def parse_timestamp(value):
    """Parse the contract's offset-aware input without losing 100-ns precision."""
    match = _INPUT.fullmatch(value) if isinstance(value, str) else None
    if match is None or match[8] == '-00:00':
        raise ValueError(_INVALID)
    offset = match[8]
    offset_minutes = 0
    if offset != 'Z':
        offset_minutes = (int(offset[1:3]) * 60 + int(offset[4:6])) * (1 if offset[0] == '+' else -1)
    return _from_parts(
        *(int(match[index]) for index in range(1, 7)),
        int((match[7] or '').ljust(7, '0')), offset_minutes,
    )


def as_timestamp(value):
    """Accept an exact instant or aware datetime; strings require explicit parsing."""
    if isinstance(value, Timestamp):
        return value
    if not isinstance(value, datetime):
        raise ValueError(_INVALID)
    offset = value.utcoffset()
    if offset is None:
        raise ValueError(_INVALID)
    offset_seconds = offset.total_seconds()
    if offset_seconds % 60:
        raise ValueError(_INVALID)
    return _from_parts(
        value.year, value.month, value.day, value.hour, value.minute, value.second,
        value.microsecond * 10, int(offset_seconds // 60),
    )


def decode_datetimeoffset(value):
    """Decode Driver 17's little-endian SQL_SS_TIMESTAMPOFFSET_STRUCT.

    Register on each opted-in logical connection, never globally. pyodbc passes
    non-NULL bytes only; fractions are nanoseconds, offsets are signed H/M.
    """
    if not isinstance(value, bytes) or len(value) != _NATIVE_TIMESTAMP.size:
        raise ValueError(_INVALID)
    year, month, day, hour, minute, second, nanos, offset_hour, offset_minute = _NATIVE_TIMESTAMP.unpack(value)
    if (nanos >= 1_000_000_000 or nanos % 100 or abs(offset_minute) > 59
            or abs(offset_hour) > 14 or offset_hour * offset_minute < 0):
        raise ValueError(_INVALID)
    return _from_parts(
        year, month, day, hour, minute, second, nanos // 100,
        offset_hour * 60 + offset_minute,
    )


def sql_timestamp(value):
    """Bind this string with CONVERT(datetimeoffset(7), ?), never as datetime."""
    return as_timestamp(value).isoformat()[:-1] + '+00:00'
