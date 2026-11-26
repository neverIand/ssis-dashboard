SET NOCOUNT ON;
DECLARE @folder nvarchar(128) = ?, @project nvarchar(128) = ?, @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_name nvarchar(260) = ?, @by_name bit = ?, @descending bit = ?;
DECLARE @project_id bigint, @project_name nvarchar(128), @folder_id bigint, @folder_name nvarchar(128);
-- As in the fence: resolve the one project, read only its current-version packages, and check project and
-- folder visibility again, once, in the statement that reads them. The parent IDs and names come from the
-- first statement; the check also requires the same folder ID.
SELECT @project_id = pr.project_id, @project_name = pr.name, @folder_id = f.folder_id, @folder_name = f.name
FROM catalog.projects AS pr INNER JOIN catalog.folders AS f ON f.folder_id = pr.folder_id
WHERE f.name = @folder AND pr.name = @project;

-- Unique aliases keep the package, project and folder identities apart.
SELECT TOP (@take) p.package_id AS package_id, @project_id AS project_id, @project_name AS project_name,
       @folder_id AS folder_id, @folder_name AS folder_name, p.name AS name, p.description AS description
FROM catalog.packages AS p
WHERE p.project_id = @project_id
  AND EXISTS (SELECT 1 FROM catalog.projects AS pr INNER JOIN catalog.folders AS f ON f.folder_id = pr.folder_id
              WHERE pr.project_id = @project_id AND f.folder_id = @folder_id AND f.name = @folder AND pr.name = @project)
  AND p.package_id <= @upper
  AND (@last IS NULL
       OR (@by_name = 1 AND ((@descending = 0 AND p.name > @last_name) OR (@descending = 1 AND p.name < @last_name)))
       OR ((@by_name = 0 OR p.name = @last_name)
           AND ((@descending = 0 AND p.package_id > @last) OR (@descending = 1 AND p.package_id < @last))))
ORDER BY CASE WHEN @by_name = 1 AND @descending = 0 THEN p.name END ASC,
         CASE WHEN @by_name = 1 AND @descending = 1 THEN p.name END DESC,
         CASE WHEN @descending = 0 THEN p.package_id END ASC,
         CASE WHEN @descending = 1 THEN p.package_id END DESC;
