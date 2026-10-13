# Local SSISDB validation guide

Prepared against `dev-next` at `45bfb3c` on 13 October 2026. Use the [backend checklist](BACKEND_CHECKLIST.md) to record results; this guide explains how to obtain them. Preparing this guide does not pass any integration check.

You do **not** need to perform all 30 checks by hand. Install and populate the local test catalog, make the intended identities available, and do a short browser review. Most repeatable SQL, HTTP, logging and timing checks can then be run by an assistant or a script.

## Who can do what

The checklist's **Execution** column uses these labels. An automation label describes feasibility, not an already implemented integration runner or a passing result.

| Label | Meaning | Your part |
| --- | --- | --- |
| **NOW** | Database-free automation; existing tests and local runtime/configuration probes. | Provide the Windows environment when validating that specific host. SSISDB is unnecessary. |
| **DB** | Can be automated or run by an assistant after catalog access and representative fixtures exist. | Provide the local setup and private configuration. |
| **MIXED** | Repeatable assertions can be automated; setup, visual judgment or local/admin access is also needed. | Create/approve fixtures and identities, inspect the browser, or provide the required host access. |
| **LATER** | Depends on B5c's chosen hosting implementation. | Choose/setup that host when B5c is implemented. |

There are **6 NOW, 10 DB, 11 MIXED and 3 LATER** cases. The current database-free suite has 101 tests at the reviewed commit. The native integration checks are not yet a one-command suite.

**Access matters:** installing SSISDB on your PC does not give this remote chat access to your `localhost`, Windows identity or browser. I can execute the local checks when the coding environment runs on that machine, or has an explicitly configured connection to the test environment. Otherwise, I can prepare commands for you to run and interpret their sanitized output. No public database exposure or credential sharing in chat is needed.

## 1. Prepare a small, useful catalog

This guide starts after SQL Server, the SSIS runtime and the SSISDB catalog are installed. Confirm in SSMS that the **Database Engine** connection contains **Integration Services Catalogs > SSISDB**, and that a deployed project can actually execute. Merely creating the catalog does not verify the SSIS execution runtime.

Use a dedicated test project that has no production dependencies. In SSMS, expand its **Projects > Packages**, right-click a package and choose **Execute**. Use **Advanced > Logging level: Verbose** for the small fixture runs so that executable/child/event checks have evidence. Inspect the execution report after each run. Verbose logging is a fixture choice, not a recommendation for every production execution.

Prepare these examples, reusing one execution for several checks where possible:

| Fixture | How to prepare it | Why it is needed |
| --- | --- | --- |
| Success and history | Execute one harmless package at least six times. Give runs a small nonzero duration, such as a two-second wait. | Overview, durations and the legacy moving-average/history chart. |
| Failure | A separate test package/task deliberately fails with a harmless message. | Failed status, errors, safe display and event counts. |
| Running/incomplete | Start a bounded test package that waits about 60 seconds; open the dashboard while it runs. Repeat when needed. | Running status, NULL end times and unfinished tasks. |
| Parent and child | Execute a parent containing an Execute Package Task; include repeated/parallel child calls if available. | Child paths, matching start/end events and incomplete children. |
| Values and text | Add dummy string/numeric/boolean parameters, a runtime override, and a harmless property override where supported. Include Unicode and a quote in a supported name/message. | Values/flags, encoding, escaping and bound filters. |
| Sensitive parameter | Give a parameter a unique dummy value and mark it sensitive. Do not put that value in a package message. | Confirm the catalog masks it and the dashboard does not reveal it. |
| Visibility pair | Keep two executions visible to the normal monitoring identity; arrange for a restricted identity to see just one. | Hidden versus absent execution behavior. |

If a warning category has no representative events, check its empty state but leave its populated-data assertion **NOT RUN**. Do not manufacture a real low-memory condition to exercise memory warnings. Keep unavailable child/override/history cases open too.

Find the execution IDs in SSMS under the intended monitoring identity:

```sql
USE SSISDB;
SELECT DB_NAME() AS catalog_name, SUSER_SNAME() AS current_identity;
SELECT TOP (50)
    execution_id, folder_name, project_name, package_name,
    status, created_time, start_time, end_time
FROM catalog.executions
ORDER BY execution_id DESC;
```

Save the IDs privately with aliases such as `success`, `failed`, `running`, `parent`, `hidden`. Status `2` is running, `4` failed and `7` succeeded. Child packages invoked by Execute Package Task share the parent's execution instance; do not expect a separate catalog execution ID for every child. See Microsoft's [execution view](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-executions-ssisdb-database) and [logging levels](https://learn.microsoft.com/en-us/sql/integration-services/system-stored-procedures/catalog-set-execution-parameter-value-ssisdb-database).

## 2. Verify Windows, Python and configuration

**Covers ENV-01, ENV-02, CFG-01, CFG-02.** Run PowerShell from your existing repository checkout. Substitute its actual path. Use a clean checkout of the commit you intend to validate and record that commit; do not discard unrelated local work.

```powershell
$repo = 'C:\src\ssis-dashboard'
Set-Location $repo
git status --short --branch
git rev-parse HEAD
py -3.14 -m venv .local\validation-venv314
$pythonExe = (Resolve-Path '.local\validation-venv314\Scripts\python.exe').Path
$evidenceDir = Join-Path $repo '.local\backend-validation'
New-Item -ItemType Directory -Force $evidenceDir | Out-Null
& $pythonExe -m pip install -r requirements.txt
& $pythonExe -m pip check
& $pythonExe -c "import sys,struct,pyodbc; print(sys.version); print('bits:',struct.calcsize('P')*8); print('GIL:',sys._is_gil_enabled()); print('drivers:',pyodbc.drivers())"
& $pythonExe -m pip freeze
& $pythonExe -m unittest discover -s tests -q
```

If an environment with that name already exists, reuse it only after checking its interpreter; otherwise choose a new name. Expect standard CPython 3.14 with the intended architecture, GIL enabled, the eight runtime versions in `constraints.txt`, no broken requirements, and all tests passing. An installed SQL Server ODBC driver must appear under the **same interpreter architecture**. The probe in step 3 records the driver actually loaded by a successful connection. Stop and resolve failed setup/tests before interpreting UI results.

Create `.local/backend-validation/dashboard.cfg` locally. Example using Windows authentication:

```python
DEBUG = False
TESTING = False
PROPAGATE_EXCEPTIONS = False
LOG_LEVEL = 'INFO'
CONNECTION_STRING = {
    'main': (
        'DRIVER={ODBC Driver 18 for SQL Server};'
        'SERVER=YOUR_TEST_SERVER_OR_INSTANCE;DATABASE=SSISDB;'
        'Trusted_Connection=yes;Encrypt=yes;TrustServerCertificate=no;'
        'APP=SSISDashboardValidation;'
    )
}
DB_LOGIN_TIMEOUT_SECONDS = 5
DB_QUERY_TIMEOUT_SECONDS = 30
HOUR_SPAN = 24
EXECUTION_COUNT = 50
AS_OF_DATE = 'NOW'
```

Use the exact driver name you installed; Driver 17 can also be tested. Windows authentication uses the account running Python, not the browser's account. For a self-signed certificate in an isolated local lab, `TrustServerCertificate=yes` is an explicit local exception that skips certificate verification; record it. Otherwise configure a trusted certificate and keep `no`. Driver 18's encryption behavior is documented in Microsoft's [connection attributes](https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute). Keep any SQL-authentication credentials exclusively in the private file.

```powershell
$env:DASHBOARD_CONFIG = (Resolve-Path "$evidenceDir\dashboard.cfg").Path
& $pythonExe -m flask --app dashboard:create_app routes
# Confirm the absolute config also works from another directory.
Push-Location $env:TEMP
try {
    & $pythonExe -m flask --app "$repo/dashboard:create_app" routes
} finally {
    Pop-Location
}
```

For **CFG-01**, compare the selected config values in the two factory invocations using a small local probe; report only whether they match, without printing the connection string. This can be automated without a database. Once SSISDB is ready, also repeat a server startup from the other directory using that explicit app path and the launch options in step 4, after stopping the first server. Confirm the same catalog/window and restore the original working directory. Route discovery alone proves import/config loading, not database selection.

For **CFG-02**, copy the private config to `invalid.cfg`, select that absolute path, and change **one setting at a time**: each timeout to `0`, `'5'`, and `True`, then `LOG_LEVEL` to an unsupported string. Run `routes` after each change. It should exit unsuccessfully naming the invalid setting without echoing the value, before any connection attempt. Restore the original selector. The existing tests automate these validation rules; replay confirms your launch environment.

## 3. Confirm native connection and value handling

**Covers ENV-02, DB-01, DB-03; also supplies the direct probe for HTTP-05.** Save this optional helper as `.local/backend-validation/native-probe.py`. It performs only a small read or a bounded wait and closes both resources. It reports safe metadata rather than driver diagnostic text.

```python
import re
import sys
from time import perf_counter
import pyodbc
from dashboard import create_app

mode = sys.argv[1]  # connect or timeout
connection = cursor = None
started = None
failed = False

def sqlstate(error):
    value = error.args[0] if error.args else None
    return value if isinstance(value, str) and re.fullmatch(r'[A-Z0-9]{5}', value) else 'unknown'

try:
    if mode not in ('connect', 'timeout'):
        raise ValueError('Unsupported probe mode')
    app = create_app()
    connection = pyodbc.connect(
        app.config['CONNECTION_STRING']['main'],
        timeout=app.config['DB_LOGIN_TIMEOUT_SECONDS'],
    )
    connection.timeout = app.config['DB_QUERY_TIMEOUT_SECONDS']
    cursor = connection.cursor()
    assert cursor.execute('SELECT DB_NAME()').fetchone()[0] == 'SSISDB'
    if mode == 'connect':
        print('driver:', connection.getinfo(pyodbc.SQL_DRIVER_NAME))
        print('driver version:', connection.getinfo(pyodbc.SQL_DRIVER_VER))
        print('server version:', connection.getinfo(pyodbc.SQL_DBMS_VER))
        row = cursor.execute(
            "SELECT CAST(? AS bigint), CAST(? AS nvarchar(40)), "
            "CAST(NULL AS datetime2), CAST(1.25 AS decimal(10,2)), "
            "CAST(1 AS bit), CAST(SYSDATETIME() AS datetime2)",
            9223372036854775807, 'Gr\u00fc\u00dfe \u6771\u4eac',
        ).fetchone()
        assert row[0] == 9223372036854775807
        assert row[1] == 'Gr\u00fc\u00dfe \u6771\u4eac' and row[2] is None
        print('probe value types:', [type(value).__name__ for value in row])
    else:
        cursor.close()
        cursor = None
        connection.timeout = 1
        cursor = connection.cursor()
        started = perf_counter()
        cursor.execute("WAITFOR DELAY '00:00:05'")
        print('FAIL: delay returned without a timeout')
        failed = True
except Exception as error:
    state = sqlstate(error)
    expected = mode == 'timeout' and started is not None and state in ('HYT00', 'HYT01')
    print('timeout observed' if expected else 'FAIL', 'SQLSTATE:', state)
    failed = not expected
finally:
    if started is not None:
        print('query elapsed seconds:', round(perf_counter() - started, 3))
    for resource in (cursor, connection):
        if resource is not None:
            try:
                resource.close()
            except Exception as error:
                print('FAIL: cleanup SQLSTATE:', sqlstate(error))
                failed = True
sys.exit(1 if failed else 0)
```

Run it from `$repo` through standard input so the application package is importable:

```powershell
Get-Content -Raw -Encoding UTF8 "$evidenceDir\native-probe.py" | & $pythonExe - connect
```

This is a native driver sanity check, not full catalog parity. For DB-03, additionally compare real rows through the pages in step 4: Unicode names/messages, timestamps, NULL end times, flags, durations and large identifiers. Current SQL formats many timestamps and casts parameter/override values to text. Verify that actual contract; a rendered string is not proof of native `datetimeoffset` or `sql_variant` conversion. Record any additional raw-type probe separately rather than silently converting away a driver failure.

## 4. Walk the pages once

**Covers DB-01 and UI-01 through UI-06.** Keep the original good config selected. In the first PowerShell window, run:

```powershell
Set-Location $repo
& $pythonExe -m flask --app dashboard:create_app run --host=127.0.0.1 --port=5000 --no-debug --no-reload --no-debugger 2>&1 | Tee-Object -FilePath "$evidenceDir\server.log"
```

Open `http://127.0.0.1:5000/`. In browser developer tools, use **Network**, select the main **document** request, and copy **Response Headers > X-Request-ID**. Use **Console** to look for JavaScript failures. Refresh after an execution changes status; live updates are a later milestone. Keep screenshots and the log private.

| Check | What to do in the browser | Pass evidence | Logical queries |
| --- | --- | --- | --- |
| UI-01 | Open overview, choose a folder/project, then succeeded and failed status filters. | Header, menu, cards, chart and rows render; links work and the selected scope is understandable. Compare each dataset with its SQL, not just with another widget. | 6 |
| UI-02 | Open `/execution/ID` for success, failure, parent and running fixtures. | Correct identity/version, executable and child rows, event counts and readable durations. Missing end times do not break rendering. | 7 |
| UI-03 | Open `/execution/ID/events/all`, then replace `all` with `errors`, `warnings`, `duplicate-warnings`, `memory-warnings`. | Each category renders; messages and paths agree with SQL. Harmless text such as `<b>fixture</b>` displays as text rather than injected HTML. | 4 each |
| UI-04 | Open `/execution/ID/values`. | Parameter and property-override sections, Set/Override flags and dummy values match SQL. A sensitive parameter's dummy value is absent from response HTML as well as the screen. | 5 |
| UI-05 | Follow the history link for the repeated package. Compare with the direct history route if that link fails. | Table and chart render; averages/estimates agree with the current query. Save a broken-link or estimate discrepancy for follow-up. | 2 |
| UI-06 | Use the Unicode/quote-containing fixture; try `*` in a name filter. Open an execution older than the overview window. | Names remain readable; filters behave as the legacy SQL specifies; an older visible execution still opens with its own event counts. | Per page above |

Use actual IDs, not the literal `ID`. The direct history route is `/history/FOLDER/project/PROJECT/status/all/package/PACKAGE`; percent-encode each name segment. Overview history links inherit the current folder/project filters. From an unfiltered overview, that can include identically named packages in multiple projects; compare with the exact folder/project route and record the scope difference. For the older-execution check, reuse an existing fixture outside the configured window; if none exists yet, leave that subcase NOT RUN instead of editing catalog timestamps.

Microsoft documents sensitive `execution_parameter_values.parameter_value` as NULL. This catalog protection does not finish the planned API authorization/redaction work. See the [parameter view](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-execution-parameter-values-ssisdb-database).

An assistant can automate HTTP status, HTML contents, links, counts and SQL comparisons. Browser automation is also possible with access to that browser. The remaining human judgment is whether the actual charts, tables, text and interactions are clear and usable on your display.

## 5. Check SQL parity and visibility

**Covers DB-02, DB-03, UI-07 and the hidden-row part of HTTP-02.**

For SQL parity, use the same database identity, fixture IDs, `HOUR_SPAN`, `AS_OF_DATE`, list limit and name/status filters as the app. Prefer completed executions in a quiet test catalog; new executions can change results between queries. A fixed `AS_OF_DATE` alone does not freeze SQL that lacks an upper bound.

Open the matching resource under `dashboard/query/` in SSMS. In a **private copy**, replace its positional `?` declarations with typed local variables. Preserve the query body. `dashboard/ssis.py` gives parameter order; use these common mappings:

| SQL resource | Parameters in order |
| --- | --- |
| `engine-kpi.sql` | Hours, as-of date, folder pattern, project pattern |
| `executions-statistics.sql` | Hours, as-of date, folder pattern, project pattern, numeric status |
| `package-list.sql` | Hours, as-of date, folder pattern, project pattern, numeric status, row limit |
| `package-kpi.sql` | Hours, as-of date, folder pattern, project pattern, execution ID |
| `package-history.sql` | Folder pattern, project pattern, package pattern |
| `package-info.sql`, executables, children, event and value resources | Execution ID |

`all` names become SQL `%`; `*` becomes `%`; status `all` becomes `0`. Explicit execution KPI calls use `%` for both name patterns. In SQL literals double any embedded quote; an automated probe should retain bound parameters instead. Compare execution IDs/order, event IDs/counts, field values and chart points, retaining the query/settings privately. For plans, use SSMS's actual execution plan on these same small read-only queries under an authorized identity; if plan permissions are unavailable, leave that evidence NOT RUN.

Do not require every widget to have the same count: cards use `start_time`, the list uses `created_time`, and daily chart buckets have their own boundaries. History ignores the validated status segment and currently selects running/succeeded executions with a fixed limit and legacy average/estimate formula. Literal `%`/`_`, names over the SQL variable lengths and names equal to `all` also need baseline notes. The [known-semantics section](BACKEND_CHECKLIST.md#known-semantics-and-open-gates) records these unfinished contracts.

For visibility:

1. Have the catalog administrator create a restricted test identity. Do not give it `sysadmin` or `ssis_admin`, or let it create all the fixture executions: that defeats the test.
2. Under the normal identity, confirm both selected executions exist. Under the restricted identity, run `SELECT execution_id FROM catalog.executions WHERE execution_id IN (...)` and confirm exactly the intended one is visible.
3. Start the dashboard with that restricted connection identity. With Windows authentication this means running Python as that Windows identity; a different browser profile does not change SQL permissions.
4. The visible execution should open. The hidden execution's details, all-events and values URLs should each return 404 after exactly one successful zero-row lookup. Compare with a genuinely absent ID: same safe error body apart from its request ID, same status and no follow-up queries.

An administrator can grant READ on a selected operation using `catalog.grant_permission` with object type `4` and permission type `1`; configure navigation/object visibility as needed too. Use the [official permission procedure](https://learn.microsoft.com/en-us/sql/integration-services/system-stored-procedures/catalog-grant-permission-ssisdb-database) under its supported Windows-authenticated administrative context. Verify actual visibility after setup instead of assuming a grant produced the desired isolation. An SQL permission exception is a backend error, not automatically an HTTP 403.

## 6. Exercise safe failures and recovery

**Covers HTTP-01 through HTTP-06.** Use a second PowerShell window for requests. These examples use Windows `curl.exe`; `-D -` prints response headers and `-o NUL` discards the body. Use the browser to inspect the safe error page too. Match every response ID with step 7's events.

| Request | Expected status | Queries |
| --- | --- | --- |
| `GET /does-not-exist` or `/static/does-not-exist.txt` | 404 | 0 |
| `POST /` | 405, with `Allow` retained | 0 |
| `GET /folder/all/project/all/status/not-a-status` | 400 | 0 |
| `GET /execution/1/events/not-a-category` | 400, regardless of whether execution 1 exists | 0 |
| `GET /execution/0` or `/execution/9223372036854775808` | 400 | 0 |
| A verified absent/hidden valid ID's details/events/values URL | 404 | 1 successful lookup, 0 failures |

```powershell
curl.exe -sS --max-time 20 -D - -o NUL http://127.0.0.1:5000/does-not-exist
curl.exe -sS --max-time 20 -D - -o NUL -X POST http://127.0.0.1:5000/
curl.exe -sS --max-time 20 -D - -o NUL http://127.0.0.1:5000/execution/0
```

Errors should have `X-Request-ID`, `Cache-Control: no-store` and no raw exception/connection details. To test BIGINT binding, first confirm in SSMS that ID `9223372036854775807` is absent, then request it: expect 404 with one lookup, not overflow/400. The command's client timeout is not proof that server work was cancelled.

For each configuration-based negative case: **stop the server, copy/select a separate private config, change only the relevant setting, restart, make the request, stop it, restore the good config and restart**. Editing a config while this server is running does not reload it.

| Case | Controlled procedure | What to record |
| --- | --- | --- |
| HTTP-01 | Run the zero-query requests while using the missing-driver config below. | Their 400/404/405 behavior remains independent of database availability. |
| HTTP-03 | Confirm a made-up driver name is absent from `pyodbc.drivers()`; use it in a dummy connection string with dummy credential markers only. Open `/`. | Windows driver-manager IM002/IM003 maps to 503; one failed acquisition. No dummy credentials in HTML or application events. |
| HTTP-04 | Use a disposable denied test login, then a known unused endpoint on your own test instance/host, with login timeout 5 seconds. Avoid repeated attempts against a real account. | Actual SQLSTATE and elapsed time: `08*`/`28000` -> 503; `HYT00`/`HYT01` -> 504; other states -> safe 500. |
| HTTP-05, direct driver | With the good config, run the helper below once. | A query timeout near the requested one-second bound, SQLSTATE and elapsed time; both handles closed. A normal five-second completion means timeout enforcement failed. |
| HTTP-05, HTTP integration | Once a controlled slow catalog case is available, use a short query timeout and request the affected page. An assistant can prepare this case on the test environment. | Native timeout propagates through the real request as 504, with query/error/request events. The direct probe and synthetic tests do not pass this separate assertion. |
| HTTP-06 | After each failure restore the good config and load overview, details and values again. | Normal statuses/content/counts recover; inspect active work as in step 8. |

```powershell
Get-Content -Raw -Encoding UTF8 "$evidenceDir\native-probe.py" | & $pythonExe - timeout
Get-Content -Raw -Encoding UTF8 "$evidenceDir\native-probe.py" | & $pythonExe - connect
```

The helper uses pyodbc's [query timeout](https://github.com/mkleehammer/pyodbc/wiki/Connection#timeout) and SQL Server's [WAITFOR](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/waitfor-transact-sql). It does not impose a total HTTP deadline. Do not force catalog locks, change shared server settings or edit production query resources just to obtain a timeout. Leave the real HTTP case NOT RUN if no suitable local fixture is available.

## 7. Inspect logs, timing and overlapping requests

**Covers OBS-01 through OBS-05.** Search `server.log` for a document response's request ID. A successful overview should have six `query_completed` events and one `request_completed`. Query indices should run 1 through 6, the summary count should be 6 and failures 0. An absent execution should have one successful query with `rows=0`; a failed acquisition should have one failed query, a `database_error`, and one request summary.

In PowerShell you can extract only the JSON application events despite Flask's log prefix:

```powershell
$events = Get-Content "$evidenceDir\server.log" | ForEach-Object {
    $start = $_.IndexOf('{"')
    if ($start -ge 0) {
        try { $_.Substring($start) | ConvertFrom-Json -ErrorAction Stop } catch { }
    }
}
$requestId = 'COPY_RESPONSE_REQUEST_ID_HERE'
$events | Where-Object { $_.request_id -eq $requestId } | Format-List
```

For OBS-02, inspect resource basename, outcome, `duration_ms`, `rows`, `failure_stage` and `cleanup_failed` on query events. Database/unexpected-error events should include sanitized `exception_type` and at most eight `application_frames` with module/function/line. Do not induce a native cleanup failure just for completeness; existing tests cover simulated failures, and any unavailable native case stays NOT RUN.

For OBS-03, use distinct **dummy** markers in the missing-driver credentials, a query string and an `X-Request-ID` header. The returned request ID should be newly generated. Search the **application JSON events** and error HTML for those markers, raw SQL, exception text and credentials: none should appear. A dummy nonsensitive parameter may legitimately appear on the values page, but must not appear in application logs. Access logs can contain request URLs; inspect those separately and do not mistake application redaction for host log redaction. Keep debug/testing/propagation off during these checks.

For OBS-04, restart the app, request each representative page once, then repeat it five times. Record the first request and the median of the five warm requests, both total request and per-query durations. Restarting the app does not guarantee a cold SQL Server cache. Do not clear shared caches. Browser/network timing is separate; there is no established universal latency pass threshold yet. Capture the local baseline and investigate outliers with the matching read-only query plan.

For OBS-05, issue the overview and a details request from two clients at nearly the same time. An assistant can reliably coordinate this with two HTTP workers; two browser tabs may finish too quickly to overlap. Confirm actual overlap from timing, distinct IDs, independent counts of 6 and 7, and exactly one summary per document request. Then request another overview and confirm its counter starts again at 1. Static assets have their own request IDs and zero database queries.

## 8. Check resource cleanup; defer hosting checks

**Covers RES-01, RES-02 and HOST-01 through HOST-03.** From a separate authorized SSMS monitoring session, inspect the connection tag set in the example config:

```sql
SELECT s.session_id, s.status AS session_status,
       r.status AS request_status, r.command, r.total_elapsed_time,
       r.open_transaction_count
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_requests AS r ON r.session_id = s.session_id
WHERE s.program_name = N'SSISDashboardValidation';
```

Observe before, during and after repeated success, failure and timeout requests. Active work should settle instead of accumulating. Idle pooled SQL sessions can remain after logical connection closes; their mere presence is not a leak. A single after-the-fact snapshot cannot prove cancellation. Use the authorized monitoring identity for this; SQL Server 2022+ has specific `VIEW SERVER PERFORMANCE STATE` requirements for [request monitoring](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-views/sys-dm-exec-requests-transact-sql). Do not expand the dashboard identity's permissions just for this check.

Before stopping the server, identify its listener and process in a second PowerShell window:

```powershell
$listeners = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
$listeners | Select-Object LocalAddress, LocalPort, OwningProcess
foreach ($listener in $listeners) {
    Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" |
        Select-Object ProcessId, ParentProcessId, ExecutablePath, CommandLine
}
```

Note the owned process and any launcher/child relationship. Press Ctrl+C in the server window, verify those specific processes exit and its listener disappears, then restart with the good config and confirm a page works. A free port alone is insufficient. Do not stop unrelated Python processes. An assistant can automate this lifecycle when it starts and owns the server locally.

Leave **HOST-01/02/03 NOT RUN** until B5c defines a production launcher/service or container. Then repeat identity/driver/config checks under that service, exercise restart/outage/shutdown, and validate the actual access/authentication/proxy/transport/logging boundaries. Passing the loopback Flask development server does not pass those cases. Future API authorization and streaming behavior remain their own milestones.

## Record results and hand off

For each checklist ID, record **PASS / FAIL / NOT RUN / N/A**, tested commit/date, environment alias, evidence location and any incomplete subcase. An empty category or unavailable fixture does not pass its populated-data assertion. Keep native HTTP-timeout evidence separate from the direct timeout probe, and SQL parity separate from screenshots.

After setup, the useful handoff is:

- The commit, Python/ODBC/SQL Server versions and authentication mode.
- The **local path** to the private config and whether the assistant's runtime can access it and SQL Server.
- Private fixture aliases/IDs, available identities and any missing fixture categories.
- Sanitized failing case IDs, HTTP status/request ID, SQLSTATE and safe application events. Keep credentials, connection strings, catalog dumps and full host logs out of chat and tracked files.

I can then automate the applicable checks, diagnose failures, prepare fixes and update the checklist/progress record with actual evidence. Start with connection + overview + one execution; expand to the rest only after that first path works.
