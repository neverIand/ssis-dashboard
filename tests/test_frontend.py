"""Native shell routing, packaged builds and legacy coexistence without SQL."""

import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from flask import Flask
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.test import Client
from werkzeug.wrappers import Response

from dashboard import create_app
from tests.fixtures import LegacyMonitorFixture


ROOT = Path(__file__).resolve().parents[1]


def shell_config(html):
    return json.loads(re.search(
        r'<script id="app-config" type="application/json">(.*?)</script>', html, re.S,
    ).group(1))


class FrontendShellTests(unittest.TestCase):
    def setUp(self):
        guard = patch('pyodbc.connect', side_effect=AssertionError('Shell must not query SQL'))
        self.connect = guard.start()
        self.addCleanup(guard.stop)
        temporary_root = ROOT / '.local/tmp'
        temporary_root.mkdir(parents=True, exist_ok=True)
        temporary = TemporaryDirectory(prefix='frontend-shell-', dir=temporary_root)
        self.addCleanup(temporary.cleanup)
        self.static = Path(temporary.name)
        self.output = self.static / 'app'
        (self.output / 'assets').mkdir(parents=True)
        self.entry = {'file': 'assets/main.js', 'isEntry': True, 'css': ['assets/main.css']}
        self.manifest = {'src/main.js': self.entry}
        self.manifest_path = self.output / 'manifest.json'
        self.write_manifest(self.manifest)
        (self.output / 'assets/main.js').write_text('// packaged entry', encoding='utf-8')
        (self.output / 'assets/main.css').write_text('body { margin: 0; }', encoding='utf-8')
        self.app = create_app({'TESTING': True})
        self.app.static_folder = str(self.static)
        self.client = self.app.test_client()

    def write_manifest(self, manifest):
        self.manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

    def test_shell_is_semantic_database_free_and_loads_only_local_entry_assets(self):
        response = self.client.get('/app/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/html')
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertRegex(response.headers['X-Request-ID'], r'^[a-f0-9]{32}$')
        html = response.get_data(as_text=True)
        self.assertEqual(shell_config(html), {
            'app_base': '/app/', 'api_base': '/api/v1/', 'execution_base': '/execution/',
        })
        for markup in ['href="#main-content"', 'id="main-content" tabindex="-1"',
                       'aria-labelledby="filters-heading"', 'aria-labelledby="summary-heading"',
                       'aria-labelledby="executions-heading"', 'role="status"', '<noscript>',
                       'disabled aria-describedby="app-status"', 'scope="col"']:
            self.assertIn(markup, html)
        references = re.findall(r'(?:href|src)="([^"]+)"', html)
        self.assertEqual(set(references), {
            '#main-content', '/', '/static/app/assets/main.js', '/static/app/assets/main.css',
        })
        for legacy_dependency in ['jquery', 'bootstrap', 'morris', 'raphael', 'smartmenus',
                                  'http-equiv="refresh"', 'google-analytics']:
            self.assertNotIn(legacy_dependency, html.lower())
        self.connect.assert_not_called()

    def test_mounted_shell_asset_and_route_bases_keep_the_deployment_prefix(self):
        client = Client(DispatcherMiddleware(Flask('mount'), {'/ops/monitor': self.app}), Response)
        response = client.get('/ops/monitor/app/')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertEqual(shell_config(html), {
            'app_base': '/ops/monitor/app/', 'api_base': '/ops/monitor/api/v1/',
            'execution_base': '/ops/monitor/execution/',
        })
        self.assertIn('href="/ops/monitor/"', html)
        for filename in ['main.js', 'main.css']:
            url = f'/ops/monitor/static/app/assets/{filename}'
            self.assertIn(f'="{url}"', html)
            with client.get(url) as asset:
                self.assertEqual(asset.status_code, 200)
                self.assertEqual(asset.data, (self.output / 'assets' / filename).read_bytes())
        redirect = client.get('/ops/monitor/app?status=2')
        self.assertEqual(redirect.status_code, 308)
        self.assertEqual(urlsplit(redirect.location).path, '/ops/monitor/app/')
        self.assertEqual(urlsplit(redirect.location).query, 'status=2')
        self.connect.assert_not_called()

    def test_shared_chunks_load_their_styles_and_preload_once_even_with_cycles(self):
        shared = {'file': 'assets/shared.js', 'css': ['assets/main.css', 'assets/shared.css'],
                  'imports': ['src/main.js']}
        for filename in ['shared.js', 'shared.css']:
            (self.output / 'assets' / filename).write_text('/* shared */', encoding='utf-8')
        self.write_manifest({'src/main.js': {**self.entry, 'imports': ['_shared', '_shared']},
                             '_shared': shared})
        response = self.client.get('/app/')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertEqual(html.count('href="/static/app/assets/main.css"'), 1)
        self.assertEqual(html.count('href="/static/app/assets/shared.css"'), 1)
        self.assertEqual(html.count('rel="modulepreload" href="/static/app/assets/shared.js"'), 1)
        self.connect.assert_not_called()

    def test_missing_or_malformed_builds_return_clear_safe_503_without_affecting_health(self):
        invalid_builds = [
            None, '{not json', '[]', '{}',
            json.dumps({'src/main.js': []}),
            json.dumps({'src/main.js': {**self.entry, 'isEntry': False}}),
            json.dumps({'src/main.js': {**self.entry, 'file': 'assets/missing.js'}}),
            json.dumps({'src/main.js': {**self.entry, 'css': ['assets/missing.css']}}),
            json.dumps({'src/main.js': {**self.entry, 'css': 'assets/main.css'}}),
            json.dumps({'src/main.js': {**self.entry, 'imports': ['missing-chunk']}}),
            json.dumps({'src/main.js': {**self.entry, 'imports': [None]}}),
        ]
        for filename in ['../main.js', '/main.js', '//outside.invalid/app.js',
                         'https://outside.invalid/app.js', r'assets\main.js', None]:
            invalid_builds.append(json.dumps({'src/main.js': {**self.entry, 'file': filename}}))
        for manifest in invalid_builds:
            with self.subTest(manifest=manifest):
                if manifest is None:
                    self.manifest_path.unlink()
                else:
                    self.manifest_path.write_text(manifest, encoding='utf-8')
                response = self.client.get('/app/')
                self.assertEqual(response.status_code, 503)
                html = response.get_data(as_text=True)
                self.assertIn('Application unavailable', html)
                self.assertIn('href="/"', html)
                self.assertIn(response.headers['X-Request-ID'], html)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                for private_text in [str(self.static), 'manifest.json', 'outside.invalid', 'Traceback']:
                    self.assertNotIn(private_text, html)
                self.assertEqual(self.client.get('/healthz').status_code, 200)
                self.assertEqual(self.client.get('/api/v1/meta').status_code, 200)
        self.connect.assert_not_called()

    def test_build_can_be_added_or_repaired_without_recreating_the_application(self):
        self.manifest_path.unlink()
        self.assertEqual(self.client.get('/app/').status_code, 503)
        self.write_manifest(self.manifest)
        self.assertEqual(self.client.get('/app/').status_code, 200)
        self.manifest_path.write_text('{incomplete rebuild', encoding='utf-8')
        self.assertEqual(self.client.get('/app/').status_code, 503)
        self.write_manifest(self.manifest)
        self.assertEqual(self.client.get('/app/').status_code, 200)
        self.connect.assert_not_called()

    def test_no_spa_fallback_or_route_shadowing_and_protocol_headers_are_preserved(self):
        self.manifest_path.unlink()
        with patch('dashboard.views.monitor', LegacyMonitorFixture):
            self.assertEqual(self.client.get('/').status_code, 200)
            self.assertEqual(self.client.get('/execution/42').status_code, 200)
        for path, mimetype in [('/app/unknown', 'text/html'), ('/unknown', 'text/html'),
                               ('/api/v1/unknown', 'application/problem+json'),
                               ('/static/app/missing.js', 'text/html')]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404, path)
            self.assertEqual(response.mimetype, mimetype, path)
        post = self.client.post('/app/')
        self.assertEqual(post.status_code, 405)
        self.assertIn('GET', post.headers['Allow'])
        self.write_manifest(self.manifest)
        head = self.client.head('/app/')
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b'')
        self.connect.assert_not_called()

    def test_forwarded_browser_headers_cannot_change_bootstrap_bases(self):
        response = self.client.get('/app/', headers={
            'X-Forwarded-Prefix': '//outside.invalid', 'X-Forwarded-Host': 'outside.invalid',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(shell_config(response.get_data(as_text=True)), {
            'app_base': '/app/', 'api_base': '/api/v1/', 'execution_base': '/execution/',
        })
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
