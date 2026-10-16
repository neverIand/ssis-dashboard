SET NOCOUNT ON;
DECLARE @execution_id bigint = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS upper_id WHERE 1 = 0;
    RETURN;
END;

-- Scale Out starts have no public numeric ID. Report the coverage gap rather
-- than invent an observation ID or mistake an unpageable collection for empty.
SELECT (
    SELECT TOP (1) event_message_id FROM catalog.event_messages
    WHERE operation_id = @execution_id AND event_name = N'OnPreExecute' AND event_message_id IS NOT NULL
      AND package_path COLLATE Latin1_General_100_BIN2 = N'\Package' AND DATALENGTH(package_path) = 16
      AND CHARINDEX(N'\', execution_path, 2) > 0
    ORDER BY event_message_id DESC
) AS upper_id,
CONVERT(bit, CASE WHEN EXISTS (
    SELECT 1 FROM catalog.event_messages
    WHERE operation_id = @execution_id AND event_name = N'OnPreExecute' AND event_message_id IS NULL
      AND package_path COLLATE Latin1_General_100_BIN2 = N'\Package' AND DATALENGTH(package_path) = 16
      AND CHARINDEX(N'\', execution_path, 2) > 0
) THEN 1 ELSE 0 END) AS has_unidentified_starts;
