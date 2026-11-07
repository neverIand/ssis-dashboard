SET NOCOUNT ON;
DECLARE @after bigint = CONVERT(bigint, ?),
        @limit int = CONVERT(int, ?),
        @tracked xml = CONVERT(xml, ?);

-- Tracked IDs: active executions and unresolved ID gaps, capped by the caller. XML also works
-- before SQL 2016.
DECLARE @ids TABLE (execution_id bigint NOT NULL PRIMARY KEY);
INSERT @ids (execution_id)
SELECT DISTINCT ids.i.value('.', 'bigint')
FROM @tracked.nodes('/t/i') AS ids(i);

-- The next operation IDs above the high-water mark, at most @limit + 1. Executions are a subset of
-- operations, so a run of deployments or validations is read once and the mark moves past it.
DECLARE @window TABLE (operation_id bigint NOT NULL PRIMARY KEY);
INSERT @window (operation_id)
SELECT TOP (@limit + 1) o.operation_id
FROM catalog.operations AS o
WHERE o.operation_id > @after
ORDER BY o.operation_id;

-- Source 2: the window's operation IDs. Source 0: executions in that window.
-- Source 1: tracked IDs at or below the mark. Each listed ID is one keyed lookup (TOP (1) per ID),
-- so the work stays proportional to the lists, not to the catalog, whatever plan is chosen.
SELECT CONVERT(tinyint, 2) AS source, w.operation_id AS execution_id,
       CONVERT(int, NULL) AS status, CONVERT(datetimeoffset(7), NULL) AS end_time
FROM @window AS w
UNION ALL
SELECT CONVERT(tinyint, 0), x.execution_id, x.status, x.end_time
FROM @window AS w
CROSS APPLY (
    SELECT TOP (1) e.execution_id, e.status, e.end_time
    FROM catalog.executions AS e
    WHERE e.execution_id = w.operation_id
) AS x
UNION ALL
SELECT CONVERT(tinyint, 1), x.execution_id, x.status, x.end_time
FROM @ids AS t
CROSS APPLY (
    SELECT TOP (1) e.execution_id, e.status, e.end_time
    FROM catalog.executions AS e
    WHERE e.execution_id = t.execution_id
) AS x
WHERE t.execution_id <= @after;
