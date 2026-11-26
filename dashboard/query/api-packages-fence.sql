SET NOCOUNT ON;
DECLARE @folder nvarchar(128) = ?, @project nvarchar(128) = ?;
-- Resolve the one project first (folder names are unique, and project names within a folder): filtering
-- catalog.packages by its ID lets the view's per-row permission check skip other projects' packages.
DECLARE @project_id bigint = (SELECT pr.project_id FROM catalog.projects AS pr
    INNER JOIN catalog.folders AS f ON f.folder_id = pr.folder_id WHERE f.name = @folder AND pr.name = @project);
-- The statement that reads packages checks project and folder visibility again (once, not per row), so a
-- permission change between the two statements cannot expose a package of a project or folder no longer visible.
SELECT MAX(p.package_id) AS upper_id
FROM catalog.packages AS p
WHERE p.project_id = @project_id
  AND EXISTS (SELECT 1 FROM catalog.projects AS pr INNER JOIN catalog.folders AS f ON f.folder_id = pr.folder_id
              WHERE pr.project_id = @project_id AND f.name = @folder AND pr.name = @project);
