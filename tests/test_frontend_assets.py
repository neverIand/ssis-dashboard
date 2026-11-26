"""Packaged browser assets work through Flask without Node or SQL at runtime."""

import json
from pathlib import PurePosixPath
import unittest
from unittest.mock import patch

from flask import Flask, url_for
from werkzeug.middleware.dispatcher import DispatcherMiddleware
from werkzeug.test import Client
from werkzeug.wrappers import Response

from dashboard import create_app
from tests.source_size import ASSET_ROOT, SOURCE_ROOT, authored_bytes, packaged_gzip_bytes


PACKAGED_GZIP_BUDGET = 64 * 1024


class FrontendSizeBudgetTests(unittest.TestCase):
    """The roadmap ceiling covers all delivered JS/CSS, including chunks; authored size is only reported."""

    def packaged_size(self):
        if not ASSET_ROOT.is_dir():
            self.skipTest('Frontend assets are not built; run npm --prefix web run build')
        size = packaged_gzip_bytes()
        self.assertTrue(size, 'Packaged JS/CSS is missing; run npm --prefix web run build')
        return size

    def test_authored_size_is_measurable(self):
        self.assertGreater(authored_bytes(), 0, 'Authored JS/CSS is missing')

    def test_packaged_gzip_budget(self):
        size = self.packaged_size()
        self.assertLessEqual(size, PACKAGED_GZIP_BUDGET, f'Packaged gzip-9 JS+CSS: {size} > {PACKAGED_GZIP_BUDGET} bytes')

    def test_budget_check_accepts_the_ceiling_and_rejects_one_byte_above(self):
        size = self.packaged_size()
        for ceiling, failures in [(size, 0), (size - 1, 1)]:
            with self.subTest(ceiling=ceiling), patch(f'{__name__}.PACKAGED_GZIP_BUDGET', ceiling):
                result = unittest.TestResult()
                FrontendSizeBudgetTests('test_packaged_gzip_budget').run(result)
                self.assertEqual(result.errors, [])
                self.assertEqual(result.skipped, [])
                self.assertEqual(len(result.failures), failures)


class PackagedFrontendTests(unittest.TestCase):
    def setUp(self):
        if not ASSET_ROOT.is_dir():
            self.skipTest('Frontend assets are not built; run npm --prefix web run build')
        guard = patch('pyodbc.connect', side_effect=AssertionError('Assets must not query SQL'))
        self.connect = guard.start()
        self.addCleanup(guard.stop)
        self.app = create_app({'TESTING': True})
        self.manifest = json.loads((ASSET_ROOT / 'manifest.json').read_text(encoding='utf-8'))

    def test_manifest_includes_the_entry_styles_and_only_packaged_relative_files(self):
        entry = self.manifest['src/main.js']
        self.assertTrue(entry['isEntry'])
        self.assertTrue(entry['file'].endswith('.js'))
        self.assertTrue(entry['css'])
        for chunk in self.manifest.values():
            for dependency in chunk.get('imports', []) + chunk.get('dynamicImports', []):
                self.assertIn(dependency, self.manifest)
            for filename in [chunk['file'], *chunk.get('css', []), *chunk.get('assets', [])]:
                path = PurePosixPath(filename)
                self.assertFalse(path.is_absolute())
                self.assertNotIn('..', path.parts)
                self.assertNotIn('\\', filename)
                self.assertNotIn(':', filename)
                self.assertTrue((ASSET_ROOT / filename).is_file(), filename)
        self.assertFalse((ASSET_ROOT / 'index.html').exists())
        self.assertFalse((ASSET_ROOT / 'LICENSES.txt').exists())
        theme_init = (ASSET_ROOT / 'theme-init.js').read_bytes()
        self.assertLess(len(theme_init), (SOURCE_ROOT / 'theme-init.js').stat().st_size)
        self.assertNotRegex(theme_init, rb'//|/\*', 'Packaged theme-init.js must be comment-free')
        self.assertNotRegex(theme_init, rb'\b(?:import|export)\b', 'Packaged theme-init.js must be a classic script')
        self.assertEqual((ASSET_ROOT / 'favicon.svg').read_bytes(),
                         (ASSET_ROOT.parents[2] / 'web/src/favicon.svg').read_bytes())
        self.connect.assert_not_called()

    def test_packaged_detail_uses_the_current_entry_at_root_and_prefix(self):
        for prefix in ['', '/dashboard']:
            client = Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response) if prefix else self.app.test_client()
            with client.get(f'{prefix}/app/executions/9223372036854775807') as response:
                self.assertEqual(response.status_code, 200)
                html = response.get_data(as_text=True)
                self.assertIn(f'{prefix}/static/app/{self.manifest["src/main.js"]["file"]}', html)
                self.assertIn('data-screen="execution"', html)
        self.connect.assert_not_called()

    def test_only_hashed_assets_have_immutable_cache_headers_including_conditional_reads(self):
        assets = [path.relative_to(ASSET_ROOT).as_posix()
                  for path in (ASSET_ROOT / 'assets').rglob('*') if path.is_file()]
        self.assertTrue(assets)
        for prefix in ['', '/dashboard']:
            client = Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response) if prefix else self.app.test_client()
            for filename in assets:
                url = f'{prefix}/static/app/{filename}'
                with self.subTest(prefix=prefix, filename=filename):
                    with client.get(url) as response:
                        self.assertEqual(response.status_code, 200)
                        etag = response.headers['ETag']
                        self.assertEqual(response.headers['Cache-Control'], 'public, max-age=31536000, immutable')
                    for method, headers, status in [('HEAD', {}, 200), ('GET', {'If-None-Match': etag}, 304),
                                                     ('GET', {'Range': 'bytes=0-7'}, 206)]:
                        with client.open(url, method=method, headers=headers) as response:
                            self.assertEqual(response.status_code, status)
                            self.assertEqual(response.headers['Cache-Control'], 'public, max-age=31536000, immutable')
            for path in ['app/theme-init.js', 'app/favicon.svg', 'app/manifest.json', 'css/main.css',
                         'app/assets/../theme-init.js', 'app/assets/../favicon.svg',
                         'app/assets/%2e%2e/manifest.json', 'app/assets/../../css/main.css']:
                url = f'{prefix}/static/{path}'
                with self.subTest(prefix=prefix, path=path):
                    with client.get(url) as response:
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.headers['Cache-Control'], 'no-cache')
                        etag = response.headers['ETag']
                    with client.get(url, headers={'If-None-Match': etag}) as response:
                        self.assertEqual(response.status_code, 304)
                        self.assertEqual(response.headers['Cache-Control'], 'no-cache')
            for path, method, headers, status in [('assets/missing.js', 'GET', {}, 404),
                                                  (assets[0], 'POST', {}, 405),
                                                  (assets[0], 'GET', {'Sec-Fetch-Site': 'cross-site'}, 403)]:
                with client.open(f'{prefix}/static/app/{path}', method=method, headers=headers) as response:
                    self.assertEqual(response.status_code, status)
                    self.assertNotIn('immutable', response.headers.get('Cache-Control', ''))
        self.connect.assert_not_called()

    def test_manifest_assets_load_at_root_and_mounted_prefix_without_sql(self):
        files = {chunk['file'] for chunk in self.manifest.values()} | {'theme-init.js', 'favicon.svg'}
        files.update(filename for chunk in self.manifest.values() for filename in chunk.get('css', []))
        files.update(filename for chunk in self.manifest.values() for filename in chunk.get('assets', []))
        for prefix in ['', '/dashboard']:
            client = Client(DispatcherMiddleware(Flask('mount'), {prefix: self.app}), Response) if prefix else self.app.test_client()
            with self.app.test_request_context(environ_overrides={'SCRIPT_NAME': prefix}):
                urls = [(filename, url_for('static', filename=f'app/{filename}')) for filename in files]
            for filename, url in urls:
                with self.subTest(prefix=prefix, filename=filename):
                    self.assertTrue(url.startswith(f'{prefix}/static/app/'))
                    with client.get(url) as response:
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.data, (ASSET_ROOT / filename).read_bytes())
                        if filename.endswith('.css'):
                            self.assertEqual(response.mimetype, 'text/css')
                        elif filename.endswith('.js'):
                            self.assertIn(response.mimetype, ['text/javascript', 'application/javascript'])
            with client.get(f'{prefix}/static/app/missing.js') as response:
                self.assertEqual(response.status_code, 404)
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
