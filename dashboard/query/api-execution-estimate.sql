SET NOCOUNT ON;
DECLARE @execution_id bigint = ?;

-- History's estimate (API_CONTRACT "History and estimates") for one execution: the mean of at most
-- five visible successes of its exact identity, other than itself, that ended by its start. The
-- caller runs this only while the execution is active. Reading the target through the public view
-- rechecks visibility; no row means it is no longer visible. The catalog has no name or end-time
-- index, so the TOP (5) reads every visible execution once and sorts only five.
SELECT t.execution_id, t.start_time AS started_at, estimate.estimate_sample_count, estimate.estimate_total_ticks
FROM catalog.executions AS t
OUTER APPLY (
    -- Decimal totals and split seconds/fractions avoid BIGINT and DATEDIFF_BIG(nanosecond) overflow.
    SELECT COUNT_BIG(*) AS estimate_sample_count,
           SUM(CONVERT(decimal(38, 0), DATEDIFF_BIG(second, s.start_time, s.end_time)) * 10000000
               + (DATEPART(nanosecond, s.end_time) - DATEPART(nanosecond, s.start_time)) / 100) AS estimate_total_ticks
    FROM (
        SELECT TOP (5) e.start_time, e.end_time
        FROM catalog.executions AS e
        WHERE e.folder_name = t.folder_name AND e.project_name = t.project_name AND e.package_name = t.package_name
          AND e.status = 7 AND e.start_time IS NOT NULL
          AND e.end_time >= e.start_time AND e.end_time <= t.start_time
          AND e.execution_id <> t.execution_id
        ORDER BY e.end_time DESC, e.execution_id DESC
    ) AS s
) AS estimate
WHERE t.execution_id = @execution_id;
