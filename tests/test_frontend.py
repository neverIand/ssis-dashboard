"""Native shell routing, packaged builds and legacy coexistence without SQL."""

import json
from html.parser import HTMLParser
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
        (self.output / 'theme-init.js').write_text('// theme', encoding='utf-8')
        self.app = create_app({'TESTING': True})
        self.app.static_folder = str(self.static)
        self.client = self.app.test_client()

    def write_manifest(self, manifest):
        self.manifest_path.write_text(json.dumps(manifest), encoding='utf-8')

    def test_only_successful_native_shells_receive_the_strict_content_security_policy(self):
        strict = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
                  "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        for prefix in ['', '/ops/monitor']:
            client = Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response) if prefix else self.client
            for path in ['/app/', '/app/executions/17']:
                for method in ['GET', 'HEAD']:
                    with self.subTest(prefix=prefix, path=path, method=method):
                        response = client.open(prefix + path, method=method)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.headers['Content-Security-Policy'], strict)
                        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
                        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
                        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        with patch('dashboard.views.monitor', LegacyMonitorFixture):
            for path in ['/', '/execution/17']:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['Content-Security-Policy'], "frame-ancestors 'none'")
        self.manifest_path.unlink()
        for path, status in [('/app/', 503), ('/app/executions/17', 503),
                             ('/app/executions/0', 400), ('/app/unknown', 404)]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, status)
            self.assertEqual(response.headers['Content-Security-Policy'], "frame-ancestors 'none'")
        self.connect.assert_not_called()

    def test_native_templates_have_no_inline_styles_handlers_or_executable_scripts(self):
        class InlineInventory(HTMLParser):
            def __init__(self, html):
                super().__init__()
                self.violations = []
                self.executable_script = False
                self.feed(html)

            def handle_starttag(self, tag, attrs):
                attributes = dict(attrs)
                for name in attributes:
                    if name == 'style' or name.startswith('on'):
                        self.violations.append(f'{tag}[{name}]')
                if tag == 'script':
                    self.executable_script = attributes.get('type', '').lower() != 'application/json'
                    if self.executable_script and not attributes.get('src'):
                        self.violations.append('inline executable script')

            def handle_data(self, data):
                if self.executable_script and data.strip():
                    self.violations.append('executable script body')

            def handle_endtag(self, tag):
                if tag == 'script':
                    self.executable_script = False

        inputs = {str(path.relative_to(ROOT)): path.read_text(encoding='utf-8')
                  for path in (ROOT / 'dashboard/templates/app').rglob('*.html')}
        for path in ['/app/', '/app/executions/17']:
            inputs[path] = self.client.get(path).get_data(as_text=True)
        self.assertGreater(len(inputs), 2)
        for path, html in inputs.items():
            with self.subTest(path=path):
                self.assertEqual(InlineInventory(html).violations, [])
        self.connect.assert_not_called()

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
                       'aria-labelledby="filters-heading"', 'aria-label="Execution summary"',
                       'aria-labelledby="executions-heading"', 'role="status"', '<noscript>',
                       'disabled aria-describedby="app-status"', 'scope="col"',
                       'Creation timeline', 'data-timeline-toggle disabled', 'data-timeline-panel aria-label="Creation timeline" hidden',
                       'data-timeline-chart', 'data-timeline-table', 'Selected bucket values', 'Data table',
                       'About timeline counts', 'Edge buckets include only the selected range.']:
            self.assertIn(markup, html)
        references = re.findall(r'(?:href|src)="([^"]+)"', html)
        self.assertEqual(set(references), {
            '#main-content', '/', '/static/app/assets/main.js', '/static/app/assets/main.css',
            '/static/app/theme-init.js',
        })
        # The theme script is classic and render-blocking, ahead of the stylesheet it configures.
        self.assertLess(html.index('/static/app/theme-init.js'), html.index('/static/app/assets/main.css'))
        self.assertRegex(html, r'<script src="/static/app/theme-init.js"></script>')
        self.assertIn('<select data-theme-choice><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>', html)
        for legacy_dependency in ['jquery', 'bootstrap', 'morris', 'raphael', 'smartmenus',
                                  'http-equiv="refresh"', 'google-analytics']:
            self.assertNotIn(legacy_dependency, html.lower())
        self.connect.assert_not_called()

    def test_missing_theme_script_makes_the_shell_unavailable_like_other_assets(self):
        (self.output / 'theme-init.js').unlink()
        self.assertEqual(self.client.get('/app/').status_code, 503)
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

    def test_detail_deep_links_are_database_free_exact_and_prefix_aware(self):
        for prefix in ['', '/ops/monitor']:
            client = Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response) if prefix else self.client
            for identifier in ['1', '9223372036854775807']:
                with self.subTest(prefix=prefix, identifier=identifier):
                    response = client.get(f'{prefix}/app/executions/{identifier}?status=4&from=ignored')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    html = response.get_data(as_text=True)
                    self.assertEqual(shell_config(html), {
                        'app_base': f'{prefix}/app/', 'api_base': f'{prefix}/api/v1/',
                        'execution_base': f'{prefix}/execution/', 'execution_id': identifier,
                    })
                    for markup in ['data-screen="execution"', f'Execution {identifier}',
                                   f'href="{prefix}/app/"', f'href="{prefix}/execution/{identifier}"',
                                   f'src="{prefix}/static/app/assets/main.js"',
                                   'aria-label="Execution summary"', 'class="detail-title"',
                                   'class="event-counts"', 'data-execution-detail hidden',
                                   'Duration', 'Active elapsed (observed)', 'aria-label="Refresh"', '<noscript>']:
                        self.assertIn(markup, html)
                    for markup in ['data-detail-refresh disabled', 'data-detail-poll-toggle data-icon="pause" disabled',
                                   'data-overview-link', 'data-legacy-detail-link', 'data-overview-return-notice hidden',
                                   'data-executables-toggle role="tab"', 'data-executables-panel hidden',
                                   'data-executables-table', 'data-children-table', 'data-children-toggle', 'data-events-toggle', 'data-events-filters', 'data-events-table',
                                   'Event access is disabled for this application.', 'data-parameters-toggle', 'data-parameters-table',
                                   'Parameter access is disabled for this application.', 'aria-label="Parameter pages"',
                                   'data-overrides-toggle role="tab"', 'data-overrides-panel hidden', 'data-overrides-table',
                                   'Override access is disabled for this application.', 'Override values are hidden by application policy.',
                                   'aria-label="Override pages"', 'Property / ID',
                                   'data-history-toggle role="tab"', 'data-history-panel hidden', 'data-history-table',
                                   'Duration comparison', 'data-history-chart-panel aria-label="Duration comparison" hidden', 'data-history-chart-plot',
                                   'Selected execution values', 'Plots the loaded page only.', 'Circle: actual zero.',
                                   'Estimates are not actual timings.', 'About estimates',
                                   'History statuses', 'data-history-custom', 'aria-label="History pages"', 'Duration', 'Estimate',
                                   'Start/end recording is not a package result.', 'aria-label="Executable pages"']:
                        self.assertIn(markup, html)
                    for markup in ['overview-filters', 'data-status-choices', 'data-execution-table']:
                        self.assertNotIn(markup, html)
        self.connect.assert_not_called()

    def test_dense_shell_controls_have_described_tips_icon_names_and_no_empty_feedback_boxes(self):
        class Inventory(HTMLParser):
            def __init__(self, html):
                super().__init__()
                self.nodes = []
                self.feed(html)

            def handle_starttag(self, tag, attrs):
                self.nodes.append((tag, dict(attrs)))

        for path in ['/app/', '/app/executions/17']:
            with self.subTest(path=path):
                html = self.client.get(path).get_data(as_text=True)
                nodes = Inventory(html).nodes
                targets = {attrs['id']: attrs for _, attrs in nodes if 'id' in attrs}
                ids = [attrs['id'] for _, attrs in nodes if 'id' in attrs]
                self.assertEqual(len(ids), len(set(ids)))
                tips = [attrs for tag, attrs in nodes if tag == 'button' and 'info-trigger' in attrs.get('class', '').split()]
                self.assertGreater(len(tips), 1)
                for attrs in tips:
                    self.assertTrue(attrs['aria-label'])
                    self.assertEqual(targets[attrs['aria-describedby']]['role'], 'tooltip')
                for tag, attrs in nodes:
                    if tag == 'button' and 'icon-button' in attrs.get('class', '').split():
                        self.assertTrue(attrs['aria-label'])
                        self.assertEqual(attrs['title'], attrs['aria-label'])
                    if tag == 'caption':
                        self.assertIn('visually-hidden', attrs.get('class', ''))
                    if 'data-history-chart-toggle' in attrs or 'data-timeline-toggle' in attrs:
                        self.assertEqual(attrs['aria-expanded'], 'false')
                        self.assertIn(attrs['aria-controls'], targets)
                        self.assertNotIn('aria-pressed', attrs)
                if path.endswith('/17'):
                    self.assertEqual({attrs['data-event-count-label'] for _, attrs in nodes
                                      if 'data-event-count-label' in attrs}, {'errors', 'warnings'})
                self.assertNotIn('resource-feedback', html)
                self.assertNotIn('status-slot', html)
                self.assertEqual(sum(tag == 'details' for tag, _ in nodes), 1 if path == '/app/' else 0)
        self.connect.assert_not_called()

    def test_invalid_detail_ids_fail_before_build_loading_or_sql(self):
        self.manifest_path.unlink()
        for identifier in ['0', '00', '01', '-1', '+1', '1.0', '1e2', 'abc',
                           '9223372036854775808', '%EF%BC%91', '%3Cscript%3E']:
            with self.subTest(identifier=identifier):
                response = self.client.get(f'/app/executions/{identifier}')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertNotIn('Traceback', response.get_data(as_text=True))
        for path in ['/app/executions/', '/app/executions/42/unknown', '/app/executions/42/']:
            self.assertEqual(self.client.get(path).status_code, 404)
        self.connect.assert_not_called()

    def test_detail_uses_shared_safe_build_failure_and_preserves_protocol(self):
        self.manifest_path.write_text('{incomplete build', encoding='utf-8')
        response = self.client.get('/app/executions/42')
        self.assertEqual(response.status_code, 503)
        html = response.get_data(as_text=True)
        self.assertIn('Application unavailable', html)
        self.assertIn(response.headers['X-Request-ID'], html)
        self.assertNotIn('manifest.json', html)
        self.assertEqual(self.client.get('/api/v1/meta').status_code, 200)
        self.write_manifest(self.manifest)
        head = self.client.head('/app/executions/42')
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.data, b'')
        post = self.client.post('/app/executions/42')
        self.assertEqual(post.status_code, 405)
        self.assertIn('GET', post.headers['Allow'])
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
