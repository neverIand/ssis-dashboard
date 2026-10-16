DECLARE @folder nvarchar(128) = ?;
SELECT MAX(p.project_id) AS upper_id
FROM catalog.projects AS p
INNER JOIN catalog.folders AS f ON f.folder_id = p.folder_id
WHERE f.name = @folder;
