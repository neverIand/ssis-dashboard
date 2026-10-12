import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from flask import url_for

from dashboard import create_app
from dashboard import config as defaults
from dashboard.ssis import monitor
from tests.fixtures import LegacyMonitorFixture


PROJECT_ROOT = Path(__file__).resolve().parent.parent


class ApplicationFactoryTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ)
        environment.start()
        self.addCleanup(environment.stop)
        os.environ.pop('DASHBOARD_CONFIG', None)
        connection_guard = patch('pyodbc.connect', side_effect=AssertionError('Tests must not connect to SQL Server'))
        self.connect = connection_guard.start()
        self.addCleanup(connection_guard.stop)
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.temporary = Path(temporary.name)

    def write_config(self, name, text):
        path = self.temporary / name
        path.write_text(text, encoding='utf-8')
        return path

    def test_factory_starts_without_database_access_and_debug_is_off(self):
        app = create_app({})
        self.assertFalse(app.debug)
        self.assertEqual(app.config['HOUR_SPAN'], 360)
        self.connect.assert_not_called()

    def test_apps_do_not_share_mutable_default_configuration(self):
        first = create_app({})
        second = create_app({})
        original = defaults.CONNECTION_STRING['main']
        first.config['CONNECTION_STRING']['main'] = 'synthetic first app'
        self.assertEqual(second.config['CONNECTION_STRING']['main'], original)
        self.assertEqual(defaults.CONNECTION_STRING['main'], original)

    def test_mapping_overrides_are_independent_and_skip_automatic_files(self):
        os.environ['DASHBOARD_CONFIG'] = str(self.temporary / 'missing.cfg')
        overrides = {'CONNECTION_STRING': {'main': 'synthetic input'}, 'HOUR_SPAN': 24}
        first = create_app(overrides)
        second = create_app(overrides)
        first.config['CONNECTION_STRING']['main'] = 'changed'
        self.assertEqual(second.config['CONNECTION_STRING']['main'], 'synthetic input')
        self.assertEqual(overrides['CONNECTION_STRING']['main'], 'synthetic input')
        self.assertEqual(second.config['HOUR_SPAN'], 24)

    def test_monitor_reads_the_active_app_including_nested_contexts(self):
        first = create_app({'HOUR_SPAN': 24, 'CONNECTION_STRING': {'main': 'first'}})
        second = create_app({'HOUR_SPAN': 48, 'CONNECTION_STRING': {'main': 'second'}})
        with first.app_context():
            self.assertEqual(monitor().config.connectionString, 'first')
            with second.app_context():
                self.assertEqual(monitor().config.hourSpan, 48)
                self.assertEqual(monitor().config.connectionString, 'second')
            self.assertEqual(monitor().config.hourSpan, 24)
        self.connect.assert_not_called()

    def test_environment_file_overrides_defaults(self):
        path = self.write_config('environment.cfg', 'HOUR_SPAN = 72\nEXECUTION_COUNT = 5\n')
        os.environ['DASHBOARD_CONFIG'] = str(path)
        app = create_app()
        self.assertEqual(app.config['HOUR_SPAN'], 72)
        self.assertEqual(app.config['EXECUTION_COUNT'], 5)
        self.assertEqual(os.environ['DASHBOARD_CONFIG'], str(path))

    def test_explicit_file_precedes_environment_and_mapping_precedes_file(self):
        os.environ['DASHBOARD_CONFIG'] = str(self.temporary / 'missing.cfg')
        path = self.write_config('explicit.cfg', 'HOUR_SPAN = 72\nEXECUTION_COUNT = 5\n')
        app = create_app({'HOUR_SPAN': 12}, config_path=path)
        self.assertEqual(app.config['HOUR_SPAN'], 12)
        self.assertEqual(app.config['EXECUTION_COUNT'], 5)

    def test_relative_environment_file_remains_package_relative(self):
        with TemporaryDirectory(dir=PROJECT_ROOT / 'dashboard') as directory:
            path = Path(directory) / 'relative.cfg'
            path.write_text('HOUR_SPAN = 84\n', encoding='utf-8')
            os.environ['DASHBOARD_CONFIG'] = str(path.relative_to(PROJECT_ROOT / 'dashboard'))
            app = create_app()
        self.assertEqual(app.config['HOUR_SPAN'], 84)

    def test_default_project_file_loads_outside_the_project_directory(self):
        self.write_config('config.cfg', 'HOUR_SPAN = 96\n')
        elsewhere = self.temporary / 'elsewhere'
        elsewhere.mkdir()
        original_directory = Path.cwd()
        try:
            with patch('dashboard._PROJECT_ROOT', self.temporary):
                os.chdir(elsewhere)
                app = create_app()
        finally:
            os.chdir(original_directory)
        self.assertEqual(app.config['HOUR_SPAN'], 96)
        self.assertNotIn('DASHBOARD_CONFIG', os.environ)

    def test_missing_optional_project_file_uses_defaults(self):
        with patch('dashboard._PROJECT_ROOT', self.temporary):
            app = create_app()
        self.assertEqual(app.config['HOUR_SPAN'], 360)
        self.assertNotIn('DASHBOARD_CONFIG', os.environ)

    def test_missing_explicit_or_environment_file_fails(self):
        missing = self.temporary / 'missing.cfg'
        with self.assertRaises(FileNotFoundError):
            create_app(config_path=missing)
        os.environ['DASHBOARD_CONFIG'] = str(missing)
        with self.assertRaises(FileNotFoundError):
            create_app()

    def test_invalid_optional_file_is_not_silently_ignored(self):
        self.write_config('config.cfg', 'HOUR_SPAN = [\n')
        with patch('dashboard._PROJECT_ROOT', self.temporary), self.assertRaises(SyntaxError):
            create_app()

    def test_empty_environment_path_fails_clearly(self):
        os.environ['DASHBOARD_CONFIG'] = ''
        with self.assertRaisesRegex(ValueError, 'DASHBOARD_CONFIG'):
            create_app()

    def test_package_import_does_not_load_environment_configuration(self):
        environment = dict(os.environ, DASHBOARD_CONFIG=str(self.temporary / 'missing.cfg'))
        result = subprocess.run(
            [sys.executable, '-B', '-c', 'from dashboard import create_app; print(callable(create_app))'],
            cwd=PROJECT_ROOT, env=environment, capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'True')

    def test_wsgi_and_legacy_launcher_load_without_database_access(self):
        path = self.write_config('entrypoints.cfg', 'HOUR_SPAN = 84\n')
        code = (
            'from unittest.mock import patch; '
            'guard = patch("pyodbc.connect", side_effect=AssertionError("Unexpected DB access")); '
            'guard.start(); '
            'from dashboard.wsgi import app as wsgi; from runserver import app as launcher; '
            'assert wsgi.config["HOUR_SPAN"] == launcher.config["HOUR_SPAN"] == 84; '
            'assert not wsgi.debug and not launcher.debug; '
            'guard.stop(); print("entrypoints OK")'
        )
        result = subprocess.run(
            [sys.executable, '-B', '-c', code], cwd=PROJECT_ROOT,
            env=dict(os.environ, DASHBOARD_CONFIG=str(path)),
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'entrypoints OK')


class LegacyPresentationTests(unittest.TestCase):
    def setUp(self):
        connection_guard = patch('pyodbc.connect', side_effect=AssertionError('Tests must not connect to SQL Server'))
        self.connect = connection_guard.start()
        self.addCleanup(connection_guard.stop)
        fixture = patch('dashboard.views.monitor', LegacyMonitorFixture)
        fixture.start()
        self.addCleanup(fixture.stop)
        self.app = create_app({'TESTING': True})
        self.client = self.app.test_client()

    def test_all_eight_legacy_routes_render_with_populated_synthetic_data(self):
        routes = [
            ('/', 'Sample.dtsx'),
            ('/folder/Sample%20folder', ' in &#34;Sample folder&#34;'),
            ('/folder/Sample%20folder/project/Sample%20project', ' for &#34;Sample project&#34;'),
            ('/folder/Sample%20folder/project/Sample%20project/status/succeeded', 'Succeeded Packages'),
            ('/execution/42', 'Synthetic executable'),
            ('/execution/42/events/all', 'Synthetic component'),
            ('/execution/42/values', 'SyntheticOverride'),
            ('/history/Sample%20folder/project/Sample%20project/status/all/package/Sample.dtsx', 'Historical Performances'),
        ]
        for path, expected in routes:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertIn(expected, response.get_data(as_text=True))
                self.assertIn('ssis-dashboard-next', response.get_data(as_text=True))
        self.connect.assert_not_called()

    def test_template_links_keep_existing_endpoint_names(self):
        with self.app.test_request_context():
            self.assertEqual(url_for('execution', execution_id=42), '/execution/42')
            self.assertEqual(url_for('package_events', execution_id=42, event_type='errors'), '/execution/42/events/errors')
            self.assertEqual(url_for('folder_project', folder_name='Sample folder', project_name='Sample project'), '/folder/Sample%20folder/project/Sample%20project')
        html = self.client.get('/').get_data(as_text=True)
        self.assertIn('href="/execution/42"', html)
        self.assertIn('href="/execution/42/values"', html)

    def test_context_helpers_render_children_status_and_parameter_flags(self):
        details = self.client.get('/execution/42').get_data(as_text=True)
        self.assertIn('Child.dtsx', details)
        self.assertIn('label-success', details)
        values = self.client.get('/execution/42/values').get_data(as_text=True)
        self.assertIn('SyntheticValue', values)
        self.assertIn('fa-check-square-o', values)

    def test_event_text_is_still_escaped(self):
        html = self.client.get('/execution/42/events/all').get_data(as_text=True)
        self.assertIn('&lt;script&gt;fixture&lt;/script&gt;', html)
        self.assertNotIn('<script>fixture</script>', html)

    def test_static_files_are_available_without_database_access(self):
        response = self.client.get('/static/css/main.css')
        self.assertEqual(response.status_code, 200)
        response.close()
        self.connect.assert_not_called()


if __name__ == '__main__':
    unittest.main()
