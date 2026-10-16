SET NOCOUNT ON;
DECLARE @folder nvarchar(128) = ?, @project nvarchar(128) = ?, @package nvarchar(260) = ?,
        @s1 int = ?, @s2 int = ?, @s3 int = ?, @s4 int = ?, @s5 int = ?,
        @s6 int = ?, @s7 int = ?, @s8 int = ?, @s9 int = ?;

SELECT (SELECT TOP (1) e.execution_id FROM catalog.executions AS e
        WHERE e.folder_name = @folder AND e.project_name = @project AND e.package_name = @package
          AND e.status IN (@s1, @s2, @s3, @s4, @s5, @s6, @s7, @s8, @s9)
        ORDER BY e.execution_id DESC) AS upper_id;
