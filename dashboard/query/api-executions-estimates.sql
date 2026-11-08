SET NOCOUNT ON;
DECLARE @targets xml = CONVERT(xml, ?);

-- History's estimate (API_CONTRACT "History and estimates") for the active rows of one bounded list
-- page: at most the page limit of started, unfinished executions, sent as integer IDs by the caller.
-- The public view rechecks visibility; an ID it no longer returns gets no row and no estimate.
-- SELECT INTO keeps the catalog's name collation; a declared temporary column would take tempdb's,
-- and the name joins below would fail (error 468) wherever the two differ.
SELECT t.execution_id, t.folder_name, t.project_name, t.package_name, t.start_time AS started_at
INTO #estimate_targets
FROM (SELECT DISTINCT ids.i.value('.', 'bigint') AS execution_id FROM @targets.nodes('/t/i') AS ids(i)) AS i
JOIN catalog.executions AS t ON t.execution_id = i.execution_id
WHERE t.start_time IS NOT NULL;
CREATE UNIQUE CLUSTERED INDEX IX_estimate_target ON #estimate_targets (execution_id);

-- One scope per exact identity on the page; a small integer key avoids indexing long package names.
SELECT IDENTITY(int, 1, 1) AS scope_id, folder_name, project_name, package_name,
       MIN(started_at) AS earliest_start, MAX(started_at) AS latest_start
INTO #estimate_scopes
FROM #estimate_targets
GROUP BY folder_name, project_name, package_name;
CREATE UNIQUE CLUSTERED INDEX IX_estimate_scope ON #estimate_scopes (scope_id);

-- Read visible successes once across all scopes, as the pattern history page does. Keep each scope's
-- successes ending after its earliest target start, plus the six latest ending by then (one may be a
-- target itself). Every target starts no earlier than that floor, so no sampled success is skipped.
WITH candidates AS (
    SELECT g.scope_id, e.execution_id, e.start_time, e.end_time, g.earliest_start,
           ROW_NUMBER() OVER (
               PARTITION BY g.scope_id, CASE WHEN e.end_time <= g.earliest_start THEN 0 ELSE 1 END
               ORDER BY e.end_time DESC, e.execution_id DESC
           ) AS candidate_rank
    FROM catalog.executions AS e
    JOIN #estimate_scopes AS g
      ON e.folder_name = g.folder_name AND e.project_name = g.project_name AND e.package_name = g.package_name
    WHERE e.status = 7 AND e.start_time IS NOT NULL
      AND e.end_time >= e.start_time AND e.end_time <= g.latest_start
)
SELECT scope_id, execution_id, start_time, end_time
INTO #estimate_successes
FROM candidates
WHERE end_time > earliest_start OR candidate_rank <= 6;
CREATE UNIQUE CLUSTERED INDEX IX_estimate_success_end
    ON #estimate_successes (scope_id, end_time DESC, execution_id DESC);

-- Decimal totals avoid BIGINT overflow across five long durations; splitting whole seconds and
-- fractions also avoids DATEDIFF_BIG(nanosecond) overflow.
SELECT r.execution_id, r.started_at, estimate.estimate_sample_count, estimate.estimate_total_ticks
FROM #estimate_targets AS r
JOIN #estimate_scopes AS g
  ON g.folder_name = r.folder_name AND g.project_name = r.project_name AND g.package_name = r.package_name
OUTER APPLY (
    SELECT COUNT_BIG(*) AS estimate_sample_count,
           SUM(CONVERT(decimal(38, 0), DATEDIFF_BIG(second, s.start_time, s.end_time)) * 10000000
               + (DATEPART(nanosecond, s.end_time) - DATEPART(nanosecond, s.start_time)) / 100) AS estimate_total_ticks
    FROM (
        SELECT TOP (5) e.start_time, e.end_time
        FROM #estimate_successes AS e
        WHERE e.scope_id = g.scope_id AND e.execution_id <> r.execution_id AND e.end_time <= r.started_at
        ORDER BY e.end_time DESC, e.execution_id DESC
    ) AS s
) AS estimate
ORDER BY r.execution_id;
