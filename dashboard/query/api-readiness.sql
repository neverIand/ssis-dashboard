-- Compile a zero-row catalog read, independent of visible execution count. The read is compiled only
-- when the catalog view exists, so a connection to another database answers "not ready", not an error.
IF DB_NAME() = N'SSISDB' AND OBJECT_ID(N'catalog.executions', N'V') IS NOT NULL
    EXEC(N'SELECT ready = CAST(CASE WHEN COUNT_BIG(*) = 0 THEN 1 ELSE 0 END AS bit) FROM catalog.executions WHERE 1 = 0;');
ELSE
    SELECT ready = CAST(0 AS bit);
