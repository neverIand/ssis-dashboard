SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @kind int = ?, @q nvarchar(2050) = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS upper_id WHERE 1 = 0;
    RETURN;
END;

DECLARE @filter nvarchar(max) = N' FROM catalog.event_messages AS m WHERE m.operation_id = @execution_id'
    + CASE @kind
        WHEN 0 THEN N''
        WHEN 1 THEN N' AND m.event_name = N''OnError'''
        WHEN 2 THEN N' AND m.event_name = N''OnWarning'''
        WHEN 3 THEN N' AND m.event_name = N''OnWarning'' AND m.message LIKE N''%duplicate%'''
        WHEN 4 THEN N' AND m.event_name = N''OnInformation'' AND m.message LIKE N''%memory allocation%'''
      END
    -- Fold case under a fixed Unicode collation, then compare literal UTF-16.
    -- Legacy catalog LIKE/CHARINDEX collations can ignore supplementary text.
    + CASE WHEN @q IS NULL THEN N'' ELSE N' AND CHARINDEX(
        LOWER(@q COLLATE Latin1_General_100_CI_AS_SC) COLLATE Latin1_General_100_BIN2,
        LOWER(m.message COLLATE Latin1_General_100_CI_AS_SC) COLLATE Latin1_General_100_BIN2) > 0' END;

-- Public numeric IDs are the stable paging key. GUIDs are nullable and have no
-- uniqueness guarantee in the Scale Out source; do not manufacture identities.
DECLARE @sql nvarchar(max) = N'SELECT (SELECT TOP (1) m.event_message_id'
    + @filter + N' AND m.event_message_id IS NOT NULL ORDER BY m.event_message_id DESC) AS upper_id,
    CONVERT(bit, CASE WHEN EXISTS (SELECT 1' + @filter + N' AND m.event_message_id IS NULL)
        THEN 1 ELSE 0 END) AS has_unidentified_events;';
EXEC sys.sp_executesql @sql, N'@execution_id bigint, @q nvarchar(2050)', @execution_id = @execution_id, @q = @q;
