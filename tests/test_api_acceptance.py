"""Shared acceptance boundaries on every production GET, without a database."""

import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch

import pyodbc

from dashboard import create_app
from tests import test_api_contract as contract_tests


WINDOW = {'from':'2026-10-14T00:00:00Z', 'to':'2026-10-17T00:00:00Z'}
OPERATIONS = {
    '/api/v1/meta': ('MetaResponse', {}),
    '/healthz': ('LivenessResponse', {}),
    '/readyz': ('ReadinessResponse', {}),
    '/api/v1/folders': ('FoldersResponse', {}),
    '/api/v1/projects': ('ProjectsResponse', {'folder':'Folder'}),
    '/api/v1/executions': ('ExecutionsResponse', WINDOW),
    '/api/v1/metrics/summary': ('SummaryResponse', WINDOW),
    '/api/v1/metrics/timeline': ('TimelineResponse', WINDOW),
    '/api/v1/executions/{id}': ('ExecutionResponse', {}),
    '/api/v1/executions/{id}/executables': ('ExecutablesResponse', {}),
    '/api/v1/executions/{id}/children': ('ChildrenResponse', {}),
    '/api/v1/executions/{id}/events': ('EventsResponse', {}),
    '/api/v1/executions/{id}/values': ('ValuesResponse', {}),
    '/api/v1/history': ('HistoryResponse', {'folder':'Folder', 'project':'Project', 'package':'Probe.dtsx'}),
}
NO_DATABASE = {'/api/v1/meta', '/healthz'}
CLAIMED_IDENTITY = {'X-Request-ID':'private-canary', 'X-Forwarded-User':'private-canary',
                    'X-Remote-User':'private-canary', 'X-API-Events-Enabled':'true',
                    'Authorization':'Bearer private-canary'}


class APIAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.app = create_app({'TESTING':True, 'LOG_LEVEL':'INFO',
                               'API_EVENTS_ENABLED':True, 'API_VALUES_ENABLED':True,
                               'CONNECTION_STRING':{'main':'private-connection-canary'}})
        self.client = self.app.test_client()

    def verify(self, response, schema, status):
        self.assertEqual(response.status_code, status)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertNotIn('Access-Control-Allow-Origin', response.headers)
        self.assertRegex(response.headers['X-Request-ID'], r'\A[0-9a-f]{32}\Z')
        self.assertNotIn('private-', response.get_data(as_text=True))
        if response.request.method != 'HEAD':
            self.contract.validator(schema).validate(response.json)
            identity = response.json['request_id'] if schema == 'Problem' else response.json['meta']['request_id']
            self.assertEqual(response.headers['X-Request-ID'], identity)
            self.assertEqual(response.mimetype, 'application/problem+json' if schema == 'Problem' else 'application/json')
        else:
            self.assertEqual(response.data, b'')

    def test_acceptance_inventory_matches_openapi_schemas_and_documented_routes(self):
        self.assertEqual(set(OPERATIONS), set(self.contract.spec['paths']))
        document = (Path(__file__).resolve().parents[1]/'docs/API_ACCEPTANCE.md').read_text(encoding='utf-8')
        for path, (schema, _) in OPERATIONS.items():
            with self.subTest(path=path):
                self.assertIn('`GET '+path+'`', document)
                response = self.contract.spec['paths'][path]['get']['responses']['200']
                if '$ref' in response:
                    response = self.contract.resolve(response['$ref'])
                self.assertEqual(response['content']['application/json']['schema']['$ref'], '#/components/schemas/'+schema)

    def test_api_null_binding_precondition_all_markers_have_explicit_sql_declarations(self):
        from dashboard.db import load_query

        for resource in (Path(__file__).resolve().parents[1]/'dashboard/query').glob('api-*.sql'):
            with self.subTest(resource=resource.name):
                sql = re.sub(r'(?m)^[ \t]*--[^\n]*', '', load_query(resource.name))
                declared = re.findall(r'\bDECLARE\s+@[^;]+;', sql, flags=re.IGNORECASE)
                self.assertEqual(sql.count('?'), sum(statement.count('?') for statement in declared),
                                 'Explicit NULL binding requires SQL to declare every parameter type.')

    def test_sql_variant_integer_conversions_stay_behind_their_parameter_filter(self):
        from dashboard.db import load_query

        # SQL Server may evaluate SELECT expressions before WHERE. Other parameter
        # values can be text, so an integer conversion needs its own CASE guard.
        unguarded = re.compile(r'CONVERT\(\s*(?:big|small|tiny)?int\s*,(?!\s*CASE\b)[^)]*parameter_value',
                               re.IGNORECASE)
        for resource in (Path(__file__).resolve().parents[1]/'dashboard/query').glob('api-*.sql'):
            with self.subTest(resource=resource.name):
                sql = re.sub(r'(?m)^[ \t]*--[^\n]*', '', load_query(resource.name))
                self.assertIsNone(unguarded.search(sql))

    def test_all_production_gets_reject_invalid_queries_bodies_and_methods_before_sql(self):
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            for template, (_, values) in OPERATIONS.items():
                path = template.format(id=42)
                for method, body in (('GET', None), ('GET', 'private-canary'), ('HEAD', 'private-canary'), ('POST', None)):
                    with self.subTest(path=path, method=method, body=body):
                        status = 405 if method == 'POST' else 400
                        response = self.client.open(path, method=method, data=body,
                            query_string={**values, **({'unexpected':'private-canary'} if body is None else {})},
                            headers=CLAIMED_IDENTITY)
                        self.verify(response, 'Problem', status)
                        if status == 405:
                            self.assertTrue({'GET','HEAD','OPTIONS'} <= set(response.headers['Allow'].replace(' ','').split(',')))
        self.connect.assert_not_called()
        self.assertNotIn('private-', '\n'.join(logged.output))

    def test_every_database_resource_maps_safe_failures_and_health_stays_independent(self):
        for sqlstate, status in (('08001',503), ('HYT00',504), ('42000',500)):
            self.connect.reset_mock()
            self.connect.side_effect = pyodbc.Error(sqlstate, 'private-diagnostic-canary')
            with self.assertLogs(self.app.logger, level='INFO') as logged:
                for template, (schema, values) in OPERATIONS.items():
                    path = template.format(id=42)
                    with self.subTest(path=path, sqlstate=sqlstate):
                        before = self.connect.call_count
                        independent = template in NO_DATABASE
                        response = self.client.get(path, query_string=values, headers=CLAIMED_IDENTITY)
                        self.verify(response, schema if independent else 'Problem', 200 if independent else status)
                        self.assertEqual(self.connect.call_count-before, 0 if independent else 1)
            records = [json.loads(item.getMessage()) for item in logged.records]
            completed = [item for item in records if item['event']=='request_completed']
            self.assertEqual(len(completed), len(OPERATIONS))
            self.assertEqual(sorted(item['query_count'] for item in completed), [0,0]+[1]*12)
            self.assertNotIn('private-', '\n'.join(logged.output))

    def test_default_text_value_guards_ignore_claimed_identity_including_head_options(self):
        self.app.config.update(API_EVENTS_ENABLED=False, API_VALUES_ENABLED=False)
        with self.assertLogs(self.app.logger, level='INFO') as logged:
            for suffix in ('events','values'):
                for identifier in ('42','9223372036854775807'):
                    for method in ('GET','HEAD','OPTIONS'):
                        with self.subTest(suffix=suffix, identifier=identifier, method=method):
                            response = self.client.open('/api/v1/executions/'+identifier+'/'+suffix,
                                                        method=method, headers=CLAIMED_IDENTITY)
                            self.verify(response, 'Problem', 403)
            meta = self.client.get('/api/v1/meta', headers=CLAIMED_IDENTITY)
            self.verify(meta, 'MetaResponse', 200)
            self.assertEqual(meta.json['data']['capabilities'], {'events':False,'values':False,'override_values':False})
        self.connect.assert_not_called()
        self.assertNotIn('private-', '\n'.join(logged.output))
