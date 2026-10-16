-- Capture a visible ID ceiling within the selected created-time cohort.
DECLARE @from datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @to datetimeoffset(7) = CONVERT(datetimeoffset(7), ?),
        @folder nvarchar(128) = ?, @project nvarchar(128) = ?,
        @folder_pattern nvarchar(1024) = ?, @project_pattern nvarchar(1024) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?;

SELECT MAX(e.execution_id) AS upper_id
FROM catalog.executions AS e
WHERE e.created_time >= @from AND e.created_time < @to
  AND (@folder IS NULL OR e.folder_name = @folder)
  AND (@project IS NULL OR e.project_name = @project)
  AND (@folder_pattern IS NULL OR e.folder_name LIKE @folder_pattern ESCAPE N'~')
  AND (@project_pattern IS NULL OR e.project_name LIKE @project_pattern ESCAPE N'~')
  AND (@s1 IS NULL OR e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9))
OPTION (RECOMPILE);
