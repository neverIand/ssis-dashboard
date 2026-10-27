SET NOCOUNT ON;
DECLARE @folder nvarchar(512) = ?, @project nvarchar(512) = ?, @package nvarchar(512) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?;

SELECT (SELECT TOP (1) e.execution_id FROM catalog.executions AS e
        WHERE e.folder_name LIKE @folder AND e.project_name LIKE @project AND e.package_name LIKE @package
          AND e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9)
        ORDER BY e.execution_id DESC) AS upper_id;
