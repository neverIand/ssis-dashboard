DECLARE @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_name nvarchar(128) = ?, @by_name bit = ?, @descending bit = ?;

SELECT TOP (@take) f.folder_id AS folder_id, f.name AS name, f.description AS description
FROM catalog.folders AS f
WHERE EXISTS (SELECT 1 FROM catalog.projects AS p WHERE p.folder_id = f.folder_id)
  AND f.folder_id <= @upper
  AND (@last IS NULL
       OR (@by_name = 1 AND ((@descending = 0 AND f.name > @last_name) OR (@descending = 1 AND f.name < @last_name)))
       OR ((@by_name = 0 OR f.name = @last_name)
           AND ((@descending = 0 AND f.folder_id > @last) OR (@descending = 1 AND f.folder_id < @last))))
ORDER BY CASE WHEN @by_name = 1 AND @descending = 0 THEN f.name END ASC,
         CASE WHEN @by_name = 1 AND @descending = 1 THEN f.name END DESC,
         CASE WHEN @descending = 0 THEN f.folder_id END ASC,
         CASE WHEN @descending = 1 THEN f.folder_id END DESC;
