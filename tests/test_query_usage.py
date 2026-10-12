import unittest
from unittest.mock import patch

from dashboard import create_app
from dashboard.ssis import monitor
from dashboard.validation import InvalidInput
from tests.fixtures import LegacyMonitorFixture


CONFIG = {
    'TESTING': True,
    'HOUR_SPAN': 48,
    'AS_OF_DATE': '2026-10-12 12:00:00',
    'EXECUTION_COUNT': 25,
    'CONNECTION_STRING': {'main': 'synthetic connection'},
}
WINDOW = (48, '2026-10-12 12:00:00')


class LegacyQueryUsageTests(unittest.TestCase):
    """Render real views/monitor code while recording the query boundary."""

    def setUp(self):
        connector = patch('pyodbc.connect', side_effect=AssertionError('No live database in tests'))
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.rows = LegacyMonitorFixture()
        self.missing_execution = False
        boundary = patch('dashboard.ssis.execute_query', side_effect=self.query_fixture)
        self.query = boundary.start()
        self.addCleanup(boundary.stop)
        self.app = create_app(CONFIG)
        self.client = self.app.test_client()

    def tearDown(self):
        self.connect.assert_not_called()

    def query_fixture(self, resource, parameters, **settings):
        if resource == 'engine-kpi.sql':
            return [{'status_code': 0, 'status_count': 1}, {'status_code': 7, 'status_count': 1}]
        if resource == 'package-list.sql':
            return [{**row, 'logging_level': 1} for row in self.rows.get_package_list()]
        if resource == 'package-info.sql':
            return {} if self.missing_execution else self.rows.get_package_info()
        if resource == 'package-kpi.sql':
            return self.rows.get_execution_event_kpi(parameters[-1])
        if resource.startswith('package-events-'):
            return self.rows.get_package_events(resource[len('package-events-'):-4])
        if resource.startswith('package-details-'):
            return self.rows.get_package_details(resource[len('package-details-'):-4])
        operations = {
            'engine-info.sql': self.rows.get_engine_info,
            'engine-folders.sql': self.rows.get_engine_folders,
            'engine-projects.sql': self.rows.get_engine_projects,
            'executions-statistics.sql': self.rows.get_execution_statistics,
            'package-executables.sql': self.rows.get_package_executables,
            'package-children.sql': self.rows.get_package_children,
            'package-history.sql': self.rows.get_package_history,
        }
        return operations[resource]()

    def assert_queries(self, expected):
        self.assertEqual(
            [(call.args[0], call.args[1], call.kwargs['one_row']) for call in self.query.call_args_list],
            expected,
        )

    def test_overview_variants_use_only_their_six_queries_and_preserve_filters(self):
        routes = [
            ('/', '%', '%', 0),
            ('/folder/Sample%20folder', 'Sample folder', '%', 0),
            ('/folder/Sample%20folder/project/Sample%20project', 'Sample folder', 'Sample project', 0),
            ('/folder/F*/project/P*/status/succeeded', 'F%', 'P%', 7),
        ]
        for path, folder, project, status in routes:
            with self.subTest(path=path):
                self.query.reset_mock()
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                html = response.get_data(as_text=True)
                self.assertIn('Sample.dtsx', html)
                self.assertIn('href="/execution/42"', html)
                self.assertIn('2026-10-12', html)
                self.assertIn('Sample%20folder/project/Sample%20project', html)
                self.assert_queries([
                    ('engine-folders.sql', (), False),
                    ('engine-projects.sql', (), False),
                    ('engine-kpi.sql', (*WINDOW, folder, project), False),
                    ('engine-info.sql', (), True),
                    ('executions-statistics.sql', (*WINDOW, folder, project, status), False),
                    ('package-list.sql', (*WINDOW, folder, project, status, 25), False),
                ])

    def test_execution_retains_navigation_kpi_children_and_executables_with_seven_queries(self):
        response = self.client.get('/execution/42')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        for expected in ('Child.dtsx', 'Synthetic executable', 'label-success',
                         'Sample%20folder/project/Sample%20project', '/execution/42/events/errors'):
            self.assertIn(expected, html)
        self.assert_queries([
            ('package-info.sql', (42,), True),
            ('engine-folders.sql', (), False),
            ('engine-projects.sql', (), False),
            ('engine-info.sql', (), True),
            ('package-kpi.sql', (*WINDOW, '%', '%', 42), True),
            ('package-executables.sql', (42,), False),
            ('package-children.sql', (42,), False),
        ])

    def test_all_event_categories_use_four_queries_and_keep_messages_and_kpi_links(self):
        for category in ('all', 'errors', 'warnings', 'duplicate-warnings', 'memory-warnings'):
            with self.subTest(category=category):
                self.query.reset_mock()
                response = self.client.get(f'/execution/42/events/{category}')
                self.assertEqual(response.status_code, 200)
                html = response.get_data(as_text=True)
                self.assertIn('&lt;script&gt;fixture&lt;/script&gt;', html)
                self.assertIn('/execution/42/events/errors', html)
                self.assert_queries([
                    ('package-info.sql', (42,), True),
                    ('engine-info.sql', (), True),
                    ('package-kpi.sql', (*WINDOW, '%', '%', 42), True),
                    (f'package-events-{category}.sql', (42,), False),
                ])

    def test_values_retains_five_required_queries_including_kpi_and_both_value_sections(self):
        response = self.client.get('/execution/42/values')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        for expected in ('SyntheticValue', 'SyntheticOverride', 'fa-check-square-o', '/execution/42/events/errors'):
            self.assertIn(expected, html)
        self.assert_queries([
            ('package-info.sql', (42,), True),
            ('engine-info.sql', (), True),
            ('package-kpi.sql', (*WINDOW, '%', '%', 42), True),
            ('package-details-execution-values.sql', (42,), False),
            ('package-details-execution-overrides.sql', (42,), False),
        ])

    def test_history_uses_two_queries_and_keeps_legacy_scope_and_chart_data(self):
        response = self.client.get('/history/F*/project/P*/status/failed/package/Sample*.dtsx')
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('Historical Performances', html)
        self.assertIn('Sample.dtsx', html)
        self.assertIn("elapsed: '1', avg: '1'", html)
        self.assert_queries([
            ('engine-info.sql', (), True),
            ('package-history.sql', ('F%', 'P%', 'Sample%.dtsx'), False),
        ])

    def test_missing_execution_still_runs_only_the_visibility_lookup(self):
        self.missing_execution = True
        for suffix in ('', '/events/all', '/values'):
            with self.subTest(suffix=suffix):
                self.query.reset_mock()
                response = self.client.get(f'/execution/42{suffix}')
                self.assertEqual(response.status_code, 404)
                self.assert_queries([('package-info.sql', (42,), True)])

    def test_invalid_routes_and_selectors_still_run_no_queries(self):
        for path, status in (
            ('/not-a-route', 404), ('/execution/0', 400),
            ('/execution/42/events/unknown', 400),
            ('/folder/F/project/P/status/unknown', 400),
            ('/history/F/project/P/status/unknown/package/Sample.dtsx', 400),
        ):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, status)
        self.query.assert_not_called()


class EventKpiSelectionTests(unittest.TestCase):
    def setUp(self):
        connector = patch('pyodbc.connect', side_effect=AssertionError('No live database in tests'))
        self.connect = connector.start()
        self.addCleanup(connector.stop)
        self.app = create_app(CONFIG)
        self.counts = {'events': 10, 'errors': 2, 'warnings': 3, 'duplicate_warnings': 1, 'memory_warnings': 1}
        boundary = patch('dashboard.ssis.execute_query', return_value=self.counts)
        self.query = boundary.start()
        self.addCleanup(boundary.stop)

    def tearDown(self):
        self.connect.assert_not_called()

    def assert_kpi_query(self, parameters):
        self.query.assert_called_once()
        self.assertEqual(self.query.call_args.args, ('package-kpi.sql', parameters))
        for name, value in {'connection_string': 'synthetic connection', 'one_row': True,
                            'login_timeout': 10, 'query_timeout': 30}.items():
            self.assertEqual(self.query.call_args.kwargs[name], value)

    def test_default_aggregate_operation_selects_all_executions_instead_of_execution_zero(self):
        with self.app.app_context():
            result = monitor().get_aggregate_event_kpi()
        self.assertIs(result, self.counts)
        self.assert_kpi_query((*WINDOW, '%', '%', -1))

    def test_aggregate_preserves_name_patterns_and_ignores_selected_execution_and_status(self):
        with self.app.app_context():
            instance = monitor()
            instance.folder_name = "Unicode 文件夹*'; SELECT example"
            instance.project_name = 'Project*'
            instance.status = 'failed'
            instance.execution_id = 42
            self.assertIs(instance.get_aggregate_event_kpi(), self.counts)
        self.assert_kpi_query((*WINDOW, "Unicode 文件夹%'; SELECT example", 'Project%', -1))

    def test_execution_kpi_uses_explicit_id_without_needing_a_monitor_selection(self):
        with self.app.app_context():
            self.assertIs(monitor().get_execution_event_kpi(42), self.counts)
        self.assert_kpi_query((*WINDOW, '%', '%', 42))

    def test_execution_kpi_ignores_conflicting_screen_filters_and_binds_full_bigint(self):
        execution_id = 2**63 - 1
        with self.app.app_context():
            instance = monitor()
            instance.execution_id = 43
            instance.folder_name = 'Unrelated folder'
            instance.project_name = 'Unrelated project'
            instance.status = 'failed'
            self.assertIs(instance.get_execution_event_kpi(execution_id), self.counts)
        self.assert_kpi_query((*WINDOW, '%', '%', execution_id))

    def test_execution_kpi_rejects_aggregate_sentinels_and_invalid_ids_before_querying(self):
        with self.app.app_context():
            instance = monitor()
            for value in ('all', -1, 0, None, True, '42', 2**63):
                with self.subTest(value=value), self.assertRaises(InvalidInput):
                    instance.get_execution_event_kpi(value)
        self.query.assert_not_called()

    def test_execution_resources_require_a_valid_selection_instead_of_defaulting_to_zero(self):
        with self.app.app_context():
            instance = monitor()
            operations = (
                instance.get_package_info, instance.get_package_executables, instance.get_package_children,
                lambda: instance.get_package_events('all'),
                lambda: instance.get_package_details('execution-values'),
            )
            for value in ('all', -1, 0, None, True, '42', 2**63):
                instance.execution_id = value
                for operation in operations:
                    with self.subTest(value=value, operation=operation), self.assertRaises(InvalidInput):
                        operation()
        self.query.assert_not_called()


if __name__ == '__main__':
    unittest.main()
