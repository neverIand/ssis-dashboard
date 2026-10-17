SET NOCOUNT ON;
DECLARE @from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @folder nvarchar(128) = ?, @project nvarchar(128) = ?,
        @folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?,
        @take int = ?, @upper bigint = ?, @last bigint = ?, @descending bit = ?,
        @sort nvarchar(40) = ?, @last_null1 bit = ?, @last_number bigint = ?,
        @last_time datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @last_text1 nvarchar(260) = ?, @last_null2 bit = ?, @last_text2 nvarchar(128) = ?;
-- Only global sort keys and reusable counts cross the cohort boundary.
-- UTC seconds plus fractional ticks preserve 100-ns precision without the
-- nanosecond BIGINT overflow of long durations. Missing times keep a NULL key.
SELECT e.execution_id, CAST(NULL AS int) AS logging_level,
       CASE WHEN @sort = N'duration_seconds' THEN
           DATEDIFF_BIG(second, t.started, t.ended) * CONVERT(bigint, 10000000)
           + (DATEPART(nanosecond, t.ended) - DATEPART(nanosecond, t.started)) / 100
       END AS duration_ticks,
       CAST(NULL AS bigint) AS warning_count, CAST(NULL AS bigint) AS error_count
INTO #execution_cohort
FROM catalog.executions AS e
CROSS APPLY (SELECT CONVERT(datetime2(7), SWITCHOFFSET(e.start_time, '+00:00')) AS started,
                    CONVERT(datetime2(7), SWITCHOFFSET(e.end_time, '+00:00')) AS ended) AS t
WHERE e.created_time >= @from AND e.created_time < @to
  AND (@folder IS NULL OR e.folder_name = @folder)
  AND (@project IS NULL OR e.project_name = @project)
  AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
  AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
  AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))
  AND e.execution_id <= @upper
OPTION (RECOMPILE);

IF @sort = N'logging_level'
    UPDATE c SET logging_level = CONVERT(int, CASE WHEN v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL' THEN v.parameter_value END)
    FROM #execution_cohort AS c
    INNER JOIN catalog.execution_parameter_values AS v ON v.execution_id = c.execution_id
    WHERE v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
    OPTION (RECOMPILE);

IF @sort IN (N'warning_count', N'error_count')
BEGIN
    SELECT c.execution_id,
           SUM(CASE WHEN m.event_name = N'OnWarning' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS warning_count,
           SUM(CASE WHEN m.event_name = N'OnError' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS error_count
    INTO #execution_counts
    FROM #execution_cohort AS c
    LEFT JOIN catalog.event_messages AS m ON m.operation_id = c.execution_id AND m.event_name IN (N'OnWarning', N'OnError')
    GROUP BY c.execution_id
    OPTION (RECOMPILE, FORCE ORDER);

    UPDATE c SET warning_count = recorded.warning_count, error_count = recorded.error_count
    FROM #execution_cohort AS c INNER JOIN #execution_counts AS recorded ON recorded.execution_id = c.execution_id;
END;

WITH keyed AS (
    SELECT c.*,
           CASE @sort WHEN N'logging_level' THEN logging_level
                WHEN N'duration_seconds' THEN duration_ticks WHEN N'warning_count' THEN warning_count
                WHEN N'error_count' THEN error_count END AS sort_number
    FROM #execution_cohort AS c
), ranked AS (
    SELECT k.*,
           CASE WHEN sort_number IS NULL THEN 1 ELSE 0 END AS sort_null1
    FROM keyed AS k
)
SELECT TOP (@take) r.* INTO #execution_page
FROM ranked AS r
WHERE @last IS NULL OR sort_null1 > @last_null1
   OR (sort_null1 = @last_null1 AND (
       (@descending = 0 AND sort_number > @last_number)
       OR (@descending = 1 AND sort_number < @last_number)
       OR ((sort_number = @last_number OR @last_null1 = 1)
           AND ((@descending = 0 AND execution_id > @last)
                OR (@descending = 1 AND execution_id < @last)))))
ORDER BY sort_null1 ASC,
         CASE WHEN @descending = 0 THEN sort_number END ASC, CASE WHEN @descending = 1 THEN sort_number END DESC,
         CASE WHEN @descending = 0 THEN execution_id END ASC, CASE WHEN @descending = 1 THEN execution_id END DESC
OPTION (RECOMPILE);

-- Fetch remaining metrics only for the bounded page. FORCE ORDER keeps the
-- selected IDs ahead of the public event view's permission expansion.
IF @sort NOT IN (N'warning_count', N'error_count')
BEGIN
    SELECT p.execution_id,
           SUM(CASE WHEN m.event_name = N'OnWarning' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS warning_count,
           SUM(CASE WHEN m.event_name = N'OnError' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS error_count
    INTO #page_counts
    FROM #execution_page AS p
    LEFT JOIN catalog.event_messages AS m ON m.operation_id = p.execution_id AND m.event_name IN (N'OnWarning', N'OnError')
    GROUP BY p.execution_id
    OPTION (RECOMPILE, FORCE ORDER);

    UPDATE p SET warning_count = recorded.warning_count, error_count = recorded.error_count
    FROM #execution_page AS p INNER JOIN #page_counts AS recorded ON recorded.execution_id = p.execution_id;
END;

IF @sort <> N'logging_level'
    UPDATE p SET logging_level = CONVERT(int, CASE WHEN v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL' THEN v.parameter_value END)
    FROM #execution_page AS p
    INNER JOIN catalog.execution_parameter_values AS v ON v.execution_id = p.execution_id
    WHERE v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
    OPTION (RECOMPILE);

-- Recheck public execution visibility when fetching page metadata.
SELECT p.*, e.folder_name, e.project_name, e.package_name, e.project_lsn,
       e.environment_folder_name, e.environment_name, e.status,
       e.created_time AS created_at, e.start_time AS started_at, e.end_time AS ended_at
FROM #execution_page AS p
INNER JOIN catalog.executions AS e ON e.execution_id = p.execution_id
ORDER BY sort_null1 ASC,
         CASE WHEN @descending = 0 THEN sort_number END ASC, CASE WHEN @descending = 1 THEN sort_number END DESC,
         CASE WHEN @descending = 0 THEN p.execution_id END ASC, CASE WHEN @descending = 1 THEN p.execution_id END DESC;
