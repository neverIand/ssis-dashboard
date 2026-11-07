SET NOCOUNT ON;
DECLARE @active_limit int = CONVERT(int, ?),
        @window int = CONVERT(int, ?),
        @carried xml = CONVERT(xml, ?);

-- Change-detection baseline, read at start, after a resync and while the state is incomplete; never
-- on an ordinary poll. Execution IDs are operation IDs (deployments and validations share the
-- sequence), so the high-water mark is the highest visible operation ID. Every later read is bounded
-- by it: rows that commit above it while the seed runs are left to the first poll.
DECLARE @high bigint = (SELECT MAX(o.operation_id) FROM catalog.operations AS o);

-- Unexpired ID gaps carried over from the previous state, capped by the caller.
DECLARE @carry TABLE (operation_id bigint NOT NULL PRIMARY KEY);
INSERT @carry (operation_id)
SELECT DISTINCT ids.i.value('.', 'bigint')
FROM @carried.nodes('/t/i') AS ids(i);

-- Committed operation IDs among the newest @window IDs, and carried gaps below that range that have
-- committed (one keyed lookup each). Read in its own statement before the active executions, so an
-- execution that commits between the two reads is a gap that the active read then also returns; one
-- that commits after both is still a gap. None is missed by both.
DECLARE @present TABLE (operation_id bigint NOT NULL PRIMARY KEY);
INSERT @present (operation_id)
SELECT o.operation_id
FROM catalog.operations AS o
WHERE o.operation_id > @high - @window AND o.operation_id <= @high;
INSERT @present (operation_id)
SELECT x.operation_id
FROM @carry AS c
CROSS APPLY (
    SELECT TOP (1) o.operation_id
    FROM catalog.operations AS o
    WHERE o.operation_id = c.operation_id
) AS x
WHERE c.operation_id <= @high - @window;

-- Source 0: the high-water operation ID (NULL for an empty catalog).
-- Source 1: the newest active executions (created, running, pending, stopping) at or below it, at
--           most @active_limit + 1 so an over-limit set is visible. No status index exists, so this
--           reads every execution up to the mark.
-- Source 2: the committed IDs read above; any ID missing there is still a gap unless it is active.
SELECT CONVERT(tinyint, 0) AS source, @high AS execution_id,
       CONVERT(int, NULL) AS status, CONVERT(datetimeoffset(7), NULL) AS end_time
UNION ALL
SELECT a.source, a.execution_id, a.status, a.end_time
FROM (
    SELECT TOP (@active_limit + 1) CONVERT(tinyint, 1) AS source, e.execution_id, e.status, e.end_time
    FROM catalog.executions AS e
    WHERE e.status IN (1, 2, 5, 8) AND e.execution_id <= @high
    ORDER BY e.execution_id DESC
) AS a
UNION ALL
SELECT CONVERT(tinyint, 2), p.operation_id, CONVERT(int, NULL), CONVERT(datetimeoffset(7), NULL)
FROM @present AS p;
