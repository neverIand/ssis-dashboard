DECLARE @folder nvarchar(128) = ?, @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_name nvarchar(128) = ?, @by_name bit = ?, @descending bit = ?;

-- Unique aliases preserve both the actual project and parent-folder identity.
SELECT TOP (@take) p.project_id AS project_id, p.folder_id AS folder_id,
       f.name AS folder_name, p.name AS name, p.description AS description
FROM catalog.projects AS p
INNER JOIN catalog.folders AS f ON f.folder_id = p.folder_id
WHERE f.name = @folder AND p.project_id <= @upper
  AND (@last IS NULL
       OR (@by_name = 1 AND ((@descending = 0 AND p.name > @last_name) OR (@descending = 1 AND p.name < @last_name)))
       OR ((@by_name = 0 OR p.name = @last_name)
           AND ((@descending = 0 AND p.project_id > @last) OR (@descending = 1 AND p.project_id < @last))))
ORDER BY CASE WHEN @by_name = 1 AND @descending = 0 THEN p.name END ASC,
         CASE WHEN @by_name = 1 AND @descending = 1 THEN p.name END DESC,
         CASE WHEN @descending = 0 THEN p.project_id END ASC,
         CASE WHEN @descending = 1 THEN p.project_id END DESC;
