"""Navigation HTTP/typed cursor contracts; native SQL/collation checks are separate."""

import base64
from copy import deepcopy
import json
import unittest
from unittest.mock import Mock, patch

import pyodbc

from dashboard import create_app, cursors
from dashboard.timestamps import Timestamp, TICKS_PER_SECOND, parse_timestamp
from tests import test_api_contract as contract_tests
from tests.test_db import ConnectionFixture


NOW = parse_timestamp('2026-10-16T12:00:00.1234567Z')


class NavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        contract_tests.APIContractTests.setUpClass()
        cls.contract = contract_tests.APIContractTests()

    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL')))
        self.clock = self.enterContext(patch('dashboard.navigation.utc_now', return_value=NOW))
        self.query = self.enterContext(patch('dashboard.navigation.execute_query', side_effect=self.query_fixture))
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR', 'EXECUTION_COUNT': 1,
                               'CONNECTION_STRING': {'main': 'private-connection-canary'}})
        self.client = self.app.test_client()
        self.folders = [{'folder_id': i, 'name': f'Folder {i:03}', 'description': None, 'visible': True}
                        for i in range(1, 252)]
        self.projects = [{'project_id': i, 'folder_id': 1, 'name': f'Project {252-i:03}',
                          'description': f'Project description {i}', 'visible': True} for i in range(1, 252)]
        self.projects += [{'project_id': 1000+i, 'folder_id': i, 'name': 'Shared',
                           'description': None, 'visible': True} for i in range(2, 252)]
        self.folders += [{'folder_id': 1000, 'name': 'Empty', 'description': '', 'visible': True},
                         {'folder_id': 1001, 'name': 'Hidden', 'description': None, 'visible': False}]
        self.projects.append({'project_id': 10000, 'folder_id': 1001, 'name': 'Hidden', 'description': None, 'visible': True})

    def query_fixture(self, resource, parameters, **settings):
        kind = 'projects' if resource.startswith('api-projects-') else 'folders'
        folders = {f['folder_id']: f for f in self.folders if f['visible']}
        projects = [p for p in self.projects if p['visible'] and p['folder_id'] in folders]
        if kind == 'folders':
            candidates = [f for f in folders.values() if any(p['folder_id'] == f['folder_id'] for p in projects)]
        else:
            folder, *parameters = parameters
            candidates = [{**p, 'folder_name': folders[p['folder_id']]['name']} for p in projects
                          if folders[p['folder_id']]['name'] == folder]
        id_field = 'folder_id' if kind == 'folders' else 'project_id'
        if resource.endswith('-fence.sql'):
            return {'upper_id': max((r[id_field] for r in candidates), default=None)}
        take, upper, last, last_name, by_name, descending = parameters
        boundary = ((last_name, last) if by_name else (last,)) if last is not None else None
        def key(row):
            return (row['name'], row[id_field]) if by_name else (row[id_field],)
        candidates = [r for r in candidates if r[id_field] <= upper and (
            boundary is None or (key(r) < boundary if descending else key(r) > boundary))]
        return sorted(candidates, key=key, reverse=bool(descending))[:take]

    def get(self, kind='folders', values=None):
        return self.client.get('/api/v1/' + kind, query_string=values or {})

    def page(self, kind='folders', **values):
        response = self.get(kind, values)
        self.assertEqual(response.status_code, 200, response.json)
        self.contract.validator('FoldersResponse' if kind == 'folders' else 'ProjectsResponse').validate(response.json)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.json['meta']['request_id'], response.headers['X-Request-ID'])
        self.assertIsNone(response.json['meta']['from'])
        self.assertIsNone(response.json['meta']['to'])
        return response.json

    def token(self, page):
        return json.loads(base64.urlsafe_b64decode(page['meta']['next_cursor'].split('.')[0] + '=='))

    def chain(self, kind, values, first=None):
        page = first or self.page(kind, **values)
        result = list(page['data'])
        while page['meta']['has_more']:
            page = self.page(kind, **{**values, 'cursor': page['meta']['next_cursor']})
            result += page['data']
            self.assertLess(len(result), 1000)
        return result

    def assert_invalid_cursor(self, kind, values):
        calls = self.query.call_count
        response = self.get(kind, values)
        self.assertEqual(response.status_code, 400, response.json)
        self.assertIn(response.json['code'], ('invalid_cursor', 'cursor_expired'))
        self.assertEqual(self.query.call_count, calls)

    def test_default_page_is_bounded_and_folders_require_visible_projects(self):
        page = self.page()
        self.assertEqual(len(page['data']), 50)
        self.assertEqual(page['meta']['upper_id'], '251')
        self.assertEqual(page['meta']['sort'], 'name')
        self.assertEqual(page['meta']['direction'], 'asc')
        self.assertEqual(page['meta']['as_of'], NOW.isoformat())
        self.assertTrue(page['meta']['has_more'])
        self.assertEqual(self.query.call_args.args[1], (51, 251, None, None, 1, 0))
        self.assertEqual(self.query.call_count, 2)
        self.connect.assert_not_called()

    def test_both_name_and_id_sorts_traverse_the_whole_collection_in_both_directions(self):
        for kind in ('folders', 'projects'):
            id_field = 'folder_id' if kind == 'folders' else 'project_id'
            for sort in ('name', id_field):
                for direction in ('asc', 'desc'):
                    with self.subTest(kind=kind, sort=sort, direction=direction):
                        values = {'limit': '200', 'sort': sort, 'direction': direction}
                        if kind == 'projects':
                            values['folder'] = 'Folder 001'
                        rows = self.chain(kind, values)
                        expected = list(range(1, 252))
                        descending = direction == 'desc'
                        if kind == 'projects' and sort == 'name':
                            descending = not descending
                        self.assertEqual([int(row[id_field]) for row in rows], sorted(expected, reverse=descending))
                        self.assertEqual(self.query.call_args.args[1][-6], 201)

    def test_project_folder_is_required_and_exact_names_are_decoded_once(self):
        self.assertEqual(self.get('projects').status_code, 400)
        self.query.assert_not_called()
        for name in ('all', '*', '%_[', "O'Brien/+#\\東京", '  Name  ', 'a'*128, '😀'*64, '%2F+'):
            with self.subTest(name=name):
                self.folders[0]['name'] = name
                page = self.page('projects', folder=name, limit='1')
                self.assertEqual(page['data'][0]['folder_id'], '1')
                self.assertEqual(page['data'][0]['folder_name'], name)
                self.assertEqual(self.query.call_args.args[1][0], name)
        self.folders[0]['name'] = '%2F+'
        response = self.client.get('/api/v1/projects?folder=%252F%2B&limit=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['data'][0]['folder_name'], '%2F+')

    def test_project_identity_and_parent_aliases_stay_distinct_across_folders(self):
        for identifier in (2, 3):
            row = self.page('projects', folder=f'Folder {identifier:03}')['data'][0]
            self.assertEqual(row, {'project_id': str(1000+identifier), 'folder_id': str(identifier),
                                   'folder_name': f'Folder {identifier:03}', 'name': 'Shared', 'description': None})

    def test_hidden_missing_and_empty_folder_scopes_are_successful_empty_collections(self):
        for folder in ('Hidden', 'Missing', 'Empty', "x' OR 1=1 --"):
            with self.subTest(folder=folder):
                self.query.reset_mock()
                page = self.page('projects', folder=folder)
                self.assertEqual(page['data'], [])
                self.assertIsNone(page['meta']['upper_id'])
                self.assertIsNone(page['meta']['next_cursor'])
                self.assertFalse(page['meta']['has_more'])
                self.query.assert_called_once()
        self.projects = []
        self.assertEqual(self.page()['data'], [])

    def test_typed_ids_and_full_width_descriptions_preserve_null_empty_and_text(self):
        self.folders = [{'folder_id': 9007199254740993, 'name': '😀'*64, 'description': '😀'*512, 'visible': True}]
        self.projects = [{'project_id': 9223372036854775807, 'folder_id': 9007199254740993,
                          'name': 'P'*128, 'description': '<script>text</script>\0', 'visible': True}]
        folder = self.page()['data'][0]
        row = self.page('projects', folder='😀'*64)['data'][0]
        self.assertEqual(folder['folder_id'], '9007199254740993')
        self.assertEqual(folder['description'], '😀'*512)
        self.assertEqual(row['project_id'], '9223372036854775807')
        self.assertEqual(row['description'], '<script>text</script>\0')
        self.projects[0]['description'] = ''
        self.assertEqual(self.page('projects', folder='😀'*64)['data'][0]['description'], '')

    def test_bad_inputs_fail_before_sql_and_never_fall_back_to_defaults(self):
        for kind in ('folders', 'projects'):
            base = {'folder': 'Folder 001'} if kind == 'projects' else {}
            for changes in ({'limit':'0'}, {'limit':'201'}, {'limit':'-1'}, {'limit':'bad'}, {'limit':'١'},
                            {'sort':'description'}, {'sort':'name;DROP'}, {'direction':'ASC'},
                            {'status':'7'}, {'from':'2026-10-16T00:00:00Z'}, {'folder_pattern':'*'}):
                with self.subTest(kind=kind, changes=changes):
                    self.assertEqual(self.get(kind, {**base, **changes}).status_code, 400)
        for folder in ('x'*129, '😀'*65):
            self.assertEqual(self.get('projects', {'folder': folder}).status_code, 400)
        self.query.assert_not_called()

    def test_cursor_is_bound_to_resource_folder_sort_limit_direction_and_sql_policy(self):
        first = self.page('projects', folder='Folder 001', limit='1')
        token = first['meta']['next_cursor']
        base = {'folder': 'Folder 001', 'limit': '1', 'cursor': token}
        for changes in ({'folder': 'Folder 002'}, {'sort': 'project_id'}, {'limit': '2'}, {'direction': 'desc'}):
            self.assert_invalid_cursor('projects', {**base, **changes})
        self.assert_invalid_cursor('projects', {'cursor': token, 'limit': '1'})
        self.assert_invalid_cursor('folders', {'cursor': token, 'limit': '1'})
        for updates in ({'CONNECTION_STRING': {'main': 'other identity'}}, {'API_EVENTS_ENABLED': True}):
            original = deepcopy(self.app.config)
            self.app.config.update(updates)
            self.assert_invalid_cursor('projects', base)
            self.app.config.update(original)
        with patch('dashboard.cursors._KEY', b'x'*32):
            self.assert_invalid_cursor('projects', base)

    def test_malformed_authenticated_seek_keys_fail_before_sql(self):
        first = self.page(limit='1')
        state = self.token(first)
        for changes in ({'sort_key': [None]}, {'sort_key': ['x'*129]}, {'sort_key': []},
                        {'sort_nulls': [True]}, {'sort_nulls': [0]}, {'sort_nulls': []},
                        {'upper_id': '0'}, {'last_id': '0'}, {'last_id': str(2**63)}, {'v': 1}):
            with self.subTest(changes=changes):
                self.assert_invalid_cursor('folders', {'limit':'1','cursor':cursors.seal({**state, **changes})})
        first = self.page(limit='1', sort='folder_id')
        state = self.token(first)
        for key in ('01', '0', '2', str(2**63)):
            self.assert_invalid_cursor('folders', {'limit':'1', 'sort':'folder_id',
                'cursor':cursors.seal({**state, 'sort_key':[key]})})
        self.assert_invalid_cursor('folders', {'cursor': 'private-canary'})

    def test_non_sliding_expiry_and_original_boundary_survive_retention(self):
        first = self.page('projects', folder='Folder 001', limit='1')
        last = int(first['data'][0]['project_id'])
        self.projects = [p for p in self.projects if p['project_id'] != last]
        self.clock.return_value = Timestamp(NOW.utc_ticks + 1799*TICKS_PER_SECOND)
        second = self.page('projects', folder='Folder 001', limit='1', cursor=first['meta']['next_cursor'])
        self.assertEqual(second['meta']['as_of'], NOW.isoformat())
        self.clock.return_value = Timestamp(NOW.utc_ticks + 1800*TICKS_PER_SECOND)
        self.assert_invalid_cursor('projects', {'folder':'Folder 001','limit':'1','cursor':second['meta']['next_cursor']})
        self.clock.return_value = NOW
        self.projects = []
        empty = self.page('projects', folder='Folder 001', limit='1', cursor=first['meta']['next_cursor'])
        self.assertEqual(empty['data'], [])
        self.assertIsNotNone(empty['meta']['upper_id'])
        self.assertFalse(empty['meta']['has_more'])

    def test_insert_fence_excludes_new_navigation_entries_until_refresh(self):
        first = self.page('projects', folder='Folder 001', limit='200', sort='project_id')
        self.projects.append({'project_id': 99999, 'folder_id':1,'name':'New','description':None,'visible':True})
        rows = self.chain('projects', {'folder':'Folder 001','limit':'200','sort':'project_id'}, first)
        self.assertNotIn('99999', [row['project_id'] for row in rows])
        refreshed = self.page('projects', folder='Folder 001', limit='1', sort='project_id', direction='desc')
        self.assertEqual(refreshed['data'][0]['project_id'], '99999')

    def test_invalid_catalog_rows_are_safe_server_errors(self):
        original = dict(self.folders[0])
        self.projects = [dict(self.projects[0])]
        for changes in ({'name':''}, {'name':'\0'}, {'name':'x'*129}, {'description':'😀'*513}, {'folder_id':0}):
            with self.subTest(changes=changes):
                self.folders = [{**original, **changes}]
                self.projects[0]['folder_id'] = self.folders[0]['folder_id']
                with self.assertLogs(self.app.logger, level='ERROR'):
                    response = self.get()
                self.assertEqual(response.status_code, 500)
                self.contract.validator('Problem').validate(response.json)

    def test_http_methods_unknown_encoding_and_bodies_keep_shared_guards(self):
        for kind in ('folders', 'projects'):
            path = '/api/v1/' + kind
            self.assertEqual(self.client.open(path, method='OPTIONS').status_code, 200)
            for suffix in ('?limit=1&limit=2', '?limit=%FF', '?cursor=', '?limit=%GG'):
                self.assertEqual(self.client.get(path + suffix).status_code, 400)
            self.assertEqual(self.client.get(path, data='private-canary').status_code, 400)
            self.assertEqual(self.client.post(path).status_code, 405)
        self.query.assert_not_called()
        response = self.client.head('/api/v1/projects?folder=Folder+001')
        self.assertEqual((response.status_code, response.data), (200, b''))
        self.assertEqual(self.query.call_count, 2)

    def test_query_boundary_uses_bound_values_unique_aliases_typed_ids_and_cleanup(self):
        self.query.side_effect = None
        from dashboard.db import execute_query
        self.query.side_effect = execute_query
        connections, sql_cursors = [], []
        row = {'project_id': 42, 'folder_id': 7, 'folder_name': 'Exact', 'name':'Child', 'description':None}
        for names, values in ((['upper_id'], [(42,)]), (list(row), [tuple(row.values())])):
            cursor = Mock()
            cursor.description = [(name,) for name in names]
            cursor.fetchone.return_value = values[0]
            cursor.fetchall.return_value = values
            connections.append(ConnectionFixture(cursor, []))
            sql_cursors.append(cursor)
        self.connect.side_effect = connections
        response = self.page('projects', folder='Exact')
        self.assertEqual(response['data'][0]['folder_name'], 'Exact')
        self.assertEqual(response['data'][0]['name'], 'Child')
        for connection, cursor in zip(connections, sql_cursors):
            connection.add_output_converter.assert_called_once()
            connection.close.assert_called_once()
            cursor.close.assert_called_once()
            sql, parameters = cursor.execute.call_args.args
            self.assertEqual(parameters[0], 'Exact')
            self.assertEqual(sql.count('?'), len(parameters))
            self.assertNotIn('Exact', sql)
            self.assertIn('nvarchar(128)', sql)
        self.assertIn('AS folder_name', sql_cursors[1].execute.call_args.args[0])

    def test_catalog_values_and_cursor_state_stay_out_of_application_logs(self):
        self.folders[0].update(name='private-folder-canary', description='private-description-canary')
        with self.assertLogs(self.app.logger, level='INFO') as logs:
            first = self.page('projects', folder='private-folder-canary', limit='1')
            self.assert_invalid_cursor('projects', {'folder':'private-folder-canary','limit':'1',
                'cursor':first['meta']['next_cursor']+'private-cursor-canary'})
        self.assertNotIn('private-', '\n'.join(logs.output))
        self.assertNotIn(first['meta']['next_cursor'], '\n'.join(logs.output))

    def test_database_failure_does_not_trigger_legacy_fallback_or_expose_diagnostics(self):
        self.query.side_effect = pyodbc.OperationalError('HYT00','private-canary')
        with self.assertLogs(self.app.logger, level='ERROR') as logs:
            response = self.get('projects', {'folder':'Folder 001'})
        self.assertEqual(response.status_code, 504)
        self.assertNotIn('private-', response.get_data(as_text=True)+'\n'.join(logs.output))
        self.query.assert_called_once()
