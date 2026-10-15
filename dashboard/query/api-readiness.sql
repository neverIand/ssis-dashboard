-- Compile a zero-row catalog read, independent of visible execution count.
SELECT ready = CAST(CASE WHEN DB_NAME() = N'SSISDB' AND COUNT_BIG(*) = 0 THEN 1 ELSE 0 END AS bit)
FROM catalog.executions
WHERE 1 = 0;
