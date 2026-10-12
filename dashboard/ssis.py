from flask import current_app
from dashboard.db import execute_query
from dashboard.validation import (
    PACKAGE_STATUS_CODES, detail_query, event_query, status_code, validate_execution_id,
)

class configuration:
    pass

class monitor(object):  
    all = 'all'

    logging_codes = {
        0: 'None',
        1: 'Basic',
        2: 'Performance',
        3: 'Verbose',
        4: 'Runtime Lineage',
        100: 'Custom'
    }

    executable_status_codes = {
            0: 'success',
            1: 'failure',
            2: 'completion',
            3: 'cancelled'
        }

    package_status_codes = PACKAGE_STATUS_CODES

    folder_name = all
    project_name = all
    package_name =  all
    status =  all
    execution_id = all

    def __init__(self):
        self.config = configuration()
        self.config.hourSpan = current_app.config["HOUR_SPAN"]
        self.config.asOfDate = current_app.config["AS_OF_DATE"]
        self.config.executionCount = current_app.config["EXECUTION_COUNT"]
        self.config.connectionString = current_app.config["CONNECTION_STRING"]["main"]
        self.config.loginTimeout = current_app.config['DB_LOGIN_TIMEOUT_SECONDS']
        self.config.queryTimeout = current_app.config['DB_QUERY_TIMEOUT_SECONDS']

    def get_engine_info(self):
        result = self.__execute_query('engine-info.sql', True)
        return result

    def get_engine_folders(self):
        result = self.__execute_query('engine-folders.sql', False)
        return result

    def get_engine_projects(self):
        result = self.__execute_query('engine-projects.sql', False)
        return result

    def get_engine_kpi(self):
        result = self.__execute_query(
            'engine-kpi.sql', 
            False,
            self.config.hourSpan, 
            self.config.asOfDate,
            self.__get_proper_name_filter(self.folder_name),
            self.__get_proper_name_filter(self.project_name)
            )

        proper_result = dict([v,0] for v in self.package_status_codes.values())
              
        for r in result: 
            proper_result[self.package_status_codes[r['status_code']]] = r['status_count']

        return proper_result

    def get_execution_statistics(self):
        result = self.__execute_query('executions-statistics.sql',
            False,
            self.config.hourSpan,
            self.config.asOfDate,
            self.__get_proper_name_filter(self.folder_name), 
            self.__get_proper_name_filter(self.project_name), 
            self.__get_proper_package_status_code(self.status)
            )                
        return result

    def get_aggregate_event_kpi(self):
        """Count events in the legacy folder/project/start-time cohort."""
        # The checked-in SQL uses -1 for aggregation; do not expose it as an ID.
        return self.__get_event_kpi(
            -1,
            self.__get_proper_name_filter(self.folder_name),
            self.__get_proper_name_filter(self.project_name),
        )

    def get_execution_event_kpi(self, execution_id):
        """Count events for one explicit execution, independent of screen filters."""
        return self.__get_event_kpi(validate_execution_id(execution_id), '%', '%')

    def __get_event_kpi(self, execution_id, folder_pattern, project_pattern):
        result = self.__execute_query(
            'package-kpi.sql', 
            True,
            self.config.hourSpan, 
            self.config.asOfDate,
            folder_pattern,
            project_pattern,
            execution_id
            )            
        return result

    def get_package_list(self):
        result = self.__execute_query(
            'package-list.sql', 
            False,
            self.config.hourSpan,
            self.config.asOfDate,
            self.__get_proper_name_filter(self.folder_name),
            self.__get_proper_name_filter(self.project_name),
            self.__get_proper_package_status_code(self.status),
            self.config.executionCount
            )

        for r in result:
            r["status_desc"] = self.package_status_codes[r["status"]].title()
            r["logging_level_desc"] = self.logging_codes[r["logging_level"]].title()

        return result
    
    def get_package_info(self):
        result = self.__execute_query(
                'package-info.sql', 
                True,
                validate_execution_id(self.execution_id)
                )       
        return result

    def get_package_executables(self):
        result = self.__execute_query(
            'package-executables.sql', 
            False,
            validate_execution_id(self.execution_id)
            )

        for r in result:
            r["status_desc"] = self.executable_status_codes[r["status"]].title()

        return result

    def get_package_children(self):
        result = self.__execute_query(
            'package-children.sql', 
            False,
            validate_execution_id(self.execution_id)
            )
        return result

    def get_package_events(self, event_type):
        query_file = event_query(event_type)
        result = self.__execute_query(
            query_file, 
            False,
            validate_execution_id(self.execution_id)
            )
        return result

    def get_package_details(self, detail_type):
        query_file = detail_query(detail_type)
        result = self.__execute_query(
            query_file, 
            False,
            validate_execution_id(self.execution_id)
            )
        return result

    def get_package_history(self):
        query_file = 'package-history.sql'
        result = self.__execute_query(
            query_file, 
            False,
            self.__get_proper_name_filter(self.folder_name), 
            self.__get_proper_name_filter(self.project_name), 
            self.__get_proper_name_filter(self.package_name)
            )
        return result

    def __execute_query(self, query_file, onerow, *args):
        return execute_query(
            query_file, args,
            connection_string=self.config.connectionString,
            one_row=onerow,
            login_timeout=self.config.loginTimeout,
            query_timeout=self.config.queryTimeout,
        )

    def __get_proper_name_filter(self, name_filter):
        result = '%'    
        if (name_filter != monitor.all): 
            result = name_filter.replace('*', '%')
        return result

    def __get_proper_package_status_code(self, status):
        return status_code(status)


