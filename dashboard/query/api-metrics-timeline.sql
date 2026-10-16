SET NOCOUNT ON;
DECLARE @bounds xml = CONVERT(xml, ?),
        @from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @folder nvarchar(128) = ?, @project nvarchar(128) = ?,
        @folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?;

-- At most 1000 server-generated UTC intervals; XML also works before SQL 2016.
CREATE TABLE #timeline_buckets (
    bucket_id int NOT NULL UNIQUE,
    bucket_start datetimeoffset(7) NOT NULL PRIMARY KEY,
    bucket_end datetimeoffset(7) NOT NULL
);
INSERT #timeline_buckets
SELECT b.value('@i', 'int'), CONVERT(datetimeoffset(7), b.value('@s', 'nvarchar(40)')),
       CONVERT(datetimeoffset(7), b.value('@e', 'nvarchar(40)'))
FROM @bounds.nodes('/buckets/b') AS intervals(b);

-- One cohort aggregation; only bounded grouped counts are materialized.
SELECT bucket.bucket_id, COUNT_BIG(*) AS created_count,
       SUM(CONVERT(bigint, CASE WHEN e.start_time IS NOT NULL THEN 1 ELSE 0 END)) AS started_count,
       SUM(CONVERT(bigint, CASE WHEN e.status = 7 THEN 1 ELSE 0 END)) AS succeeded_count,
       SUM(CONVERT(bigint, CASE WHEN e.status = 4 THEN 1 ELSE 0 END)) AS failed_count
INTO #timeline_counts
FROM catalog.executions AS e
CROSS APPLY (
    SELECT TOP (1) b.bucket_id
    FROM #timeline_buckets AS b
    WHERE b.bucket_start <= e.created_time AND b.bucket_end > e.created_time
    ORDER BY b.bucket_start DESC
) AS bucket
WHERE e.created_time >= @from AND e.created_time < @to
  AND (@folder IS NULL OR e.folder_name = @folder)
  AND (@project IS NULL OR e.project_name = @project)
  AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
  AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
  AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))
GROUP BY bucket.bucket_id;

SELECT b.bucket_id, COALESCE(c.created_count, 0) AS created_count,
       COALESCE(c.started_count, 0) AS started_count, COALESCE(c.succeeded_count, 0) AS succeeded_count,
       COALESCE(c.failed_count, 0) AS failed_count
FROM #timeline_buckets AS b
LEFT JOIN #timeline_counts AS c ON c.bucket_id = b.bucket_id
ORDER BY b.bucket_start;
