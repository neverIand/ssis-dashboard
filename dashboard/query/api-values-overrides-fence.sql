SET NOCOUNT ON;
DECLARE @execution_id bigint = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS upper_id WHERE 1 = 0;
    RETURN;
END;

SELECT (SELECT TOP (1) property_id FROM catalog.execution_property_override_values
        WHERE execution_id = @execution_id ORDER BY property_id DESC) AS upper_id;
