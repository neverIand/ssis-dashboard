SET NOCOUNT ON;
DECLARE @execution_id bigint = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS upper_id WHERE 1 = 0;
    RETURN;
END;

SELECT MAX(statistics_id) AS upper_id
FROM catalog.executable_statistics
WHERE execution_id = @execution_id;
