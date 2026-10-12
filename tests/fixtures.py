"""Synthetic legacy presentation data; no SQL Server or production values."""


class LegacyMonitorFixture:
    all = 'all'
    folder_name = project_name = package_name = status = execution_id = all

    def get_engine_info(self):
        return {'server_name': 'Synthetic SQL Server'}

    def get_engine_folders(self):
        return [{'folder_id': 1, 'name': 'Sample folder'}]

    def get_engine_projects(self):
        return [{'folder_id': 1, 'name': 'Sample project', 'description': 'Synthetic project'}]

    def get_engine_kpi(self):
        return {'all': 1, 'running': 0, 'cancelled': 0, 'failed': 0, 'halted': 0, 'succeeded': 1}

    def get_execution_statistics(self):
        return [{
            'calendar_date': '2026-10-12', 'executed_packages': 1,
            'created_packages': 0, 'failed_packages': 0, 'succeeded_packages': 1,
        }]

    def get_package_info(self):
        return {
            'folder_name': 'Sample folder', 'project_name': 'Sample project',
            'package_name': 'Sample.dtsx', 'project_lsn': 123,
        }

    def get_package_kpi(self):
        return {'events': 1, 'errors': 0, 'warnings': 0, 'memory_warnings': 0, 'duplicate_warnings': 0}

    def get_package_list(self):
        return [{
            **self.get_package_info(), 'execution_id': 42, 'environment': 'Test',
            'status': 7, 'status_desc': 'Succeeded', 'logging_level_desc': 'Basic',
            'start_time': '2026-10-12 09:00:00', 'end_time': '2026-10-12 09:01:00',
            'elapsed_time_min': 1, 'errors': 0, 'warnings': 0,
        }]

    def get_package_executables(self):
        return [{
            'statistics_id': 1, 'package_name': 'Sample.dtsx',
            'executable_name': 'Synthetic executable', 'status': 0, 'status_desc': 'Success',
            'start_time': '2026-10-12 09:00:00', 'end_time': '2026-10-12 09:01:00',
            'execution_duration_min': 1,
        }]

    def get_package_children(self):
        return [{
            'event_message_id': 2, 'message_source_type': 'Execute Package Task',
            'package_name': 'Child.dtsx', 'message_source_name': 'Load child',
            'execution_path': '\\Sample\\Child', 'pre_message_time': '2026-10-12 09:00:00',
            'post_message_time': '2026-10-12 09:01:00', 'elapsed_time_min': 1,
        }]

    def get_package_events(self, event_type):
        return [{
            'message_time': '2026-10-12 09:00:00', 'message': '<script>fixture</script>',
            'package_name': 'Sample.dtsx', 'package_path': '\\Sample',
            'subcomponent_name': 'Synthetic component', 'execution_path': '\\Sample\\Load',
        }]

    def get_package_details(self, detail_type):
        if detail_type == 'execution-values':
            return [{
                'object_type_desc': 'Package', 'parameter_name': 'SampleParameter',
                'parameter_value': 'SyntheticValue', 'value_set': 1, 'runtime_override': 0,
            }]
        if detail_type == 'execution-overrides':
            return [{'property_path': '\\Package\\SyntheticProperty', 'property_value': 'SyntheticOverride'}]
        raise AssertionError('Unexpected detail type in presentation fixture')

    def get_package_history(self):
        return [{
            **self.get_package_list()[0], 'environment_name': 'Test',
            'has_expected_values': False, 'avg_elapsed_time_min': 1,
        }]
