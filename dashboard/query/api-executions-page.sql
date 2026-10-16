SET NOCOUNT ON;
DECLARE @from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @folder nvarchar(128) = ?, @project nvarchar(128) = ?,
        @folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?,
        @take int = ?, @upper bigint = ?, @last bigint = ?, @descending bit = ?;

-- Materialize at most 201 candidates before any recorded-count/logging lookup.
-- Catalog views retain the current connection identity's row visibility.
SELECT TOP (@take) e.execution_id, e.folder_name, e.project_name, e.package_name,
       e.project_lsn, e.environment_folder_name, e.environment_name, e.status,
       e.created_time AS created_at, e.start_time AS started_at, e.end_time AS ended_at
INTO #execution_page
FROM catalog.executions AS e
WHERE e.created_time >= @from AND e.created_time < @to
  AND (@folder IS NULL OR e.folder_name = @folder)
  AND (@project IS NULL OR e.project_name = @project)
  AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
  AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
  AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))
  AND e.execution_id <= @upper
  AND (@last IS NULL OR (@descending = 1 AND e.execution_id < @last)
                     OR (@descending = 0 AND e.execution_id > @last))
ORDER BY CASE WHEN @descending = 1 THEN e.execution_id END DESC,
         CASE WHEN @descending = 0 THEN e.execution_id END ASC
OPTION (RECOMPILE);

-- Isolate aggregation from logging/permission joins so the event view can be
-- scanned once for the page, rather than once per execution.
SELECT p.execution_id,
       SUM(CASE WHEN m.event_name = N'OnWarning' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS warning_count,
       SUM(CASE WHEN m.event_name = N'OnError' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS error_count
INTO #page_counts
FROM #execution_page AS p
LEFT JOIN catalog.event_messages AS m ON m.operation_id = p.execution_id AND m.event_name IN (N'OnWarning', N'OnError')
GROUP BY p.execution_id
OPTION (RECOMPILE);

SELECT p.*, loglevel.logging_level, recorded.warning_count, recorded.error_count
FROM #execution_page AS p
INNER JOIN #page_counts AS recorded ON recorded.execution_id = p.execution_id
OUTER APPLY (
    SELECT CONVERT(int, v.parameter_value) AS logging_level
    FROM catalog.execution_parameter_values AS v
    WHERE v.execution_id = p.execution_id AND v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
) AS loglevel
ORDER BY CASE WHEN @descending = 1 THEN p.execution_id END DESC,
         CASE WHEN @descending = 0 THEN p.execution_id END ASC
OPTION (RECOMPILE);
