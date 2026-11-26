"""Validate the tracked API draft without importing the app or querying SQL."""

from copy import deepcopy
import json
from pathlib import Path
import unittest

import yaml
from jsonschema import Draft202012Validator, FormatChecker, ValidationError
from openapi_spec_validator import OpenAPIV31SpecValidator


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STAGE_C_PATHS = {
    '/api/v1/meta', '/api/v1/server', '/api/v1/folders', '/api/v1/projects', '/api/v1/packages',
    '/api/v1/metrics/summary', '/api/v1/metrics/timeline', '/api/v1/executions',
    '/api/v1/executions/{id}', '/api/v1/executions/{id}/executables',
    '/api/v1/executions/{id}/children', '/api/v1/executions/{id}/events',
    '/api/v1/executions/{id}/values', '/api/v1/history', '/healthz', '/readyz',
}


class APIContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec = yaml.safe_load((PROJECT_ROOT / 'docs/openapi.yaml').read_text(encoding='utf-8'))
        cls.examples = cls.spec['components']['examples']

    def resolve(self, pointer):
        self.assertTrue(pointer.startswith('#/'), f'External reference: {pointer}')
        node = self.spec
        for part in pointer[2:].split('/'):
            node = node[part.replace('~1', '/').replace('~0', '~')]
        return node

    def validator(self, name):
        return Draft202012Validator({
            '$schema': 'https://json-schema.org/draft/2020-12/schema',
            '$ref': f'#/components/schemas/{name}',
            'components': self.spec['components'],
        }, format_checker=FormatChecker())

    def example_row(self, name):
        return deepcopy(self.examples[name]['value']['data'][0])

    def test_openapi_and_json_schemas_are_valid(self):
        OpenAPIV31SpecValidator(self.spec).validate()
        for name, schema in self.spec['components']['schemas'].items():
            with self.subTest(schema=name):
                Draft202012Validator.check_schema(schema)

    def test_all_references_resolve_locally(self):
        def walk(node):
            if isinstance(node, dict):
                if '$ref' in node:
                    with self.subTest(reference=node['$ref']):
                        self.resolve(node['$ref'])
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)
        walk(self.spec)

    def test_stage_c_operations_are_read_only_and_have_unique_parameters(self):
        self.assertEqual(set(self.spec['paths']), STAGE_C_PATHS)
        operations = []
        for path, item in self.spec['paths'].items():
            with self.subTest(path=path):
                self.assertEqual(set(item), {'get'})
                operation = item['get']
                self.assertIn(operation['x-implementation-status'], {'planned', 'implemented'})
                self.assertTrue(operation['x-milestone'].startswith('C') or
                                (path, operation['x-milestone']) in {('/api/v1/server', 'G02'), ('/api/v1/packages', 'F2')})
                self.assertNotIn('requestBody', operation)
                operations.append(operation['operationId'])
                parameters = [self.resolve(p['$ref']) if '$ref' in p else p for p in operation['parameters']]
                keys = [(p['in'], p['name']) for p in parameters]
                self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(operations), len(set(operations)))

    def test_values_has_an_optional_parameter_scope_without_an_all_token(self):
        operation = self.spec['paths']['/api/v1/executions/{id}/values']['get']
        parameters = [self.resolve(p['$ref']) for p in operation['parameters']]
        scope = next(p for p in parameters if p['name'] == 'scope')
        self.assertEqual((scope['in'], scope['required']), ('query', False))
        self.assertEqual(scope['schema'], {'type': 'string', 'enum': ['project', 'package', 'system']})
        self.assertIn('400', operation['responses'])

    def test_the_browser_test_copy_of_the_examples_is_current(self):
        # web/tests/openapi-examples.test.js runs this copy through the browser readers.
        from tests.export_openapi_examples import TARGET, examples
        # Compare as canonical JSON text: Python's == treats false as 0 and true as 1, JavaScript does not.
        canonical = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False)  # noqa: E731
        self.assertNotEqual(canonical({'flag': False}), canonical({'flag': 0}))
        self.assertEqual(canonical(examples()),
                         canonical({name: example['value'] for name, example in self.examples.items()}))
        self.assertEqual(canonical(json.loads(TARGET.read_text(encoding='utf-8'))), canonical(examples()),
                         'Stale copy: run python -m tests.export_openapi_examples')

    def test_response_examples_and_shared_headers_match_the_contract(self):
        for name, example in self.examples.items():
            with self.subTest(example=name):
                self.validator(name).validate(example['value'])
        for path, item in self.spec['paths'].items():
            for status, response in item['get']['responses'].items():
                with self.subTest(path=path, status=status):
                    if '$ref' in response:
                        response = self.resolve(response['$ref'])
                    self.assertTrue({'X-Request-ID', 'Cache-Control'} <= response['headers'].keys())
                    if status == '200':
                        media = response['content']['application/json']
                        name = media['schema']['$ref'].split('/')[-1]
                        for example in media['examples'].values():
                            self.validator(name).validate(self.resolve(example['$ref'])['value'])
                    else:
                        example = response['content']['application/problem+json']['example']
                        self.validator('Problem').validate(example)
                        self.assertEqual(example['status'], int(status))

    def test_invalid_ids_timestamps_and_status_selections_are_rejected(self):
        cases = [
            ('Id', 9007199254740993), ('Id', '0'), ('Id', '-1'),
            ('Id', '9223372036854775808'), ('Lsn', '9223372036854775808'),
            ('UtcTimestamp', '2026-10-15T11:00:00'),
            ('UtcTimestamp', '2026-10-15T11:00:00+01:00'),
            ('UtcTimestamp', '2026-02-30T11:00:00.0000000Z'),
            # Responses always carry seven fractional digits; the browser readers accept nothing else.
            ('UtcTimestamp', '2026-10-15T11:00:00Z'), ('UtcTimestamp', '2026-10-15T11:00:00.123Z'),
            ('UtcTimestamp', '2026-10-15T11:00:00.12345678Z'),
            ('InputTimestamp', '2026-10-15T11:00:00+14:01'),
            ('InputTimestamp', '2026-10-15T11:00:00-00:00'),
            ('StatusSelection', [2, 2]), ('StatusSelection', [0]),
            ('StatusSelection', [500]), ('StatusSelection', []),
            ('StatusSelection', [40000]),
        ]
        for name, value in cases:
            with self.subTest(schema=name, value=value):
                self.assertFalse(self.validator(name).is_valid(value))

    def test_large_ids_and_offset_timestamps_are_preserved_as_strings(self):
        for name, value in [
            ('Id', '9007199254740993'), ('Id', '9223372036854775807'),
            ('Lsn', '0'), ('Lsn', '9223372036854775807'),
            ('UtcTimestamp', '2026-10-15T11:00:00.1234567Z'),
            ('InputTimestamp', '2026-10-15T12:00:00.1234567+01:00'),
            ('InputTimestamp', '2026-10-15T12:00:00+14:00'),
        ]:
            with self.subTest(schema=name, value=value):
                self.validator(name).validate(value)

    def test_execution_status_accepts_unknown_codes_across_sql_int_range(self):
        for name in ('ExecutionStatus', 'StatusCount'):
            for code in (-2147483648, -40000, 40000, 2147483647):
                with self.subTest(schema=name, code=code):
                    value = {'code': code, 'name': 'unknown'}
                    if name == 'StatusCount':
                        value['count'] = 1
                    self.validator(name).validate(value)
            for code in (-2147483649, 2147483648):
                with self.subTest(schema=name, invalid_code=code):
                    value = {'code': code, 'name': 'unknown'}
                    if name == 'StatusCount':
                        value['count'] = 1
                    self.assertFalse(self.validator(name).is_valid(value))
        execution = self.example_row('ExecutionsResponse')
        execution.update(status={'code': 40000, 'name': 'unknown'},
                         logging_level={'code': 123, 'name': 'unknown'})
        self.validator('Execution').validate(execution)

    def test_value_meta_binds_section_to_its_fixed_sort(self):
        for example, section, sort in (('ParametersResponse', 'parameters', 'object_type'),
                                       ('OverridesResponse', 'overrides', 'property_id')):
            meta = deepcopy(self.examples[example]['value']['meta'])
            self.assertEqual((meta['section'], meta['sort'], meta['direction']), (section, sort, 'asc'))
            self.validator('ValuesPageMeta').validate(meta)
            for wrong in ('execution_parameter_id', 'property_id' if section == 'parameters' else 'object_type'):
                self.assertFalse(self.validator('ValuesPageMeta').is_valid({**meta, 'sort': wrong}))
            self.assertFalse(self.validator('ValuesPageMeta').is_valid({**meta, 'direction': 'desc'}))

    def test_sensitive_values_and_invalid_cross_field_states_are_rejected(self):
        cases = []
        parameter = self.example_row('ParametersResponse')
        parameter['value'] = 'must-not-leak'
        cases.append(('Parameter', deepcopy(parameter)))
        parameter.update(value=None, redacted=False)
        cases.append(('Parameter', parameter))
        override = self.example_row('OverridesResponse')
        override.update(sensitive=None, redacted=False, redaction_reason=None)
        cases.append(('PropertyOverride', override))
        page = deepcopy(self.examples['ExecutionsResponse']['value']['meta'])
        cases.append(('WindowPageMeta', {**page, 'has_more': True}))
        cases.append(('WindowPageMeta', {**page, 'next_cursor': 'unusable.example.token'}))
        child = self.example_row('ChildrenResponse')
        child['ended_at'] = '2026-10-15T11:00:00.0000000Z'
        cases.append(('ChildObservation', child))
        execution = self.example_row('ExecutionsResponse')
        execution.update(status={'code': 5, 'name': 'pending'}, started_at=None,
                         elapsed_seconds=None, duration_seconds=5)
        cases.append(('Execution', execution))
        execution = self.example_row('ExecutionsResponse')
        execution['error_count'] = 9007199254740992
        cases.append(('Execution', execution))
        history = self.example_row('HistoryResponse')
        history.update(started_at=None, elapsed_seconds=None)
        cases.append(('HistoryExecution', history))
        for count in (0,6):
            cases.append(('Estimate', {'method':'mean_last_5_successful', 'sample_count':count,
                                      'duration_seconds':1, 'ended_at':'2026-10-15T11:00:00.0000000Z'}))
        cases.append(('Capabilities', {'events': False, 'values': False, 'override_values': True}))
        for number, (name, value) in enumerate(cases):
            with self.subTest(case=number, schema=name):
                self.assertFalse(self.validator(name).is_valid(value))

    def test_pending_rows_and_cursor_continuation_metadata_are_valid(self):
        pending = self.example_row('ExecutionsResponse')
        pending.update(status={'code': 5, 'name': 'pending'}, started_at=None, elapsed_seconds=None)
        # Batch C4: only a started, unfinished row carries an estimate.
        with self.assertRaises(ValidationError):
            self.validator('Execution').validate(pending)
        pending['estimate'] = None
        self.validator('Execution').validate(pending)
        ended = self.example_row('ExecutionsResponse')
        ended.update(status={'code': 7, 'name': 'succeeded'}, ended_at='2026-10-15T11:00:00.0000000Z', duration_seconds=29.8765433)
        with self.assertRaises(ValidationError):
            self.validator('Execution').validate(ended)
        ended['estimate'] = None
        self.validator('Execution').validate(ended)
        page = deepcopy(self.examples['ExecutionsResponse']['value']['meta'])
        page.update(has_more=True, next_cursor='synthetic.cursor.signature')
        self.validator('WindowPageMeta').validate(page)
