SET NOCOUNT ON;
DECLARE @execution_id bigint = ?;

-- Recheck the connection's current execution visibility before reading messages.
IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS [all], CONVERT(bigint, NULL) AS errors,
           CONVERT(bigint, NULL) AS warnings, CONVERT(bigint, NULL) AS duplicate_warnings,
           CONVERT(bigint, NULL) AS memory_warnings
    WHERE 1 = 0;
    RETURN;
END;

-- One conditional aggregation, separate from metadata/logging joins. Evaluate
-- heuristics on full source text under catalog collation; return only counts.
-- Do not join on event_message_id: public Scale Out rows can have a NULL ID.
SELECT COUNT_BIG(*) AS [all],
       COALESCE(SUM(CONVERT(bigint, CASE WHEN m.event_name = N'OnError' THEN 1 ELSE 0 END)), 0) AS errors,
       COALESCE(SUM(CONVERT(bigint, CASE WHEN m.event_name = N'OnWarning' THEN 1 ELSE 0 END)), 0) AS warnings,
       COALESCE(SUM(CONVERT(bigint, CASE WHEN m.event_name = N'OnWarning'
           AND m.message LIKE N'%duplicate%' THEN 1 ELSE 0 END)), 0) AS duplicate_warnings,
       COALESCE(SUM(CONVERT(bigint, CASE WHEN m.event_name = N'OnInformation'
           AND m.message LIKE N'%memory allocation%' THEN 1 ELSE 0 END)), 0) AS memory_warnings
FROM catalog.event_messages AS m
WHERE m.operation_id = @execution_id;
