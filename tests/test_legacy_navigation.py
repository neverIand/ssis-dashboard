"""Legacy bookmark boundaries and retained routes; no live SQL or browser acceptance."""

from html.parser import HTMLParser
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, quote, urljoin, urlsplit
import unittest

from flask import Flask
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.test import Client
from werkzeug.wrappers import Response

from dashboard import create_app
from dashboard.validation import EVENT_QUERIES, PACKAGE_STATUS_CODES
from tests.fixtures import LegacyMonitorFixture


PREFIXES = ('', '/ops/monitor')
LEGACY_PATHS = ('/', '/folder/Finance', '/folder/Finance/project/Load',
                '/folder/Finance/project/Load/status/failed', '/execution/42',
                '/execution/42/events/errors', '/execution/42/values',
                '/history/Finance/project/Load/status/all/package/Load.dtsx')


class LinkReader(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = {}
        self.href = None
        self.text = ''
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            self.href, self.text = dict(attrs).get('href'), ''

    def handle_data(self, data):
        if self.href is not None:
            self.text += data

    def handle_endtag(self, tag):
        if tag == 'a' and self.href is not None:
            self.links[self.text.strip()] = self.href
            self.href = None


class LegacyBookmarkTests(unittest.TestCase):
    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('No live SQL')))
        self.monitor = self.enterContext(patch('dashboard.views.monitor', Mock(wraps=LegacyMonitorFixture)))
        self.app = create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR'})
        self.clients = {prefix: Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response)
                        if prefix else self.app.test_client() for prefix in PREFIXES}

    def tearDown(self):
        self.connect.assert_not_called()

    def get(self, path, prefix='', **kwargs):
        return self.clients[prefix].get(prefix + path, **kwargs)

    def assert_redirect(self, path, destination, prefix='', method='GET'):
        response = self.clients[prefix].open(prefix + path, method=method)
        self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
        self.assertEqual(response.headers['Location'], prefix + destination)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
        self.assertTrue(response.headers['X-Request-ID'])
        if method == 'HEAD':
            self.assertEqual(response.data, b'')
        return response

    def test_all_supported_families_map_at_root_and_prefix_without_a_monitor(self):
        destinations = ('/app/', '/app/?folder=Finance', '/app/?folder=Finance&project=Load',
                        '/app/?folder=Finance&project=Load&status=4', '/app/executions/42',
                        '/app/executions/42#events/errors', '/app/executions/42#parameters')
        for prefix in PREFIXES:
            for path, destination in zip(LEGACY_PATHS, destinations):
                for method in ('GET', 'HEAD'):
                    with self.subTest(prefix=prefix, path=path, method=method):
                        self.assert_redirect(path + '?native=1', destination, prefix, method)
        self.monitor.assert_not_called()

    def test_every_status_and_category_uses_the_native_vocabulary(self):
        for prefix in PREFIXES:
            for code, name in PACKAGE_STATUS_CODES.items():
                with self.subTest(prefix=prefix, status=name):
                    suffix = f'?status={code}' if code else ''
                    self.assert_redirect(f'/folder/all/project/all/status/{name}?native=1', '/app/' + suffix, prefix)
            for kind in EVENT_QUERIES:
                with self.subTest(prefix=prefix, kind=kind):
                    fragment = '#events' + ('/' + kind if kind != 'all' else '')
                    self.assert_redirect(f'/execution/42/events/{kind}?native=1', '/app/executions/42' + fragment, prefix)
        self.monitor.assert_not_called()

    def test_sentinels_do_not_overwrite_exact_case_or_project_only_scope(self):
        for prefix in PREFIXES:
            for path, destination in (
                ('/folder/all', '/app/'), ('/folder/ALL', '/app/?folder=ALL'),
                ('/folder/all/project/Load', '/app/?project=Load'),
                ('/folder/Finance/project/all', '/app/?folder=Finance'),
            ):
                with self.subTest(prefix=prefix, path=path):
                    self.assert_redirect(path + '?native=1', destination, prefix)
        self.monitor.assert_not_called()

    def test_exact_names_survive_one_decode_and_query_encoding(self):
        for prefix in PREFIXES:
            for folder in ("O'Brien + 東京", ' Leading', 'A?B#C&D', 'a' * 100, '😀' * 50):
                project = 'Load v2'
                path = f'/folder/{quote(folder, safe="")}/project/{quote(project, safe="")}?native=1'
                with self.subTest(prefix=prefix, folder=folder):
                    response = self.get(path, prefix)
                    self.assertEqual(response.status_code, 302)
                    destination = urlsplit(response.headers['Location'])
                    self.assertEqual(destination.path, prefix + '/app/')
                    self.assertEqual(parse_qs(destination.query), {'folder': [folder], 'project': [project]})
                    self.assertEqual(destination.fragment, '')
        self.monitor.assert_not_called()

    def test_unsupported_names_never_become_exact_or_broader_scopes(self):
        names = ('A*B', 'A_B', 'A%B', 'A[BC]', 'A]B', 'A\\B', 'A ', '.', '..',
                 'a' * 101, '😀' * 51, 'A\0B', 'A\x01B', 'A\x7fB', 'A\x85B', 'A\ufffdB', '%2F')
        for prefix in PREFIXES:
            for name in names:
                for segment in ('folder', 'project'):
                    path = '/folder/' + quote(name, safe='') if segment == 'folder' else '/folder/Finance/project/' + quote(name, safe='')
                    with self.subTest(prefix=prefix, name=name, segment=segment):
                        response = self.get(path + '?native=1', prefix)
                        self.assertEqual(response.status_code, 409, response.get_data(as_text=True))
                        self.assertNotIn('Location', response.headers)
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        links = LinkReader(response.get_data(as_text=True)).links
                        self.assertEqual(links['Open legacy page'], '?')
                        self.assertEqual(links['Open native overview'], prefix + '/app/')
                        # Clearing the query preserves the original encoded legacy path.
                        original = 'http://localhost' + prefix + path + '?native=1'
                        fallback = urlsplit(urljoin(original, links['Open legacy page']))
                        self.assertEqual(fallback.path, prefix + path)
                        self.assertEqual(fallback.query, '')
        self.monitor.assert_not_called()

    def test_independent_history_remains_an_explicit_unsupported_entry(self):
        for prefix in PREFIXES:
            for status in ('all', 'failed', 'succeeded'):
                for method in ('GET', 'HEAD'):
                    with self.subTest(prefix=prefix, status=status, method=method):
                        path = f'/history/Finance/project/Load/status/{status}/package/Load.dtsx?native=1'
                        response = self.clients[prefix].open(prefix + path, method=method)
                        self.assertEqual(response.status_code, 409)
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
                        if method == 'HEAD':
                            self.assertEqual(response.data, b'')
        self.monitor.assert_not_called()

    def test_ids_are_canonical_decimal_without_javascript_precision_loss(self):
        for prefix in PREFIXES:
            for supplied, expected in (('1', '1'), ('00042', '42'), ('٤٢', '42'),
                                       ('9007199254740993', '9007199254740993'),
                                       ('9223372036854775807', '9223372036854775807')):
                for suffix, fragment in (('', ''), ('/events/all', '#events'), ('/values', '#parameters')):
                    with self.subTest(prefix=prefix, supplied=supplied, suffix=suffix):
                        self.assert_redirect('/execution/' + quote(supplied, safe='') + suffix + '?native=1',
                                             '/app/executions/' + expected + fragment, prefix)
        self.monitor.assert_not_called()

    def test_invalid_opt_in_queries_fail_before_any_legacy_or_native_read(self):
        queries = ('native', 'native=', 'native=0', 'native=true', 'native=01', 'native=1&native=1',
                   'native=1&status=failed', 'native=1&from=2026-10-25', 'native=1&q=private-input',
                   'native=1&return=https://attacker.invalid/private-input', 'native=%ZZ',
                   'native=%FF', 'native=%00', 'native=1&%FF=x', 'native=1&', 'native=1;extra=x')
        for prefix in PREFIXES:
            for path in ('/', '/execution/42/events/errors', LEGACY_PATHS[-1]):
                for query in queries:
                    with self.subTest(prefix=prefix, path=path, query=query):
                        response = self.get(path + '?' + query, prefix)
                        self.assertEqual(response.status_code, 400)
                        self.assertNotIn('Location', response.headers)
                        self.assertNotIn('private-input', response.get_data(as_text=True))
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assert_redirect('/?%6Eative=%31', '/app/')
        self.monitor.assert_not_called()

    def test_invalid_selectors_and_unmatched_paths_keep_their_status(self):
        for prefix in PREFIXES:
            for path, status in (
                ('/execution/0', 400), ('/execution/9223372036854775808', 400),
                ('/execution/0/events/unknown', 400), ('/execution/42/events/unknown', 400),
                ('/folder/Finance/project/Load/status/4', 400),
                ('/history/F/project/P/status/unknown/package/X', 400),
                ('/folder/A%2FB', 404), ('/unknown', 404), ('/app/history', 404),
                ('/execution/-1', 404), ('/execution/+1', 404), ('/execution/1.5', 404),
            ):
                with self.subTest(prefix=prefix, path=path):
                    response = self.get(path + '?native=1', prefix)
                    self.assertEqual(response.status_code, status)
                    self.assertNotIn('Location', response.headers)
        self.monitor.assert_not_called()

    def test_plain_legacy_responses_and_opt_in_links_retain_the_mount(self):
        for prefix in PREFIXES:
            for path in LEGACY_PATHS:
                for method in ('GET', 'HEAD'):
                    with self.subTest(prefix=prefix, path=path, method=method):
                        response = self.clients[prefix].open(prefix + path, method=method)
                        self.assertEqual(response.status_code, 200)
                        self.assertNotIn('Location', response.headers)
                        if method == 'HEAD':
                            self.assertEqual(response.data, b'')
                        else:
                            links = LinkReader(response.get_data(as_text=True)).links
                            if path.startswith('/history/'):
                                self.assertNotIn('Open native', links)
                            else:
                                self.assertEqual(links['Open native'], prefix + path + '?native=1')
                                self.monitor.reset_mock()
                                converted = self.clients[prefix].get(links['Open native'])
                                self.assertEqual(converted.status_code, 302)
                                self.monitor.assert_not_called()

    def test_plain_queries_and_extra_decoding_stay_legacy_only(self):
        instance = LegacyMonitorFixture()
        self.monitor.return_value = instance
        self.monitor.side_effect = None
        for query in ('q=private&status=failed&from=ignored', 'return=https://outside.invalid', 'x=%ZZ', 'x=%FF'):
            response = self.get('/folder/A%252FB?' + query)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(instance.folder_name, 'A/B')
            self.assertEqual(instance.status, 'all')
            self.assertNotIn('Open native', LinkReader(response.get_data(as_text=True)).links)
        response = self.get('/?ignored=1')
        self.assertEqual(LinkReader(response.get_data(as_text=True)).links['Open native'], '/?native=1')

    def test_unsupported_pages_cannot_reuse_a_previous_requests_native_link(self):
        with self.app.app_context():
            response = self.get('/')
            self.assertIn('Open native', LinkReader(response.get_data(as_text=True)).links)
            for path in ('/folder/A*B', LEGACY_PATHS[-1]):
                response = self.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn('Open native', LinkReader(response.get_data(as_text=True)).links)

    def test_unmarked_raw_query_bytes_keep_legacy_behavior_but_marked_bytes_are_strict(self):
        response = self.get('/', environ_overrides={'QUERY_STRING': 'ignored=\xff'})
        self.assertEqual(response.status_code, 200)
        self.monitor.reset_mock()
        response = self.get('/', environ_overrides={'QUERY_STRING': 'native=1&ignored=\xff'})
        self.assertEqual(response.status_code, 400)
        self.monitor.assert_not_called()

    def test_foreign_hosts_methods_and_cross_site_subresources_cannot_redirect(self):
        for prefix in PREFIXES:
            for path in ('/', '/execution/42/values', LEGACY_PATHS[-1]):
                for method, headers, expected in (
                    ('GET', {'Host': 'attacker.invalid'}, 400), ('POST', {}, 405),
                    ('GET', {'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty'}, 403),
                ):
                    with self.subTest(prefix=prefix, path=path, method=method, headers=headers):
                        response = self.clients[prefix].open(prefix + path + '?native=1', method=method, headers=headers)
                        self.assertEqual(response.status_code, expected)
                        self.assertNotIn('Location', response.headers)
                        if expected == 405:
                            self.assertIn('GET', response.headers['Allow'])
            response = self.get('/?native=1', prefix, headers={
                'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document'})
            self.assertEqual(response.status_code, 302)
        self.monitor.assert_not_called()

    def test_disabled_resources_do_not_change_mapping_or_bypass_api_policy(self):
        for prefix in PREFIXES:
            for identifier in ('42', '9999999999999'):
                for suffix, api_suffix in (('/events/errors', '/events'), ('/values', '/values')):
                    with self.subTest(prefix=prefix, identifier=identifier, suffix=suffix):
                        response = self.get('/execution/' + identifier + suffix + '?native=1', prefix)
                        self.assertEqual(response.status_code, 302)
                        denied = self.clients[prefix].get(prefix + '/api/v1/executions/' + identifier + api_suffix)
                        self.assertEqual(denied.status_code, 403)
                        self.assertNotIn('Location', denied.headers)
        self.monitor.assert_not_called()

    def test_mapping_does_not_lookup_missing_or_revoked_execution_visibility(self):
        for prefix in PREFIXES:
            self.assert_redirect('/execution/42?native=1', '/app/executions/42', prefix)
            with patch('dashboard.inspection.execute_query', return_value={}) as query:
                response = self.clients[prefix].get(prefix + '/api/v1/executions/42')
                self.assertEqual(response.status_code, 404)
                self.assertEqual(query.call_count, 1)
                self.assertNotIn('Location', response.headers)
        self.monitor.assert_not_called()

    def test_value_entry_preserves_override_redaction_and_runtime_capability_denial(self):
        from tests.test_values import row

        for prefix in PREFIXES:
            self.app.config.update(API_VALUES_ENABLED=True, API_OVERRIDE_VALUES_ENABLED=False)
            self.assert_redirect('/execution/42/values?native=1', '/app/executions/42#parameters', prefix)
            metadata = self.clients[prefix].get(prefix + '/api/v1/meta').json['data']['capabilities']
            self.assertEqual(metadata, {'events': False, 'values': True, 'override_values': False})
            with patch('dashboard.values.visible_execution'), patch('dashboard.values.execute_query',
                    side_effect=lambda resource, *args, **kwargs: {'upper_id': 1}
                    if resource.endswith('fence.sql') else [row('overrides', value='private-value-canary')]) as query:
                response = self.clients[prefix].get(prefix + '/api/v1/executions/42/values?section=overrides')
                self.assertEqual(response.status_code, 200)
                value = response.json['data'][0]
                self.assertIsNone(value['value'])
                self.assertEqual(value['redaction_reason'], 'policy')
                self.assertNotIn('private-value-canary', response.get_data(as_text=True))
                query.reset_mock()
                self.app.config['API_VALUES_ENABLED'] = False
                denied = self.clients[prefix].get(prefix + '/api/v1/executions/42/values?section=overrides')
                self.assertEqual(denied.status_code, 403)
                self.assertNotIn('Location', denied.headers)
                query.assert_not_called()
        self.monitor.assert_not_called()

    def test_missing_native_assets_show_the_existing_error_without_auto_fallback(self):
        for prefix in PREFIXES:
            response = self.assert_redirect('/execution/42/values?native=1', '/app/executions/42#parameters', prefix)
            with patch('dashboard.frontend._entry_assets', side_effect=ValueError('Synthetic missing build')):
                unavailable = self.clients[prefix].get(response.headers['Location'])
            self.assertEqual(unavailable.status_code, 503)
            self.assertNotIn('Location', unavailable.headers)
        self.monitor.assert_not_called()


if __name__ == '__main__':
    unittest.main()
