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
DECLARE @forward int = CASE WHEN @descending = 1 THEN -1 ELSE 1 END;

-- Ordinary catalog keys can seek and select the page directly. CTEs describe
-- expressions only; the first materialization is the bounded page below.
WITH keyed AS (
    SELECT e.execution_id, e.folder_name, e.project_name, e.package_name,
           e.project_lsn, e.environment_folder_name, e.environment_name, e.status,
           e.created_time AS created_at, e.start_time AS started_at, e.end_time AS ended_at,
           CASE WHEN @sort = N'status' THEN CONVERT(bigint, e.status) END AS sort_number,
           CASE @sort WHEN N'created_at' THEN e.created_time WHEN N'started_at' THEN e.start_time
                WHEN N'ended_at' THEN e.end_time END AS sort_time,
           CASE @sort WHEN N'project_name' THEN e.project_name WHEN N'package_name' THEN e.package_name
                WHEN N'environment' THEN e.environment_folder_name END AS sort_text1,
           CASE WHEN @sort = N'environment' THEN e.environment_name END AS sort_text2
    FROM catalog.executions AS e
    WHERE e.created_time >= @from AND e.created_time < @to
      AND (@folder IS NULL OR e.folder_name = @folder)
      AND (@project IS NULL OR e.project_name = @project)
      AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
      AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
      AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))
      AND e.execution_id <= @upper
), ranked AS (
    SELECT k.*,
           CASE WHEN sort_number IS NULL AND sort_time IS NULL AND sort_text1 IS NULL THEN 1 ELSE 0 END AS sort_null1,
           CASE WHEN sort_text2 IS NULL THEN 1 ELSE 0 END AS sort_null2
    FROM keyed AS k
)
SELECT TOP (@take) r.* INTO #execution_page
FROM ranked AS r
CROSS APPLY (
    SELECT CASE WHEN sort_null1 > @last_null1 THEN 1 WHEN sort_null1 < @last_null1 THEN -1
                WHEN sort_number > @last_number OR sort_time > @last_time OR sort_text1 > @last_text1 THEN @forward
                WHEN sort_number < @last_number OR sort_time < @last_time OR sort_text1 < @last_text1 THEN -@forward
                ELSE 0 END AS first_comparison,
           CASE WHEN sort_null2 > @last_null2 THEN 1 WHEN sort_null2 < @last_null2 THEN -1
                WHEN sort_text2 > @last_text2 THEN @forward WHEN sort_text2 < @last_text2 THEN -@forward
                ELSE 0 END AS second_comparison
) AS seek
WHERE @last IS NULL OR seek.first_comparison > 0
   OR (seek.first_comparison = 0 AND (seek.second_comparison > 0
       OR (seek.second_comparison = 0 AND ((@descending = 1 AND execution_id < @last)
                                        OR (@descending = 0 AND execution_id > @last)))))
ORDER BY sort_null1 ASC,
         CASE WHEN @descending = 0 THEN sort_number END ASC, CASE WHEN @descending = 1 THEN sort_number END DESC,
         CASE WHEN @descending = 0 THEN sort_time END ASC, CASE WHEN @descending = 1 THEN sort_time END DESC,
         CASE WHEN @descending = 0 THEN sort_text1 END ASC, CASE WHEN @descending = 1 THEN sort_text1 END DESC,
         sort_null2 ASC,
         CASE WHEN @descending = 0 THEN sort_text2 END ASC, CASE WHEN @descending = 1 THEN sort_text2 END DESC,
         CASE WHEN @descending = 0 THEN r.execution_id END ASC, CASE WHEN @descending = 1 THEN r.execution_id END DESC
OPTION (RECOMPILE);

-- Preserve bounded-page join order before expanding public-view permissions.
SELECT p.execution_id,
       SUM(CASE WHEN m.event_name = N'OnWarning' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS warning_count,
       SUM(CASE WHEN m.event_name = N'OnError' THEN CONVERT(bigint, 1) ELSE CONVERT(bigint, 0) END) AS error_count
INTO #page_counts
FROM #execution_page AS p
LEFT JOIN catalog.event_messages AS m ON m.operation_id = p.execution_id AND m.event_name IN (N'OnWarning', N'OnError')
GROUP BY p.execution_id
OPTION (RECOMPILE, FORCE ORDER);

SELECT p.*, loglevel.logging_level, recorded.warning_count, recorded.error_count
FROM #execution_page AS p
INNER JOIN #page_counts AS recorded ON recorded.execution_id = p.execution_id
OUTER APPLY (
    SELECT CONVERT(int, CASE WHEN v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL' THEN v.parameter_value END) AS logging_level
    FROM catalog.execution_parameter_values AS v
    WHERE v.execution_id = p.execution_id AND v.object_type = 50 AND v.parameter_name = N'LOGGING_LEVEL'
) AS loglevel
ORDER BY sort_null1 ASC,
         CASE WHEN @descending = 0 THEN sort_number END ASC, CASE WHEN @descending = 1 THEN sort_number END DESC,
         CASE WHEN @descending = 0 THEN sort_time END ASC, CASE WHEN @descending = 1 THEN sort_time END DESC,
         CASE WHEN @descending = 0 THEN sort_text1 END ASC, CASE WHEN @descending = 1 THEN sort_text1 END DESC,
         sort_null2 ASC,
         CASE WHEN @descending = 0 THEN sort_text2 END ASC, CASE WHEN @descending = 1 THEN sort_text2 END DESC,
         CASE WHEN @descending = 0 THEN p.execution_id END ASC, CASE WHEN @descending = 1 THEN p.execution_id END DESC;
