from datetime import datetime, timedelta, timezone
import struct
import unittest

from dashboard.timestamps import (
    Timestamp, as_timestamp, decode_datetimeoffset, parse_timestamp, sql_timestamp,
)


class ExactTimestampTests(unittest.TestCase):
    def test_native_offset_and_seventh_digit_normalize_without_rounding(self):
        cases = [
            ((2026, 10, 15, 12, 34, 56, 123456700, 5, 45), '2026-10-15T06:49:56.1234567Z'),
            ((2026, 10, 15, 0, 0, 0, 100, 0, -30), '2026-10-15T00:30:00.0000001Z'),
            ((2026, 10, 15, 23, 59, 59, 999999900, -14, 0), '2026-10-16T13:59:59.9999999Z'),
            ((2026, 1, 1, 0, 0, 0, 0, 14, 0), '2025-12-31T10:00:00.0000000Z'),
        ]
        for parts, expected in cases:
            with self.subTest(parts=parts):
                result = decode_datetimeoffset(struct.pack('<6hI2h', *parts))
                self.assertEqual(result.isoformat(), expected)
                self.assertEqual(parse_timestamp(expected), result)

    def test_supported_input_precision_and_offsets(self):
        for suffix, expected in [('', '0000000'), ('.1', '1000000'), ('.123456', '1234560'), ('.1234567', '1234567')]:
            with self.subTest(suffix=suffix):
                self.assertEqual(parse_timestamp(f'2026-10-15T12:00:00{suffix}+01:00').isoformat(),
                                 f'2026-10-15T11:00:00.{expected}Z')
        self.assertEqual(parse_timestamp('2026-10-15T00:00:00+00:00'),
                         parse_timestamp('2026-10-15T00:00:00Z'))

    def test_input_rejects_invalid_dates_offsets_and_noncanonical_forms(self):
        cases = [None, 42, '', '2026-10-15T12:00:00', '2026-10-15 12:00:00Z',
                 '2026-10-15t12:00:00z', '2026-10-15T12:00:00-00:00',
                 '2026-10-15T12:00:00+14:01', '2026-10-15T12:00:00-14:01',
                 '2026-10-15T12:00:00+15:00', '2026-10-15T12:00:60Z',
                 '2026-10-15T12:00:00.12345678Z', '2026-02-30T12:00:00Z',
                 '2026-10-15T24:00:00Z', '2026-10-15T12:00:00Z\n',
                 '0001-01-01T00:00:00+00:01', '9999-12-31T23:59:59-00:01']
        for value in cases:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^Invalid offset-aware SQL timestamp\\.$'):
                parse_timestamp(value)

    def test_timestamp_range_and_exact_ordering(self):
        earliest = parse_timestamp('0001-01-01T00:00:00Z')
        latest = parse_timestamp('9999-12-31T23:59:59.9999999Z')
        self.assertEqual(earliest.utc_ticks, 0)
        self.assertEqual(earliest.isoformat(), '0001-01-01T00:00:00.0000000Z')
        self.assertEqual(latest.isoformat(), '9999-12-31T23:59:59.9999999Z')
        first = parse_timestamp('2026-10-15T12:00:00.1234566Z')
        second = parse_timestamp('2026-10-15T12:00:00.1234567Z')
        self.assertLess(first, second)
        self.assertEqual(second.utc_ticks - first.utc_ticks, 1)
        for ticks in (True, -1, latest.utc_ticks + 1, 1.0, '1'):
            with self.subTest(ticks=ticks), self.assertRaises(ValueError):
                Timestamp(ticks)

    def test_aware_datetime_conversion_and_explicit_sql_binding(self):
        source = datetime(2026, 10, 15, 12, 0, 0, 123456, tzinfo=timezone(timedelta(hours=-3, minutes=-30)))
        self.assertEqual(as_timestamp(source).isoformat(), '2026-10-15T15:30:00.1234560Z')
        value = parse_timestamp('2026-10-15T12:00:00.1234567+01:00')
        self.assertEqual(sql_timestamp(value), '2026-10-15T11:00:00.1234567+00:00')
        self.assertEqual(parse_timestamp(sql_timestamp(value)), value)
        for source in (None, '2026-10-15T12:00:00Z', datetime(2026, 10, 15),
                       datetime(2026, 10, 15, tzinfo=timezone(timedelta(seconds=30)))):
            with self.subTest(source=source), self.assertRaises(ValueError):
                as_timestamp(source)

    def test_invalid_native_structures_fail_without_echoing_bytes(self):
        valid = (2026, 10, 15, 12, 0, 0, 123456700, 0, 0)
        cases = [None, b'private-bytes', b'\0' * 21]
        for index, replacement in ((0, 0), (5, 60), (6, 1000000000), (6, 123456789), (7, 15), (8, 60)):
            parts = list(valid)
            parts[index] = replacement
            cases.append(struct.pack('<6hI2h', *parts))
        cases.append(struct.pack('<6hI2h', *valid[:7], 5, -30))
        cases.append(struct.pack('<6hI2h', *valid[:7], 14, 1))
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, '^Invalid offset-aware SQL timestamp\\.$'):
                decode_datetimeoffset(raw)
