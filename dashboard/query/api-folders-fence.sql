-- Folders without a currently visible project are not navigation choices.
SELECT MAX(f.folder_id) AS upper_id
FROM catalog.folders AS f
WHERE EXISTS (SELECT 1 FROM catalog.projects AS p WHERE p.folder_id = f.folder_id);
