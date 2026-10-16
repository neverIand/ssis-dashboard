SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_time datetimeoffset(7) = CONVERT(datetimeoffset(7), ?), @by_time bit = ?, @descending bit = ?,
        @kind int = ?, @q nvarchar(2050) = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(bigint, NULL) AS page_empty WHERE 1 = 0;
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

-- Full-message filters precede the bounded page. Only fixed, trusted fragments
-- enter SQL text; all caller values retain typed sp_executesql parameters.
CREATE TABLE #event_page (event_id bigint NOT NULL PRIMARY KEY, message_time datetimeoffset(7) NOT NULL);
DECLARE @ceiling bigint = CASE WHEN @by_time = 0 AND @descending = 1 AND @last IS NOT NULL THEN @last - 1 ELSE @upper END;
DECLARE @sql nvarchar(max) = N'INSERT #event_page SELECT TOP (@take) m.event_message_id, m.message_time'
    + @filter + N' AND m.event_message_id <= @ceiling'
    + CASE WHEN @by_time = 0 THEN CASE WHEN @descending = 0
        THEN N' AND m.event_message_id > ISNULL(@last, CONVERT(bigint, 0)) ORDER BY m.event_message_id ASC;'
        ELSE N' ORDER BY m.event_message_id DESC;' END
      WHEN @descending = 0 THEN N' AND (@last IS NULL OR m.message_time > @last_time OR (m.message_time = @last_time AND m.event_message_id > @last)) ORDER BY m.message_time ASC, m.event_message_id ASC;'
      ELSE N' AND (@last IS NULL OR m.message_time < @last_time OR (m.message_time = @last_time AND m.event_message_id < @last)) ORDER BY m.message_time DESC, m.event_message_id DESC;' END;
EXEC sys.sp_executesql @sql,
    N'@execution_id bigint, @take int, @ceiling bigint, @last bigint, @last_time datetimeoffset(7), @q nvarchar(2050)',
    @execution_id = @execution_id, @take = @take, @ceiling = @ceiling, @last = @last, @last_time = @last_time, @q = @q;

DECLARE @event_rows TABLE (
    event_id bigint NOT NULL PRIMARY KEY, message_time datetimeoffset(7) NOT NULL,
    event_name nvarchar(1024) NULL, message_type smallint NOT NULL, source_type smallint NULL,
    message nvarchar(max) NULL, package_name nvarchar(260) NULL, package_path nvarchar(max) NULL,
    execution_path nvarchar(max) NULL, source_name nvarchar(4000) NULL, subcomponent_name nvarchar(4000) NULL
);
INSERT @event_rows
SELECT p.event_id, p.message_time, m.event_name, m.message_type, m.message_source_type,
       -- Count code units explicitly: native SC LEFT can split a pair near
       -- its 64-KiB boundary. Keep two units per display character plus a full
       -- sentinel, removing a high surrogate only at an actually clipped edge.
       CASE WHEN DATALENGTH(m.message) > 65540 AND UNICODE(RIGHT(b.message_prefix, 1)) BETWEEN 55296 AND 56319
            THEN LEFT(b.message_prefix, 32769) ELSE b.message_prefix END, m.package_name,
       LEFT(m.package_path COLLATE Latin1_General_100_CI_AS_SC, 16385),
       LEFT(m.execution_path COLLATE Latin1_General_100_CI_AS_SC, 16385),
       m.message_source_name, m.subcomponent_name
FROM #event_page AS p JOIN catalog.event_messages AS m
    ON m.operation_id = @execution_id AND m.event_message_id = p.event_id
CROSS APPLY (SELECT LEFT(m.message COLLATE Latin1_General_100_BIN2, 32770) AS message_prefix) AS b;

DECLARE @unidentified bit;
SET @sql = N'SELECT @has = CONVERT(bit, CASE WHEN EXISTS (SELECT 1' + @filter
    + N' AND m.event_message_id IS NULL) THEN 1 ELSE 0 END);';
EXEC sys.sp_executesql @sql, N'@execution_id bigint, @q nvarchar(2050), @has bit OUTPUT',
    @execution_id = @execution_id, @q = @q, @has = @unidentified OUTPUT;

-- Retention exhausts a visible page; revoked execution visibility returns no
-- rows. The marker never becomes an invented event in the public collection.
SELECT CASE WHEN r.event_id IS NULL THEN 1 ELSE 0 END AS page_empty,
       visible.execution_id, r.*, @unidentified AS has_unidentified_events
FROM catalog.executions AS visible LEFT JOIN @event_rows AS r ON 1 = 1
WHERE visible.execution_id = @execution_id
ORDER BY CASE WHEN @by_time = 1 AND @descending = 0 THEN r.message_time END ASC,
         CASE WHEN @by_time = 1 AND @descending = 1 THEN r.message_time END DESC,
         CASE WHEN @descending = 0 THEN r.event_id END ASC,
         CASE WHEN @descending = 1 THEN r.event_id END DESC;
