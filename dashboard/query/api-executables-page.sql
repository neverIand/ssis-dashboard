SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_time datetimeoffset(7) = CONVERT(datetimeoffset(7), ?), @last_null bit = ?,
        @by_time bit = ?, @descending bit = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(int, NULL) AS page_empty WHERE 1 = 0;
    RETURN;
END;

-- Copy only the bounded candidate page; paths and executable metadata follow.
DECLARE @executable_page TABLE (
    statistics_id bigint NOT NULL, executable_id bigint NOT NULL,
    start_time datetimeoffset(7) NULL, end_time datetimeoffset(7) NULL, execution_result smallint NULL
);

-- Fixed orders keep ID range seeks usable in cached plans. CASE-based ordering
-- across both sort keys would sort/read the whole scope even for an ID page.
IF @by_time = 0
BEGIN
    IF @descending = 0
        INSERT @executable_page
        SELECT TOP (@take) s.statistics_id, s.executable_id, s.start_time, s.end_time, s.execution_result
        FROM catalog.executable_statistics AS s
        WHERE s.execution_id = @execution_id AND s.statistics_id <= @upper AND s.statistics_id > ISNULL(@last, CONVERT(bigint, 0))
        ORDER BY s.statistics_id ASC;
    ELSE
        INSERT @executable_page
        SELECT TOP (@take) s.statistics_id, s.executable_id, s.start_time, s.end_time, s.execution_result
        FROM catalog.executable_statistics AS s
        -- One clamped upper boundary keeps descending continuation a range seek.
        WHERE s.execution_id = @execution_id
          AND s.statistics_id <= CASE WHEN @last IS NULL OR @last > @upper THEN @upper ELSE @last - 1 END
        ORDER BY s.statistics_id DESC;
END
ELSE
BEGIN
    IF @descending = 0
        INSERT @executable_page
        SELECT TOP (@take) s.statistics_id, s.executable_id, s.start_time, s.end_time, s.execution_result
        FROM catalog.executable_statistics AS s
        WHERE s.execution_id = @execution_id AND s.statistics_id <= @upper
          AND (@last IS NULL OR (@last_null = 0 AND (s.start_time IS NULL OR s.start_time > @last_time))
               OR (((@last_null = 1 AND s.start_time IS NULL) OR s.start_time = @last_time) AND s.statistics_id > @last))
        ORDER BY CASE WHEN s.start_time IS NULL THEN 1 ELSE 0 END ASC, s.start_time ASC, s.statistics_id ASC;
    ELSE
        INSERT @executable_page
        SELECT TOP (@take) s.statistics_id, s.executable_id, s.start_time, s.end_time, s.execution_result
        FROM catalog.executable_statistics AS s
        WHERE s.execution_id = @execution_id AND s.statistics_id <= @upper
          AND (@last IS NULL OR (@last_null = 0 AND (s.start_time IS NULL OR s.start_time < @last_time))
               OR (((@last_null = 1 AND s.start_time IS NULL) OR s.start_time = @last_time) AND s.statistics_id < @last))
        ORDER BY CASE WHEN s.start_time IS NULL THEN 1 ELSE 0 END ASC, s.start_time DESC, s.statistics_id DESC;
END;

-- Fetch metadata once per selected executable. Inlining these public views can
-- repeat their underlying statistics scans for every observation in the page.
-- Twice the path character cap plus one preserves all valid supplementary
-- characters under both SC/non-SC collations, yet bounds oversized projections.
DECLARE @executable_metadata TABLE (
    executable_id bigint NOT NULL PRIMARY KEY, package_name nvarchar(260) NULL,
    package_path nvarchar(max) NULL, name nvarchar(4000) NULL
);
INSERT @executable_metadata
SELECT e.executable_id, e.package_name, LEFT(e.package_path, 32769), e.executable_name
FROM catalog.executables AS e
WHERE e.execution_id = @execution_id
  AND EXISTS (SELECT 1 FROM @executable_page AS p WHERE p.executable_id = e.executable_id);

-- A visible execution with an exhausted/empty page returns one internal marker;
-- no visible execution returns no rows, including revocation between queries.
SELECT CASE WHEN p.statistics_id IS NULL THEN 1 ELSE 0 END AS page_empty,
       p.statistics_id, visible.execution_id, p.executable_id,
       e.package_name, e.package_path,
       LEFT(s.execution_path, 32769) AS execution_path, e.name AS name,
       p.start_time AS started_at, p.end_time AS ended_at, p.execution_result
FROM catalog.executions AS visible
LEFT JOIN @executable_page AS p ON 1 = 1
LEFT JOIN catalog.executable_statistics AS s
    ON s.execution_id = visible.execution_id AND s.statistics_id = p.statistics_id
LEFT JOIN @executable_metadata AS e ON e.executable_id = p.executable_id
WHERE visible.execution_id = @execution_id
ORDER BY CASE WHEN @by_time = 1 AND p.start_time IS NULL THEN 1 ELSE 0 END ASC,
         CASE WHEN @by_time = 1 AND @descending = 0 THEN p.start_time END ASC,
         CASE WHEN @by_time = 1 AND @descending = 1 THEN p.start_time END DESC,
         CASE WHEN @descending = 0 THEN p.statistics_id END ASC,
         CASE WHEN @descending = 1 THEN p.statistics_id END DESC;
