SET NOCOUNT ON;
DECLARE @folder nvarchar(128) = ?, @project nvarchar(128) = ?, @package nvarchar(260) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?,
        -- Zero is an internal first-page marker; execution IDs remain positive.
        @take int = ?, @upper bigint = ?, @last bigint = NULLIF(?, 0), @descending bit = ?;

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

-- Read the visible prior-success timestamps once rather than expanding the
-- catalog's permission joins for every page row. No counts or durations are
-- calculated over this source; only each target's TOP (5) is aggregated below.
DECLARE @latest_start datetimeoffset(7) = (SELECT MAX(started_at) FROM #history_rows);
SELECT e.execution_id, e.start_time, e.end_time
INTO #history_successes
FROM catalog.executions AS e
WHERE e.folder_name = @folder AND e.project_name = @project AND e.package_name = @package
  AND e.status = 7 AND e.start_time IS NOT NULL
  AND e.end_time >= e.start_time AND e.end_time <= @latest_start;
CREATE UNIQUE CLUSTERED INDEX IX_history_success_end ON #history_successes (end_time DESC, execution_id DESC);

-- Sample only for the bounded page, independently of its status/ID fence.
-- Decimal totals avoid BIGINT overflow across five long durations; splitting
-- whole seconds and fractions also avoids DATEDIFF_BIG(nanosecond) overflow.
SELECT r.*, estimate.estimate_sample_count, estimate.estimate_total_ticks
FROM #history_rows AS r
OUTER APPLY (
    SELECT COUNT_BIG(*) AS estimate_sample_count,
           SUM(CONVERT(decimal(38, 0), DATEDIFF_BIG(second, s.start_time, s.end_time)) * 10000000
               + (DATEPART(nanosecond, s.end_time) - DATEPART(nanosecond, s.start_time)) / 100) AS estimate_total_ticks
    FROM (
        SELECT TOP (5) e.start_time, e.end_time
        FROM #history_successes AS e
        WHERE e.execution_id <> r.execution_id AND e.end_time <= r.started_at
        ORDER BY e.end_time DESC, e.execution_id DESC
    ) AS s
) AS estimate
ORDER BY CASE WHEN @descending = 1 THEN r.execution_id END DESC,
         CASE WHEN @descending = 0 THEN r.execution_id END ASC;
