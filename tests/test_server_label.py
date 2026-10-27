"""Operational label reads preserve metadata isolation and safe error boundaries."""

from unittest.mock import patch
import unittest

import pyodbc

from dashboard import create_app
from tests import test_api_contract as contract_tests


class ServerLabelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('No live SQL')))
        self.query = self.enterContext(patch('dashboard.api.execute_query', return_value={'server_name': 'Synthetic SQL Server'}))
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'CRITICAL', 'DB_LOGIN_TIMEOUT_SECONDS': 19,
                               'DB_QUERY_TIMEOUT_SECONDS': 37, 'API_EVENTS_ENABLED': False, 'API_VALUES_ENABLED': False})
        self.client = self.app.test_client()

    def test_label_schema_and_bounded_read_without_login_or_connection_fields(self):
        response = self.client.get('/api/v1/server', headers={'X-Remote-User': 'private-canary'})
        self.assertEqual(response.status_code, 200)
        contract_tests.APIContractTests().validator('ServerResponse').validate(response.json)
        self.assertEqual(response.json['data'], {'server_name': 'Synthetic SQL Server'})
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Request-ID'], response.json['meta']['request_id'])
        self.assertEqual(self.query.call_args.args, ('api-server.sql',))
        self.assertTrue(self.query.call_args.kwargs['one_row'])
        for key in ('login_timeout', 'query_timeout'):
            self.assertEqual(self.query.call_args.kwargs[key], 5)
        self.assertNotIn('private-canary', response.get_data(as_text=True))
        self.connect.assert_not_called()

    def test_metadata_remains_database_free_and_does_not_include_server_identity(self):
        response = self.client.get('/api/v1/meta')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('server_name', response.json['data'])
        self.query.assert_not_called()
        self.connect.assert_not_called()

    def test_null_label_and_safe_query_failure_are_independent_of_metadata(self):
        self.query.return_value = {'server_name': None}
        self.assertEqual(self.client.get('/api/v1/server').json['data'], {'server_name': None})
        self.query.side_effect = pyodbc.Error('HYT00', 'private-driver-canary')
        failed = self.client.get('/api/v1/server')
        self.assertEqual(failed.status_code, 504)
        self.assertNotIn('private-', failed.get_data(as_text=True))
        self.assertEqual(self.client.get('/api/v1/meta').status_code, 200)


if __name__ == '__main__':
    unittest.main()
