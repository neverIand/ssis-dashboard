DECLARE @execution_id bigint = ?;

SELECT e.execution_id, e.folder_name, e.project_name, e.package_name, e.project_lsn,
       e.environment_folder_name, e.environment_name, e.status,
       e.created_time AS created_at, e.start_time AS started_at, e.end_time AS ended_at,
       logging.logging_level, logging.logging_rows
FROM catalog.executions AS e
OUTER APPLY (
    SELECT COUNT_BIG(*) AS logging_rows, MAX(CONVERT(int, v.parameter_value)) AS logging_level
    FROM catalog.execution_parameter_values AS v
    WHERE v.execution_id = e.execution_id AND v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
) AS logging
WHERE e.execution_id = @execution_id;
