-- Connection-local sources only; never create or change catalog objects.
SET NOCOUNT ON;
CREATE TABLE #sample_executions (
    execution_id bigint PRIMARY KEY, folder_name nvarchar(128) COLLATE DATABASE_DEFAULT,
    project_name nvarchar(128) COLLATE DATABASE_DEFAULT, package_name nvarchar(260) COLLATE DATABASE_DEFAULT,
    project_lsn bigint, environment_folder_name nvarchar(128) COLLATE DATABASE_DEFAULT,
    environment_name nvarchar(128) COLLATE DATABASE_DEFAULT, status int,
    created_time datetimeoffset(7), start_time datetimeoffset(7), end_time datetimeoffset(7));
CREATE TABLE #sample_events (operation_id bigint, event_name nvarchar(1024) COLLATE DATABASE_DEFAULT);
CREATE TABLE #sample_parameters (execution_id bigint, object_type smallint,
    parameter_name nvarchar(128) COLLATE DATABASE_DEFAULT, parameter_value sql_variant);
WITH digits(n) AS (SELECT n FROM (VALUES(0),(1),(2),(3),(4),(5),(6),(7),(8),(9)) d(n)),
numbers(n) AS (SELECT 1 + a.n + 10*b.n + 100*c.n FROM digits a CROSS JOIN digits b CROSS JOIN digits c)
INSERT #sample_executions
SELECT n, N'F'+CONVERT(nvarchar(1),n%2), N'P'+CONVERT(nvarchar(1),n%3),
       REPLICATE(N'界',253)+RIGHT(N'00'+CONVERT(nvarchar(2),n%13),2)+N'.dtsx',
       9007199254740991+CONVERT(bigint,n),
       CASE WHEN n%5<>0 THEN N'Env'+CONVERT(nvarchar(1),n%3) END,
       CASE WHEN n%7<>0 THEN REPLICATE(N'界',127)+CONVERT(nvarchar(1),n%2) END,
       1+n%9, DATEADD(nanosecond,(n%7)*100,CONVERT(datetimeoffset(7),'2026-10-01T00:00:00Z')),
       CASE WHEN n%9<>0 THEN CONVERT(datetimeoffset(7),'2026-10-01T05:45:00+05:45') END,
       CASE WHEN n%9 NOT IN(0,1) THEN DATEADD(nanosecond,(n%11)*100,CONVERT(datetimeoffset(7),'2026-10-01T00:00:00Z')) END
FROM numbers WHERE n<=257;
UPDATE #sample_executions SET start_time='0001-01-01T00:00:00Z',
    end_time=CASE execution_id WHEN 255 THEN '9000-01-01T00:00:00.0000000Z'
                             ELSE '9000-01-01T00:00:00.0000001Z' END
WHERE execution_id IN(255,256);
INSERT #sample_events
SELECT execution_id,N'OnWarning' FROM #sample_executions
CROSS JOIN (VALUES(1),(2),(3),(4),(5)) n(n) WHERE execution_id%6>=n.n;
INSERT #sample_events
SELECT execution_id,N'OnError' FROM #sample_executions
CROSS JOIN (VALUES(1),(2),(3)) n(n) WHERE execution_id%4>=n.n;
INSERT #sample_events SELECT execution_id,N'OnInformation' FROM #sample_executions;
INSERT #sample_parameters
SELECT execution_id,50,N'LOGGING_LEVEL',CONVERT(sql_variant,CONVERT(int,execution_id%5))
FROM #sample_executions WHERE execution_id%11<>0;
-- Same-name user strings must never be converted to the system logging code.
INSERT #sample_parameters SELECT execution_id,30,N'LOGGING_LEVEL',CONVERT(sql_variant,N'not an integer')
FROM #sample_executions;
INSERT #sample_executions VALUES
 (9007199254740993,N'Outside',N'P0',N'Outside.dtsx',NULL,NULL,NULL,7,'2026-10-02T00:00:00Z',NULL,NULL);
