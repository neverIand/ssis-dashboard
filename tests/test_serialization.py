from decimal import Decimal
import json
import unittest

from dashboard import serialization as wire
from dashboard.timestamps import parse_timestamp
from tests import test_api_contract as contract_tests


class TypedSerializationTests(unittest.TestCase):
    def test_bigint_lsn_null_and_exact_count_limits(self):
        self.assertEqual(wire.bigint(9007199254740993), '9007199254740993')
        self.assertEqual(wire.bigint(2**63 - 1), '9223372036854775807')
        self.assertEqual(wire.lsn(0), '0')
        self.assertIsNone(wire.lsn(None))
        self.assertEqual(wire.count(2**53 - 1), 9007199254740991)
        for value in (True, 0, -1, 2**63, 1.0, '1', None):
            with self.subTest(id=value), self.assertRaises(ValueError):
                wire.bigint(value)
        for value in (True, -1, 2**53, 1.0, Decimal('1'), '1', None):
            with self.subTest(count=value), self.assertRaises(ValueError):
                wire.count(value)

    def test_boolean_flags_are_explicit(self):
        for value, expected in ((False, False), (True, True), (0, False), (1, True)):
            self.assertIs(wire.boolean(value), expected)
        for value in (None, -1, 2, '0', 'false', 0.0):
            with self.subTest(value=value), self.assertRaises(ValueError):
                wire.boolean(value)

    def test_durations_are_finite_numeric_seconds(self):
        self.assertIsNone(wire.seconds(None))
        self.assertEqual(wire.seconds(Decimal('1.250')), 1.25)
        self.assertEqual(wire.seconds(0), 0)
        for value in (True, -1, '1.25', float('nan'), float('inf'), Decimal('sNaN'), Decimal('1e10000')):
            with self.subTest(value=value), self.assertRaises(ValueError):
                wire.seconds(value)

    def test_actual_and_elapsed_times_handle_null_and_fixed_as_of(self):
        start = parse_timestamp('2026-10-15T12:00:00.1234567Z')
        end = parse_timestamp('2026-10-15T12:00:01.1234568Z')
        as_of = parse_timestamp('2026-10-15T12:00:02.1234569Z')
        self.assertEqual(wire.duration_seconds(start, end), 1.0000001)
        self.assertIsNone(wire.duration_seconds(start, None))
        self.assertIsNone(wire.duration_seconds(None, end))
        self.assertEqual(wire.elapsed_seconds(start, None, as_of=as_of), 2.0000002)
        self.assertEqual(wire.elapsed_seconds(start, end, as_of=as_of), 1.0000001)
        self.assertEqual(wire.elapsed_seconds(end, None, as_of=start), 0)
        self.assertIsNone(wire.elapsed_seconds(None, None, as_of=as_of))
        self.assertIsNone(wire.utc_timestamp(None))
        with self.assertRaises(ValueError):
            wire.duration_seconds(end, start)
        with self.assertRaises(ValueError):
            wire.elapsed_seconds(start, None, as_of=None)

    def test_code_vocabulary_and_unknown_fallback_keep_results_distinct(self):
        self.assertEqual(wire.execution_status(2), {'code': 2, 'name': 'running'})
        self.assertEqual(wire.executable_result(2), {'code': 2, 'name': 'completion'})
        self.assertEqual(wire.logging_level(4), {'code': 4, 'name': 'runtime-lineage'})
        self.assertEqual(wire.parameter_object_type(50), {'code': 50, 'name': 'system'})
        for code in (-2**31, 40000, 2**31 - 1):
            self.assertEqual(wire.execution_status(code), {'code': code, 'name': 'unknown'})
        self.assertEqual(wire.execution_status(0), {'code': 0, 'name': 'unknown'})
        self.assertIsNone(wire.logging_level(None))
        self.assertIsNone(wire.executable_result(None))
        for function, values in ((wire.execution_status, (None, True, '2', 2**31)),
                                 (wire.executable_result, (40000, True)),
                                 (wire.logging_level, ('basic', True))):
            for value in values:
                with self.subTest(function=function.__name__, value=value), self.assertRaises(ValueError):
                    function(value)

    def test_explicit_primitives_survive_strict_json(self):
        value = {
            'id': wire.bigint(9007199254740993), 'lsn': wire.lsn(None),
            'time': wire.utc_timestamp(parse_timestamp('2026-10-15T12:00:00.1234567+01:00')),
            'duration': wire.seconds(Decimal('1.25')), 'count': wire.count(0),
            'flag': wire.boolean(1), 'status': wire.execution_status(40000),
        }
        decoded = json.loads(json.dumps(value, allow_nan=False))
        self.assertEqual(decoded['id'], '9007199254740993')
        self.assertEqual(decoded['time'], '2026-10-15T11:00:00.1234567Z')
        self.assertIsNone(decoded['lsn'])
        self.assertIs(decoded['flag'], True)
        self.assertEqual(decoded['duration'], 1.25)

    def test_serialized_values_match_checked_in_schemas(self):
        contract_tests.APIContractTests.setUpClass()
        contract = contract_tests.APIContractTests()
        cases = [('Id', wire.bigint(2**63 - 1)), ('Lsn', wire.lsn(0)),
                 ('UtcTimestamp', wire.utc_timestamp(parse_timestamp('2026-10-15T12:00:00.1234567Z')))]
        for name, values, serialize in (
            ('ExecutionStatus', wire.EXECUTION_STATUSES, wire.execution_status),
            ('LoggingLevel', wire.LOGGING_LEVELS, wire.logging_level),
            ('ExecutableResult', wire.EXECUTABLE_RESULTS, wire.executable_result),
            ('ParameterObjectType', wire.PARAMETER_OBJECT_TYPES, wire.parameter_object_type),
        ):
            cases.extend((name, serialize(code)) for code in [*values, 123])
        for name, value in cases:
            with self.subTest(schema=name, value=value):
                contract.validator(name).validate(value)
