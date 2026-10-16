SET NOCOUNT ON;
DECLARE @folder nvarchar(128) = ?, @project nvarchar(128) = ?, @package nvarchar(260) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?,
        @take int = ?, @upper bigint = ?, @last bigint = ?, @descending bit = ?;

CREATE TABLE #history_page (execution_id bigint NOT NULL PRIMARY KEY);
-- Fixed ID orders keep the range usable without sorting a whole named scope.
IF @descending = 1
    INSERT #history_page
    SELECT TOP (@take) e.execution_id FROM catalog.executions AS e
    WHERE e.folder_name = @folder AND e.project_name = @project AND e.package_name = @package
      AND e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9)
      AND e.execution_id <= CASE WHEN @last IS NULL THEN @upper ELSE @last - 1 END
    ORDER BY e.execution_id DESC;
ELSE
    INSERT #history_page
    SELECT TOP (@take) e.execution_id FROM catalog.executions AS e
    WHERE e.folder_name = @folder AND e.project_name = @project AND e.package_name = @package
      AND e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9)
      AND e.execution_id <= @upper AND e.execution_id > ISNULL(@last, CONVERT(bigint, 0))
    ORDER BY e.execution_id ASC;

-- Aggregate once for the selected IDs, independently of logging/metadata joins.
SELECT p.execution_id,
       SUM(CASE WHEN m.event_name = N'OnWarning' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS warning_count,
       SUM(CASE WHEN m.event_name = N'OnError' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS error_count
INTO #history_counts
FROM #history_page AS p
LEFT JOIN catalog.event_messages AS m
    ON m.operation_id = p.execution_id AND m.event_name IN (N'OnWarning', N'OnError')
GROUP BY p.execution_id;

-- The public execution view rechecks visibility after candidate selection.
SELECT e.execution_id, e.folder_name, e.project_name, e.package_name, e.project_lsn,
       e.environment_folder_name, e.environment_name, e.status,
       e.created_time AS created_at, e.start_time AS started_at, e.end_time AS ended_at,
       c.warning_count, c.error_count, logging.logging_level, logging.logging_rows
INTO #history_rows
FROM #history_page AS p
JOIN catalog.executions AS e ON e.execution_id = p.execution_id
JOIN #history_counts AS c ON c.execution_id = p.execution_id
OUTER APPLY (
    -- Keep unrelated user strings outside an eagerly evaluated conversion.
    SELECT COUNT_BIG(*) AS logging_rows,
           MAX(CONVERT(int, CASE WHEN v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
                                 THEN v.parameter_value END)) AS logging_level
    FROM catalog.execution_parameter_values AS v
    WHERE v.execution_id = p.execution_id AND v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
) AS logging;

SELECT * FROM #history_rows
ORDER BY CASE WHEN @descending = 1 THEN execution_id END DESC,
         CASE WHEN @descending = 0 THEN execution_id END ASC;
