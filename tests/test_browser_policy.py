"""Cross-site rejection before SQL and browser isolation headers on every route kind."""

import unittest
from unittest.mock import Mock, patch

import pyodbc

from dashboard import create_app
from tests.fixtures import LegacyMonitorFixture


LOCAL = {'Host': 'localhost:5555'}
ISOLATION = {'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
             'Content-Security-Policy': "frame-ancestors 'none'"}
DATABASE_ROUTES = ('/api/v1/folders', '/api/v1/executions/42', '/api/v1/executions/42/events', '/readyz',
                   '/', '/execution/42', '/execution/42/values', '/history/F/project/P/status/all/package/A.dtsx')
OTHER_ROUTES = ('/api/v1/meta', '/healthz', '/app/', '/app/executions/42', '/static/css/main.css')


def cross_site(mode, dest):
    return {**LOCAL, 'Origin': 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site',
            'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': dest}


class BrowserPolicyTests(unittest.TestCase):
    def setUp(self):
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('No live database in tests')))
        self.monitor = self.enterContext(patch('dashboard.views.monitor', Mock(wraps=LegacyMonitorFixture)))
        self.app = create_app({'TESTING': True, 'API_EVENTS_ENABLED': True, 'API_VALUES_ENABLED': True})
        self.client = self.app.test_client()

    def assert_isolated(self, response):
        for name, value in ISOLATION.items():
            self.assertEqual(response.headers.get(name), value, name)

    def test_cross_site_subresources_and_frames_are_rejected_before_any_query(self):
        for mode, dest in (('no-cors', 'image'), ('no-cors', 'script'), ('cors', 'empty'),
                           ('navigate', 'iframe'), ('navigate', 'frame'), ('navigate', 'object'),
                           ('no-cors', 'embed')):
            for path in DATABASE_ROUTES + OTHER_ROUTES:
                for method in ('GET', 'HEAD'):
                    with self.subTest(mode=mode, dest=dest, path=path, method=method):
                        response = self.client.open(path, method=method, headers=cross_site(mode, dest))
                        self.assertEqual(response.status_code, 403)
                        self.assert_isolated(response)
                        if method == 'GET' and path.startswith('/api/v1'):
                            self.assertEqual(response.json['code'], 'forbidden')
                        response.close()
        self.connect.assert_not_called()
        self.monitor.assert_not_called()

    def test_cross_site_top_level_navigation_still_opens_pages(self):
        for path in ('/api/v1/meta', '/', '/execution/42'):
            for method in ('GET', 'HEAD'):
                with self.subTest(path=path, method=method):
                    response = self.client.open(path, method=method, headers=cross_site('navigate', 'document'))
                    self.assertEqual(response.status_code, 200)
                    self.assert_isolated(response)
                    response.close()

    def test_same_origin_same_site_direct_and_tool_requests_are_allowed(self):
        for site in ('same-origin', 'same-site', 'none', None):
            for mode, dest in (('cors', 'empty'), ('no-cors', 'image'), ('navigate', 'iframe')):
                headers = {**LOCAL, 'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': dest}
                if site is not None:
                    headers['Sec-Fetch-Site'] = site
                for path in ('/api/v1/meta', '/', '/static/css/main.css'):
                    with self.subTest(site=site, mode=mode, dest=dest, path=path):
                        response = self.client.get(path, headers=headers)
                        self.assertEqual(response.status_code, 200)
                        response.close()

    def test_route_host_and_method_errors_keep_their_status_for_cross_site_requests(self):
        headers = cross_site('cors', 'empty')
        for path, method, request_headers, status in (
            ('/api/v1/meta', 'POST', headers, 405),
            ('/api/v1/unknown', 'GET', headers, 404),
            ('/unknown', 'GET', headers, 404),
            ('/api/v1/meta', 'GET', {**headers, 'Host': 'attacker.example'}, 400),
            ('/', 'GET', {**headers, 'Host': 'attacker.example'}, 400),
        ):
            with self.subTest(path=path, method=method, status=status):
                response = self.client.open(path, method=method, headers=request_headers)
                self.assertEqual(response.status_code, status)
                self.assert_isolated(response)
                response.close()
        self.connect.assert_not_called()
        self.monitor.assert_not_called()

    def test_success_error_shell_and_static_responses_carry_isolation_headers(self):
        self.connect.side_effect = pyodbc.Error('08001', 'private-diagnostic-canary')
        for path, status in (('/api/v1/meta', 200), ('/', 200), ('/static/css/main.css', 200),
                             ('/api/v1/folders', 503), ('/execution/0', 400), ('/api/v1/executions/0', 400),
                             ('/app/', None), ('/app/executions/0', 400)):
            with self.subTest(path=path):
                response = self.client.get(path, headers=LOCAL)
                if status is not None:
                    self.assertEqual(response.status_code, status)
                self.assert_isolated(response)
                response.close()
