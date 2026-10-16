SET NOCOUNT ON;
DECLARE @execution_id bigint = ?, @take int = ?, @upper bigint = ?, @last bigint = ?,
        @last_time datetimeoffset(7) = CONVERT(datetimeoffset(7), ?), @by_time bit = ?, @descending bit = ?;

IF NOT EXISTS (SELECT 1 FROM catalog.executions WHERE execution_id = @execution_id)
BEGIN
    SELECT CONVERT(int, NULL) AS page_empty WHERE 1 = 0;
    RETURN;
END;


-- Only IDs/time enter the bounded page; the candidate uses one of four fixed
-- orders. Values remain typed sp_executesql parameters, never SQL text.
CREATE TABLE #child_page (observation_id bigint NOT NULL PRIMARY KEY, started_at datetimeoffset(7) NOT NULL);
DECLARE @ceiling bigint = CASE WHEN @by_time=0 AND @descending=1 AND @last IS NOT NULL THEN @last-1 ELSE @upper END;
DECLARE @candidate_sql nvarchar(max)=N'
INSERT #child_page
SELECT TOP (@take) event_message_id,message_time FROM catalog.event_messages
WHERE operation_id=@execution_id AND event_name=N''OnPreExecute''
 AND package_path COLLATE Latin1_General_100_BIN2=N''\Package'' AND DATALENGTH(package_path)=16
 AND CHARINDEX(N''\'',execution_path,2)>0 AND event_message_id<=@ceiling'
 + CASE WHEN @by_time=0 THEN CASE WHEN @descending=0 THEN N' AND event_message_id>ISNULL(@last,CONVERT(bigint,0)) ORDER BY event_message_id ASC;'
      ELSE N' ORDER BY event_message_id DESC;' END
   WHEN @descending=0 THEN N' AND (@last IS NULL OR message_time>@last_time OR (message_time=@last_time AND event_message_id>@last)) ORDER BY message_time ASC,event_message_id ASC;'
   ELSE N' AND (@last IS NULL OR message_time<@last_time OR (message_time=@last_time AND event_message_id<@last)) ORDER BY message_time DESC,event_message_id DESC;' END;
EXEC sys.sp_executesql @candidate_sql,N'@execution_id bigint,@take int,@ceiling bigint,@last bigint,@last_time datetimeoffset(7)',
 @execution_id=@execution_id,@take=@take,@ceiling=@ceiling,@last=@last,@last_time=@last_time;
DECLARE @child_starts TABLE (
    observation_id bigint NOT NULL PRIMARY KEY, started_at datetimeoffset(7) NOT NULL,
    package_name nvarchar(260) COLLATE Latin1_General_100_BIN2 NULL,
    execution_path nvarchar(max) COLLATE Latin1_General_100_BIN2 NULL,
    source_id nvarchar(38) COLLATE Latin1_General_100_BIN2 NULL,
    source_name nvarchar(4000) NULL, source_type smallint NULL
);
INSERT @child_starts
SELECT p.observation_id, p.started_at, e.package_name, LEFT(e.execution_path, 32769),
       e.message_source_id, e.message_source_name, e.message_source_type
FROM #child_page AS p JOIN catalog.event_messages AS e
  ON e.operation_id = @execution_id AND e.event_message_id = p.observation_id;

-- Retention between the narrow selection and metadata read exhausts the page
-- rather than fabricating a start with missing path/source metadata.
DELETE p FROM #child_page AS p
WHERE NOT EXISTS (SELECT 1 FROM @child_starts AS s WHERE s.observation_id = p.observation_id);

-- Share pairing work across repeated starts on one exact identity. DATALENGTH
-- also distinguishes trailing spaces, which SQL equality alone would ignore.
DECLARE @child_keys TABLE (
    key_id bigint NOT NULL PRIMARY KEY, package_name nvarchar(260) COLLATE Latin1_General_100_BIN2 NOT NULL,
    execution_path nvarchar(max) COLLATE Latin1_General_100_BIN2 NOT NULL,
    source_id nvarchar(38) COLLATE Latin1_General_100_BIN2 NOT NULL, source_type smallint NULL
);
INSERT @child_keys
SELECT MIN(observation_id), package_name, execution_path, source_id, source_type
FROM @child_starts
WHERE package_name IS NOT NULL AND source_id IS NOT NULL
GROUP BY package_name, DATALENGTH(package_name), execution_path, DATALENGTH(execution_path),
         source_id, DATALENGTH(source_id), source_type;

DECLARE @child_ends TABLE (observation_id bigint NOT NULL PRIMARY KEY, ended_at datetimeoffset(7) NULL);
WITH keyed_events AS (
    SELECT k.key_id, e.event_message_id, e.event_name, e.message_time,
           MAX(CASE WHEN e.event_message_id IS NULL THEN 1 ELSE 0 END) OVER (PARTITION BY k.key_id) AS unidentified
    FROM catalog.event_messages AS e JOIN @child_keys AS k
      ON e.package_name COLLATE Latin1_General_100_BIN2 = k.package_name AND DATALENGTH(e.package_name) = DATALENGTH(k.package_name)
     AND e.execution_path COLLATE Latin1_General_100_BIN2 = k.execution_path AND DATALENGTH(e.execution_path) = DATALENGTH(k.execution_path)
     AND e.message_source_id COLLATE Latin1_General_100_BIN2 = k.source_id AND DATALENGTH(e.message_source_id) = DATALENGTH(k.source_id)
     AND (e.message_source_type = k.source_type OR (e.message_source_type IS NULL AND k.source_type IS NULL))
    WHERE e.operation_id = @execution_id AND e.event_name IN (N'OnPreExecute', N'OnPostExecute')
      AND e.package_path COLLATE Latin1_General_100_BIN2 = N'\Package' AND DATALENGTH(e.package_path) = 16
), adjacent_events AS (
    SELECT event_message_id, event_name, message_time, unidentified,
           LAG(event_name) OVER (PARTITION BY key_id ORDER BY event_message_id) AS previous_name,
           LEAD(event_name) OVER (PARTITION BY key_id ORDER BY event_message_id) AS next_name,
           LEAD(message_time) OVER (PARTITION BY key_id ORDER BY event_message_id) AS next_time
    FROM keyed_events WHERE event_message_id IS NOT NULL
)
INSERT @child_ends
SELECT e.event_message_id,
       -- Reject both starts in a consecutive-start ambiguity. Pairing starts
       -- and posts by independent row numbers would shift every later match
       -- after a missing end; choosing the next post could reuse another end.
       CASE WHEN e.unidentified = 0 AND (e.previous_name IS NULL OR e.previous_name <> N'OnPreExecute')
                  AND e.next_name = N'OnPostExecute' AND e.next_time >= e.message_time THEN e.next_time END
FROM adjacent_events AS e JOIN #child_page AS p ON p.observation_id = e.event_message_id;

DECLARE @unidentified bit = CASE WHEN EXISTS (
    SELECT 1 FROM catalog.event_messages
    WHERE operation_id = @execution_id AND event_name = N'OnPreExecute' AND event_message_id IS NULL
      AND package_path COLLATE Latin1_General_100_BIN2 = N'\Package' AND DATALENGTH(package_path) = 16
      AND CHARINDEX(N'\', execution_path, 2) > 0
) THEN 1 ELSE 0 END;

-- End events can arrive above the start ceiling. Observations stay live;
-- completion means an observed pair, never an inferred execution result.
SELECT CASE WHEN p.observation_id IS NULL THEN 1 ELSE 0 END AS page_empty,
       visible.execution_id, p.observation_id, s.package_name, N'\Package' AS package_path,
       s.execution_path, s.source_name, s.source_type, p.started_at, e.ended_at,
       @unidentified AS has_unidentified_starts
FROM catalog.executions AS visible
LEFT JOIN #child_page AS p ON 1 = 1
LEFT JOIN @child_starts AS s ON s.observation_id = p.observation_id
LEFT JOIN @child_ends AS e ON e.observation_id = p.observation_id
WHERE visible.execution_id = @execution_id
ORDER BY CASE WHEN @by_time = 1 AND @descending = 0 THEN p.started_at END ASC,
         CASE WHEN @by_time = 1 AND @descending = 1 THEN p.started_at END DESC,
         CASE WHEN @descending = 0 THEN p.observation_id END ASC,
         CASE WHEN @descending = 1 THEN p.observation_id END DESC;
