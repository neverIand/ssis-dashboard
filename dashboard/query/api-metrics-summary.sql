-- Summary covers every status in the selected creation cohort, without event joins.
DECLARE @from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @folder nvarchar(128) = ?, @project nvarchar(128) = ?,
        @folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?;

-- One extra group lets the serializer reject overflow without returning partial totals.
SELECT TOP (65537) e.status AS status_code, COUNT_BIG(*) AS execution_count
FROM catalog.executions AS e
WHERE e.created_time >= @from AND e.created_time < @to
  AND (@folder IS NULL OR e.folder_name = @folder)
  AND (@project IS NULL OR e.project_name = @project)
  AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
  AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
GROUP BY e.status
ORDER BY e.status;
