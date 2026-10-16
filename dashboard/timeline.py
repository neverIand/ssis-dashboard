"""Bounded calendar intervals and creation-cohort counts, using one IANA clock."""

from datetime import datetime, timedelta, timezone
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

from dashboard import api_validation as inputs, serialization as wire
from dashboard.db import execute_query
from dashboard.observability import record_query
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, as_timestamp, sql_timestamp, utc_now
from dashboard.validation import InvalidInput


_EPOCH = datetime(1, 1, 1, tzinfo=timezone.utc)
_COUNTS = ('created_count', 'started_count', 'succeeded_count', 'failed_count')


def _datetime(instant):
    # Floor only for calendar lookup; comparisons and SQL retain all seven digits.
    return _EPOCH + timedelta(microseconds=instant.utc_ticks // 10)


def _transition(left, right, zone):
    """Find the UTC second at an IANA offset transition between valid instants."""
    first, last = left.utc_ticks // TICKS_PER_SECOND, right.utc_ticks // TICKS_PER_SECOND
    def offset(second):
        return _datetime(Timestamp(second * TICKS_PER_SECOND)).astimezone(zone).utcoffset()
    initial = offset(first)
    while last - first > 1:
        middle = (first + last) // 2
        if offset(middle) == initial:
            first = middle
        else:
            last = middle
    return Timestamp(last * TICKS_PER_SECOND)


def _shift(value, delta):
    try:
        return value + delta
    except OverflowError:
        return datetime.min if delta < timedelta(0) else datetime.max


def bucket_bounds(start, end, *, timezone_name, bucket, limit):
    """Calendar days or wall hours; folds and partial-hour transitions stay distinct."""
    if bucket not in ('day', 'hour'):
        raise InvalidInput('Unsupported timeline bucket.')
    step = timedelta(days=1) if bucket == 'day' else timedelta(hours=1)
    # Bound generation even when an administrator permits very long input ranges.
    if end.utc_ticks - start.utc_ticks > (limit + 4) * (172800 if bucket == 'day' else 3600) * TICKS_PER_SECOND:
        raise InvalidInput('Too many timeline buckets.')
    zone = ZoneInfo(timezone_name)
    try:
        local = [_datetime(t).astimezone(zone).replace(tzinfo=None, minute=0, second=0, microsecond=0)
                 for t in (start, end)]
        if bucket == 'day':
            local = [t.replace(hour=0) for t in local]
        current = _shift(min(local), -timedelta(days=2))
        stop = _shift(max(local), timedelta(days=2))
        boundaries = set()
        while current <= stop:
            candidates, valid = set(), set()
            for fold in (0, 1):
                try:
                    utc = current.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
                    instant = as_timestamp(utc)
                    candidates.add(instant)
                    if utc.astimezone(zone).replace(tzinfo=None) == current:
                        valid.add(instant)
                except (ValueError, OverflowError):
                    continue
            if bucket == 'hour':
                boundaries.update(valid)
            elif valid:
                # A repeated midnight starts one long calendar day, not two days.
                boundaries.add(min(valid))
            elif len(candidates) == 2:
                # A skipped midnight starts at the first real instant of that day.
                boundaries.add(_transition(min(candidates), max(candidates), zone))
            try:
                current += step
            except OverflowError:
                break
        ordered = sorted(boundaries)
        if bucket == 'hour':
            # Include 30-minute/historical transitions even without a valid :00.
            for left, right in zip(ordered, ordered[1:]):
                if _datetime(left).astimezone(zone).utcoffset() != _datetime(right).astimezone(zone).utcoffset():
                    boundaries.add(_transition(left, right, zone))
            ordered = sorted(boundaries)
        result = [(left, right) for left, right in zip(ordered, ordered[1:]) if left < end and right > start]
        if not result or result[0][0] > start or result[-1][1] < end or len(result) > limit:
            raise InvalidInput('Timeline bounds exceed the supported bucket range.')
        return result
    except InvalidInput:
        raise
    except (ValueError, OverflowError):
        raise InvalidInput('Timeline bounds exceed the supported calendar range.') from None


def execution_timeline(values, config, *, fixed_to):
    selection, start, end = inputs.execution_cohort(values, config, now=utc_now(), fixed_to=fixed_to)
    bucket = values.get('bucket', 'day')
    bounds = bucket_bounds(start, end, timezone_name=config['DISPLAY_TIMEZONE'], bucket=bucket,
                           limit=config['API_MAX_TIMELINE_BUCKETS'])
    intervals = ET.Element('buckets')
    for index, (left, right) in enumerate(bounds):
        ET.SubElement(intervals, 'b', i=str(index), s=sql_timestamp(left), e=sql_timestamp(right))
    status = selection['status']
    rows = execute_query('api-metrics-timeline.sql', (
        ET.tostring(intervals, encoding='unicode'), sql_timestamp(start), sql_timestamp(end),
        selection['folder'], selection['project'], selection['folder_pattern'], selection['project_pattern'],
        *status, *([None] * (9 - len(status)))),
        connection_string=config['CONNECTION_STRING']['main'],
        login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
        typed_timestamps=True, on_complete=record_query)
    if len(rows) != len(bounds):
        raise ValueError('Unexpected timeline bucket count.')
    data = []
    for index, (row, (left, right)) in enumerate(zip(rows, bounds)):
        if type(row['bucket_id']) is not int or row['bucket_id'] != index:
            raise ValueError('Unexpected timeline bucket identity.')
        counts = {key: wire.count(row[key]) for key in _COUNTS}
        if (counts['started_count'] > counts['created_count']
                or counts['succeeded_count'] + counts['failed_count'] > counts['created_count']):
            raise ValueError('Inconsistent timeline counts.')
        data.append({'start': left.isoformat(), 'end': right.isoformat(), **counts})
    return data, {'from': selection['from'], 'to': selection['to'], 'timezone': config['DISPLAY_TIMEZONE'],
                  'bucket': bucket, 'selected_statuses': list(status)}
