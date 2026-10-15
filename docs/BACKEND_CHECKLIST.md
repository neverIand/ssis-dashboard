# Backend validation

Updated: 15 October 2026. Development base: `dev-next`. This is the single checklist, runbook and result record for backend validation. [Implementation progress](PROGRESS.md) records delivery milestones; [the SSIS fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md) contains package creation and reader-permission instructions.

## Current status and next step

The completed local runs now fully pass **25 of 30 cases**. **OBS-02** retains the unobserved native cleanup-failure assertion; **OBS-03 and HOST-01/02/03** retain deferred production-host checks. The [latest fixture results](#completed-fixture-validation-15-october-2026) and [initial environment/timing baseline](#recorded-baseline-15-october-2026) are recorded below.

The two-package fixture is deployed and guide steps 7–10 are complete. Both actual Windows reader accounts passed native SQL and HTTP replay with their intended roles/visibility. History, controlled values/property overrides, sensitive masking, failure, repeated/parallel children, running cases and second-folder scope are validated. No further fixture creation or reader setup is needed for these completed checks.

**Hosting is on hold at the user's request.** B5c, HOST-01/02/03 and production host/proxy/access/startup logging remain NOT RUN until reprioritized. C1b now proves opt-in native datetimeoffset conversion as recorded below. Native cleanup-failure observation and measured KPI cost remain follow-ups. B5a3/P0b stay open.

## How to use this checklist

Record PASS, FAIL or NOT RUN with a date and reason; use N/A only with an explanation. A partial case stays NOT RUN until all its assertions have evidence. Preserve private config, IDs, screenshots, raw logs and query plans under ignored `.local/backend-validation/`. Commit sanitized summaries only.

The Execution column describes ownership: **NOW** is database-free automation, **DB** is automatable after catalog setup, **MIXED** also needs setup/browser/local judgment, and **LATER** awaits the chosen host. There are 6 NOW, 10 DB, 11 MIXED and 3 LATER cases. These labels do not imply a published one-command integration suite.

Most repeatable SQL/HTTP/event checks can be run by the assistant when its runtime has access to the local machine and the intended database identity. Setup and a short visual review remain useful human work. Keep passwords local.

## Prepare the runtime and private config

Use standard CPython 3.14 at the intended architecture, the pinned requirements and an installed SQL Server ODBC driver of matching architecture. Reuse `.local/validation-venv314` only after checking its interpreter; otherwise create a new environment. Follow [installation/configuration guidance](installation.md) for a fresh setup.

Keep the real connection in `.local/backend-validation/dashboard.cfg`, selected by absolute `DASHBOARD_CONFIG`. Use `DEBUG=False`, `TESTING=False`, `PROPAGATE_EXCEPTIONS=False`, `LOG_LEVEL='INFO'`, positive login/query timeout settings, and a small overview window/list limit such as 24 hours/50 rows. Windows authentication uses the Python process account. The [reader reference](SSIS_FIXTURE_PROJECT_GUIDE.md#reader-permissions-and-sign-in-reference) explains the separate private reader configs.

Run from the repository in PowerShell:

```powershell
$repo = (Get-Location).Path
$pythonExe = Join-Path $repo '.local\validation-venv314\Scripts\python.exe'
$env:DASHBOARD_CONFIG = Join-Path $repo '.local\backend-validation\dashboard.cfg'
$runLabel = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$evidenceDir = Join-Path $repo ('.local\backend-validation\runs\' + $runLabel)
New-Item -ItemType Directory -Path $evidenceDir | Out-Null
git status --short --branch
git rev-parse HEAD
& $pythonExe -m pip check
& $pythonExe -m unittest discover -s tests -q
& $pythonExe -c "import sys,struct,pyodbc; print(sys.version); print('bits:',struct.calcsize('P')*8); print('GIL:',sys._is_gil_enabled()); print('drivers:',pyodbc.drivers())"
& $pythonExe -m flask --app dashboard:create_app routes
```

Record versions, timezone, actual driver/server/catalog, authentication and commit. Stop and resolve runtime/configuration failures before interpreting pages. For CFG-01, verify the same absolute selector/settings and explicit application/module path from a second working directory. For CFG-02, use separate temporary private configs with invalid timeout/log-level values and route discovery; do not overwrite the working config.

## Runtime, configuration, and catalog access

| ID | Execution | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- | --- |
| ENV-01 | [NOW](#prepare-the-runtime-and-private-config) | Inspect `sys.version`, pointer size, GIL state, installed package versions, and `pip check` in the environment used by the server. | Standard CPython 3.14, intended architecture, clean dependencies matching `constraints.txt`; record actual patch and installer. Free-threaded/other-platform results need their own evidence. | PASS — 2026-10-15: fresh CPython 3.14.8/x64/GIL environment, all eight pins, pip check and 101 tests. |
| ENV-02 | [NOW](#prepare-the-runtime-and-private-config) | Run `python -c "import pyodbc; print(pyodbc.drivers())"`; compare with the private connection's driver name and installed driver's version. | The selected SQL Server driver is present for the interpreter's architecture. Importing pyodbc alone is insufficient. Record the real driver/server/authentication combination. | PASS — 2026-10-15: registered x64 Driver 17; successful native SQL 2022 connection, DLL 17.10.0006, Windows/NTLM. |
| CFG-01 | [NOW](#prepare-the-runtime-and-private-config) | Start with the absolute private config selector, then start from another working directory using the same selector and an explicit application/module path. | The selected settings are used consistently; no accidental dependence on cwd or a different `config.cfg`. Record how the host locates the application. | PASS — 2026-10-15: absolute selector/settings and route discovery agree across two working directories; real alternate-directory startup/restart works. |
| CFG-02 | [NOW](#prepare-the-runtime-and-private-config) | In a temporary private config, try login/query timeouts of `0`, a string, and a boolean; try an invalid `LOG_LEVEL`. Run route discovery rather than a DB page. Restore valid settings. | Startup rejects invalid settings before database acquisition; errors identify the setting without echoing its value. `DEBUG=False` remains the intended host default. | PASS — 2026-10-15: all seven invalid timeout/log-level launches reject settings safely before database acquisition. |
| DB-01 | [DB](#native-connection-and-value-probe) | Open the overview with the intended monitoring identity and check its server label against the private test alias. | Successful connection, expected catalog, readable results, correct Unicode and native value conversion; six successful query events and one request summary. | PASS — 2026-10-15: actual Windows monitoring reader opens the populated Unicode/quote fixture overview with six queries; intended identity, non-admin roles, native catalog reads and header verified. |
| DB-02 | [MIXED](#reader-visibility) | Repeat the workflow with an approved identity having narrower catalog visibility, including an execution visible to the first identity but hidden to this one. | Results respect catalog visibility. A successful empty execution lookup returns the same 404 as an absent execution and runs no follow-up queries. A SQL permission error is a safe backend error, not automatically a browser 403. | PASS — 2026-10-15: actual normal/restricted Windows processes verify the selected two-versus-one visibility pair. Hidden details/events/values return the same safe 404 bodies as absent IDs after one zero-row lookup. |
| DB-03 | [DB](#native-connection-and-value-probe) | Check timestamps, Unicode names/messages, NULL end times, numeric durations, nonsensitive typed values, and BIGINT binding using representative rows. A checked-absent maximum BIGINT execution ID can test binding without creating a row. | Values render without conversion/overflow errors; absent valid IDs return 404 after one lookup. Preserve private examples and driver types for mismatches. | PASS — 2026-10-15: populated Unicode/quote names/messages, active NULL end times, formatted timestamps, native Int32/Boolean/NULL values and BIGINT binding checked. The additional raw datetimeoffset -155 limitation remains separately recorded for future typed data. |

## Browser workflow and query parity

For each request, copy its `X-Request-ID` from browser developer tools and find the matching application events. Query counts below apply to successful requests and count logical database operations, including connection acquisition; they do not count physical pooled connections. Error responses may stop earlier.

| ID | Execution | Page / steps | Expected result / query calls | Result |
| --- | --- | --- | --- | --- |
| UI-01 | [MIXED](#page-walkthrough-and-sql-parity) | Open `/`, folder, project, and valid status-filter navigation; compare the table/cards/chart with the checked-in SQL for the same private settings. | Server header, folder/project navigation, cards, daily chart, execution links, warnings/errors, status/logging labels, and table fields render. **6** queries. Preserve discrepancies as P0b baseline evidence. | PASS — 2026-10-15: overview/folder/project/status requests, four rows, cards/chart/navigation, SQL parity and six-query counts; browser rendering checked. |
| UI-02 | [MIXED](#page-walkthrough-and-sql-parity) | Open a visible execution's `/execution/<id>` page, including children and incomplete executables where available. | Correct execution identity/version, event KPIs, executables, children, durations/statuses and navigation. **7** queries. NULL/parallel/incomplete children must not make the page fail. | PASS — 2026-10-15: four completed repeated/parallel child calls match an independent path-specific event oracle; two active parallel children render without end times; both long runs later complete. Details/SQL parity and seven-query counts pass. |
| UI-03 | [MIXED](#page-walkthrough-and-sql-parity) | Open the same execution's five event categories: `all`, `errors`, `warnings`, `duplicate-warnings`, `memory-warnings`. | Correct category and escaped message text, package/component/path fields, and KPI links. **4** queries per page. Compare category results with the corresponding resource, including legacy text-pattern heuristics. | PASS — 2026-10-15: all five category routes match SQL, including populated duplicate/memory fixture messages; controlled Unicode/quote/HTML text is escaped literally. Existing populated errors/warnings evidence retained; four queries per page. |
| UI-04 | [MIXED](#page-walkthrough-and-sql-parity) | Open `/execution/<id>/values` for controlled nonsensitive parameter and property-override fixtures. | Both sections, native values and Set/Override flags render correctly; event KPIs and identity remain correct. **5** queries. Check actual catalog handling of sensitive values; API capability/redaction enforcement is still phase 2 work. | PASS — 2026-10-15: actual readers see controlled numeric/Boolean/string values, native types, Set/Override flags and a Description property override. The unique sensitive dummy is NULL/masked and absent from HTML, application events and catalog event messages; five queries. |
| UI-05 | [MIXED](#page-walkthrough-and-sql-parity) | Follow the package-history link for a package with repeated runs and a currently running example, if available. | Table, durations, averages and chart render; any running estimate is compared with the legacy query's current formula. **2** queries. Record unreliable/missing estimates for the API/history work. | PASS — 2026-10-15: six seeded runs plus later successes verify the independent six-row moving average; running estimates render and match the retained legacy contract. Exact primary/secondary/all-folder histories contain 8/1/9 rows; two queries per page. |
| UI-06 | [MIXED](#page-walkthrough-and-sql-parity) | Use Unicode/spaces and a quote-containing test name where available; exercise the existing `*` wildcard behaviour. Check an execution older than the configured overview window. | Parameters remain bound, names/messages stay readable, and an explicitly visible execution remains accessible with its own KPIs. Literal `%`/`_`, long-name truncation, and `all` ambiguities must be recorded against legacy semantics. | PASS — 2026-10-15: populated Unicode/apostrophe catalog folder and special messages render through bound routes. Prior wildcard/injection/empty filters and older-execution own-KPI checks remain passing baseline evidence. |
| UI-07 | [DB](#reader-visibility) | Compare browser table/chart results with private direct SQL results using the same selected identity and settings. | Record field/cohort/ordering differences and representative counts, not just screenshots. Do not infer SQL parity from a rendered page alone. | PASS — 2026-10-15: 29 independent native SQL dataset comparisons plus status cards/aggregate event KPIs match current fields/counts/order; private actual plans retained. |

## HTTP failures and recovery

| ID | Execution | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- | --- |
| HTTP-01 | [NOW](#safe-failures-and-recovery) | With an unavailable/missing-driver test config, request an unknown URL, nonexistent static file, and unsupported method. Also try unknown status/event selectors and execution ID `0`/overflow. | Database-independent 404/405/400, safe HTML, request ID, `Cache-Control: no-store`; 405 retains `Allow`. These rejected requests have **0** queries. Normal Python integer-conversion limits may reject extremely long decimal paths as 404 before the view. | PASS — 2026-10-15: missing-driver config; eight routing/static/method/input/long-integer cases, zero queries, request IDs/no-store/safe bodies and retained Allow. |
| HTTP-02 | [DB](#safe-failures-and-recovery) | Request a checked-absent valid execution and the corresponding event/value URLs; repeat for a hidden execution under the restricted identity. | 404, one successful lookup with `rows=0`, **1** query and **0** query failures; no KPI/event/value follow-up queries. Absence and filtered invisibility share the same response. | PASS — 2026-10-15: actual restricted Windows reader gets 404 for the hidden and absent details/events/values routes, each with one successful zero-row lookup and no follow-up queries. All three body comparisons match after request-ID normalization. |
| HTTP-03 | [NOW](#safe-failures-and-recovery) | Use a temporary config naming a confirmed unregistered driver; include only dummy credential canaries. Restore the original config. | Safe 503 for IM002/IM003; one failed acquisition, correlated error/query/request events, no credential canary in application events or HTML. This has local native Windows-driver-manager evidence, but must still be checked on the actual host. | PASS — 2026-10-15: confirmed missing driver produces safe 503 and one failed acquisition with correlated events; dummy credentials absent from HTML/events. |
| HTTP-04 | [MIXED](#safe-failures-and-recovery) | Test rejected login and an unreachable **approved test endpoint** with a short positive login timeout. Measure elapsed time and record only the SQLSTATE and safe status. | Class `08`/`28000` map to 503, HYT00/HYT01 to 504; other states remain safe 500. Record actual state, elapsed time and recovery. A login timeout setting is driver-controlled, not a total HTTP deadline. | PASS — 2026-10-15: nonexistent dummy login gives 28000/503 (~88 ms); own unused loopback endpoint gives 08001/503 (~2.18 s with 2 s login setting); fresh valid recovery succeeds. |
| HTTP-05 | [MIXED](#safe-failures-and-recovery) | Run the bounded native query-timeout probe described below, then, if an approved slow catalog fixture is available, trigger an HTTP query timeout with that fixture. | Driver reports a timeout around the chosen bound; application HYT00/HYT01 mapping is 504 and subsequent valid requests work. Record direct-probe and actual HTTP evidence separately; neither substitutes for the other. | PASS — 2026-10-15: direct bounded delay gives HYT00 at 1.014 s, closes both handles and cancels observed wait; real unchanged KPI query gives HTTP 504/HYT00 (~1.285 s client); normal recovery passes. |
| HTTP-06 | [DB](#safe-failures-and-recovery) | Restore the valid config after each negative test; repeat a normal page several times. | No persistent failure, leaked active query, stale error page, or empty-data success hiding a DB failure. Record native cleanup and pooling observations. | PASS — 2026-10-15: fresh valid overview/details/values recover after each negative case and both timeout probes; repeated real requests/resources checked. |

### Bounded native query-timeout probe

Use a disposable test connection to the approved SQL Server with `connection.timeout = 1`, and execute the fixed statement `WAITFOR DELAY '00:00:05'`. This requests a five-second delay without catalog writes; server scheduling may extend its actual elapsed time. It is not an app SQL-resource change or a guaranteed HTTP deadline. Create a temporary ignored Python script using the private configuration, a monotonic timer, and safe reporting of only SQLSTATE/elapsed time. Attempt both cursor and connection closes in `finally` even if one fails. Do not print the exception diagnostic or connection string. Run it once, record the actual result, then verify a normal connection still works.

See Microsoft's [WAITFOR documentation](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/waitfor-transact-sql) and pyodbc's [query-timeout setting](https://github.com/mkleehammer/pyodbc/wiki/Connection#timeout). If the fixture returns normally after roughly five seconds, record timeout enforcement as **FAIL/unresolved** for that driver combination. Do not simulate a production outage or change global SQL Server timeout settings. A direct ODBC probe establishes driver behaviour; an HTTP timeout needs its own controlled slow catalog case.

## Timing, logging, and resource checks

| ID | Execution | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- | --- |
| OBS-01 | [DB](#events-timing-and-resources) | At `LOG_LEVEL='INFO'`, correlate a successful and failed response with their application events. | One `request_completed` per dispatched request; queries share its server-generated ID and have consecutive `query_index` values. Counts/failures match actual logical operations; requests with no DB work have zero counts. | PASS — 2026-10-15: one correlated summary per scripted request, consecutive query indices, matching counts/failures/timing sums, including zero-query failures. |
| OBS-02 | [DB](#events-timing-and-resources) | Inspect success, failed connect, timeout, missing row, and, where reproducible, cleanup-failure events. | `query_completed` carries resource basename, outcome, elapsed milliseconds, row count or null, failure stage and cleanup flag. Empty success has zero rows; query failure is not represented as empty success. Database/unexpected-error events also identify the exception type and up to eight application module/function/line locations, correlated by request ID. | NOT RUN for a native cleanup-failure event; no such failure was induced. Native success/connect failure/query timeout/missing-row metadata and bounded safe error locations PASS (2026-10-15). |
| OBS-03 | [DB](#events-timing-and-resources) | Check application messages for dummy credential/parameter/URL/header canaries, raw SQL, values and tracebacks. Separately inspect host/proxy/access/startup output. | Application event fields omit them, including raw URL/path/query/body/header/exception text. Host/access/startup logs are a separate B5c configuration check; do not assume they inherit application sanitization. | NOT RUN for production host/proxy/access/startup redaction (B5c). Application JSON/error-HTML canary checks PASS (2026-10-15); development access log contains URL canary as separately documented. |
| OBS-04 | [DB](#events-timing-and-resources) | Compare cold and warm requests over a small representative set; record per-query timings and query plans where authorized. | Query time covers acquisition through cleanup; request time ends at response preparation. Browser/network/body-transfer time is separate. Record actual numbers; logical-query reductions are not measured latency promises. | PASS — 2026-10-15: first-process overview, five warm samples per representative route, per-query medians and 17 resource plans recorded. KPI query/compile cost identified; no p95/production-latency claim. |
| OBS-05 | [DB](#events-timing-and-resources) | Send a small pair of overlapping requests from separate clients, then repeat sequential requests. | Distinct request IDs, independent query counts and sums, no duplicate summaries or counters carried into the next request. Record wall-clock observations without a production load test. | PASS — 2026-10-15: ~525 ms client overlap and interleaved server queries; distinct IDs, independent 6/7-query counts and clean subsequent reset. |
| RES-01 | [MIXED](#events-timing-and-resources) | After successful, failed and timed-out requests, inspect active queries/connections through an approved DBA/test-monitoring session if available. | Cursor/connection cleanup and native cancellation are effective; repeated requests do not grow active work/resources indefinitely. Do not grant the app broad monitoring rights just for this check. Idle physical pooled sessions may remain after logical closes. | PASS — 2026-10-15: 129 workload DMV samples observe active work settling to zero active requests/transactions, two stable idle pooled sessions; direct native wait cancellation also observed. |
| RES-02 | [MIXED](#events-timing-and-resources) | Stop the task-created server and inspect its process/listener ownership. Start it again with the valid test config. | The owned server/process tree stops cleanly; unrelated processes remain running; a fresh startup recovers normally. A free port alone is not full process-cleanup evidence. | PASS — 2026-10-15: 12 owned server lifecycles stop cleanly, fresh valid restart works, final ownership/listener audit is clear; unrelated reused PID preserved. |

## Hosting checks: deferred at the user's request

As of 15 October 2026, HOST-01/02/03 and the production host/proxy/access/startup portion of OBS-03 remain **NOT RUN and on hold**. Resume when hosting is reprioritized. Local database identity/visibility and application logging checks remain active.

| ID | Execution | Steps / required evidence | Expected result | Result |
| --- | --- | --- | --- | --- |
| HOST-01 | [LATER](#events-timing-and-resources) | Use the selected production server's documented launcher, Python/runtime, bind address, WSGI target and private config. | Reproducible startup with debug off and intended loopback/private binding. Native dependency/driver checks repeat under the service identity. Exact commands remain pending B5c. | NOT RUN — 2026-10-15: B5c production launcher/service identity not selected; loopback WSGI harness does not pass hosting. |
| HOST-02 | [LATER](#events-timing-and-resources) | Exercise restart, unavailable DB, shutdown and owned-resource cleanup on the chosen host. If a container is selected, build/run its actual recipe and repeat native checks there. | Healthy restart/recovery, safe errors, consistent versions/config and no leaked owned workers. The historical Ubuntu 16.04/Python 3.6 image is not current evidence. | NOT RUN — 2026-10-15: production service/container restart/outage/shutdown checks await B5c. |
| HOST-03 | [LATER](#events-timing-and-resources) | Inspect access/authentication/proxy boundaries, log redaction and transport policy before sharing the host. | Deployment restrictions work for the intended audience. API authorization/redaction is phase 2; production streaming buffering/capacity/heartbeats are phase 5 and cannot be marked complete here. | NOT RUN — 2026-10-15: production authentication/proxy/transport/logging boundaries await B5c. |

## Known semantics and open gates

- Legacy status cards use a `start_time` cohort; the execution list uses `created_time`. Several resources have only a lower time bound. Status selection does not narrow the aggregate event-KPI operation. Shared-cohort/both-bound API semantics remain phase 2 work; capture baseline differences rather than treating the current pages as that future contract.
- Overview status cards use `engine-kpi.sql`; the explicit `get_aggregate_event_kpi()` backend operation is not displayed as an overview event card. Its legacy `-1` branch and bound parameters have automated coverage, but real aggregate SQL results still need P0b evidence if that operation is used.
- History's status path segment is validated but does not change its SQL scope. History limits/estimates, exact-name filtering, name-length handling, future status codes, pagination and typed JSON remain API work. Full-page refresh and existing browser libraries remain until their frontend milestones.
- Synthetic/native-negative checks do not establish real authentication, catalog row visibility, sensitive-value access, data correctness, query plans, native timeout enforcement or physical pooling behaviour. Keep failed/not-run native cases open and bring them back after the consolidated check.

## Consolidated result record

| Field | Value |
| --- | --- |
| Date / tester | 15 October 2026 / local Codex validation |
| Commit / host alias | `37bc7ac00015906bbdd16f55e74daa48333b4962` / `local-lab` |
| Python / architecture / GIL | CPython 3.14.8 / Windows x64 / enabled |
| Runtime pins / installer | All eight constraints match; pip 26.2.1, clean offline binary-wheel install, pip check and 101 tests PASS |
| Driver / catalog version / authentication mode | Driver 17.10.0006 / SQL 2022 16.0.1000.6, SSISDB schema 7 / Windows NTLM; administrator setup plus actual normal/restricted reader replay |
| Private config/evidence location (no credentials) | Ignored `.local/backend-validation/`; working config `dashboard.cfg`; original evidence `runs/2026-10-15/`; latest fixture run selected by `runs/fixture-current.private.json` |
| Passed / failed / not-run case IDs | 25 full PASS; OBS-02/03 and HOST-01/02/03 retain NOT RUN assertions. Additional raw datetimeoffset probe FAIL (-155); see recorded baseline below |
| Cold/warm timings and query-plan evidence | First-process overview 2,419 ms; warm overview/details/events/values/history medians 448/1,735/1,360/1,406/10 ms; 17 query resources have private actual plans |
| Known differences / follow-up tasks | [Recorded findings](#recorded-baseline-15-october-2026) and [completed fixture validation](#completed-fixture-validation-15-october-2026); B5a3/P0b and B5c remain open |

After results exist, update the case statuses and `docs/PROGRESS.md` with a sanitized summary. B5a3/P0b and the parent backend phase stay incomplete until the relevant real-data/host evidence passes; do not mark them complete from this checklist's existence.

## Native connection and value probe

Save the following as ignored `.local/backend-validation/tools/native-probe.py` (a local copy is already prepared). From the repository, run it through standard input so `dashboard` is importable:

```powershell
$probePath = Join-Path $repo '.local\backend-validation\tools\native-probe.py'
Get-Content -Raw -Encoding UTF8 $probePath | & $pythonExe - connect
# Run the bounded timeout probe once when checking HTTP-05:
Get-Content -Raw -Encoding UTF8 $probePath | & $pythonExe - timeout
```

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

The direct probe establishes driver behavior, not full catalog/HTTP parity. Additionally inspect actual Unicode names/messages, typed values, NULL end times and durations through the fixture pages. Current SQL formats/casts many values; a rendered timestamp does not establish raw datetimeoffset support. The additional raw type failure remains in the findings below.

## Page walkthrough and SQL parity

Before starting a server, check whether a healthy task-owned local server already exists and reuse it where suitable. Otherwise select a free loopback port and retain its process/listener ownership. For a manual session, run in the selected environment with the good config:

```powershell
& $pythonExe -m flask --app dashboard:create_app run --host=127.0.0.1 --port=5000 --no-debug --no-reload --no-debugger 2>&1 | Tee-Object -FilePath (Join-Path $evidenceDir 'server.log')
```

Review overview/folder/project/status navigation, success/failure/parent/running details, all five event categories, values/overrides, and history. Check charts, tables, search/paging and menus visually. In browser Network, correlate the document's `X-Request-ID`; inspect Console errors. Refresh after status changes; live updates are a later milestone. Expected logical queries are **6/7/4/5/2** for overview/details/events/values/history.

Use `/execution/ID`, `/execution/ID/events/all` and `/execution/ID/values` with real visible IDs. Event categories are `all`, `errors`, `warnings`, `duplicate-warnings`, `memory-warnings`. Special text must display literally; the unique sensitive dummy must be absent from HTML and logs. Its flag/name may remain visible.

The direct history route is `/history/FOLDER/project/PROJECT/status/all/package/PACKAGE`; percent-encode each name segment. Compare it with inherited-scope overview links and, when prepared, the same package in the second fixture folder. Use an existing older execution for the overview-window case rather than altering timestamps. Compare active rows before and after completion, including missing child end events and repeated/parallel calls.

For direct SQL, use the same identity, execution IDs, window/as-of/limit and name/status patterns. Open the matching `dashboard/query/` resource; in a private SSMS copy replace positional `?` declarations with typed variables, preserving the body. `dashboard/ssis.py` defines parameter order:

| Resource | Parameters in order |
| --- | --- |
| `engine-kpi.sql` | Hours, as-of, folder pattern, project pattern |
| `executions-statistics.sql` | Hours, as-of, folder pattern, project pattern, numeric status |
| `package-list.sql` | Hours, as-of, folder pattern, project pattern, numeric status, row limit |
| `package-kpi.sql` | Hours, as-of, folder pattern, project pattern, execution ID |
| `package-history.sql` | Folder pattern, project pattern, package pattern |
| Info/executable/child/event/value resources | Execution ID |

`all` names become `%`, `*` becomes `%`, and status `all` becomes `0`. Execution KPI calls use `%` for both names. Retain bound parameters in automated probes; double embedded quotes in private SQL literals. Compare IDs, order, counts, field values and chart points. Prefer completed rows in a quiet catalog; an as-of value alone does not freeze queries lacking an upper bound. Capture actual plans under an authorized admin/DBA identity without expanding the readers' rights.

## Reader visibility

Use the existing normal/restricted identities and the selected visible/hidden pair. [The fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md#9-add-fixture-grants-to-the-existing-readers) supplies additive grants for the new project; its [reader reference](SSIS_FIXTURE_PROJECT_GUIDE.md#reader-permissions-and-sign-in-reference) supplies sign-in/config checks.

Verify both IDs under the normal reader and exactly the selected visible one under the restricted reader. Run Python under the corresponding Windows account for actual HTTP checks. The visible execution must open; the hidden details/events/values routes must return 404 after **one successful zero-row lookup and no follow-up queries**. Compare with a checked-absent valid ID: same safe body apart from request ID. A SQL permission exception is a safe backend error, not automatically HTTP 403. Administrator impersonation does not prove independent sign-in.

## Safe failures and recovery

Use separate private temporary configurations and the approved local lab. Follow HTTP-01 through HTTP-06 above for invalid input, absent/hidden rows, missing driver, a verified nonexistent dummy login, an approved unreachable endpoint and timeout. Do not make repeated bad-password attempts against a real account. Record SQLSTATE/status/elapsed time without diagnostic text or connection strings; restore the valid config and check recovery after every negative case.

Expected mappings are class `08`/`28000` to **503**, `HYT00`/`HYT01` to **504**, and other DB states to safe **500**. A native one-second timeout requests cancellation of the fixed five-second WAITFOR; an HTTP timeout needs its own controlled slow catalog case. If no slow case is available, keep that assertion NOT RUN rather than changing shared SQL or creating an outage. Invalid routing/input cases should perform no DB work. Preserve request IDs, no-store and required headers such as `Allow` on 405.

## Events, timing and resources

At INFO, require one request summary and consecutive correlated query events per request, with correct counts/failures/timing sums. Inspect outcomes, row counts, failure stage and cleanup flags; missing rows are successful zero-row lookups. Exception metadata may contain only bounded safe type/application locations. Use harmless unique canaries to check application HTML/events for raw credentials, parameters, URLs, headers, SQL and diagnostic/traceback leakage. Host/proxy/access/startup output is a separately deferred check; it does not inherit application sanitization.

Record first-process/cold and repeated warm timings for the same small route set; distinguish application response preparation, query lifetime, and client/browser/transfer time. Use two independent overlapping clients to confirm distinct request IDs, independent counts/sums and a clean subsequent sequential request. This is a local overlap check, not production capacity evidence.

Where available, use an authorized separate DBA session to observe active requests/transactions before, during and after success/failure/timeout. Record native cancellation and whether active work returns to baseline; idle pooled physical sessions can persist after logical closes. Do not manufacture driver cleanup failure or grant server-wide monitoring rights to the dashboard readers.

Stop only the task-owned server/browser resources. Check command/creation/ancestry metadata and listeners, preserve unrelated reused PIDs, then verify fresh valid startup/recovery if required. A free port alone does not prove process cleanup. B5c and production service/container/proxy/transport/logging/stream-capacity checks remain deferred.

## Completed fixture validation: 15 October 2026

Guide steps **7–10 PASS** at the same application commit, using the deployed `DashboardValidation` project and native Driver 17.10.0006. The main deployment stayed unchanged. The optional scope test deployed the identical `.ispac` to `DashboardValidationOther`; no existing different project was overwritten.

| Evidence | Recorded result |
| --- | --- |
| Seed/history and case executions | 12 new fixture executions: 11 succeeded and the one intentional failure returned status 4 with its expected OnError message. Six seeded delays were two through seven seconds. |
| Values/events | Int32 42, Boolean false, string/Unicode/HTML text, runtime flags and harmless task Description override verified. The unique sensitive dummy is masked/NULL and absent from response HTML, application events and catalog event messages. |
| Children/running | Four child invocations, repeated through one task then two overlapping calls, matched an independent path-specific event oracle. While active, both root end times were NULL and two child end events were absent; HTTP pages and history estimates rendered. Both long executions finished naturally in about 65 seconds. |
| History scope | Exact primary folder: 8 successes; second folder: 1; all folders: 9. Six-row moving averages were independently calculated; the validated status segment retains its legacy ignored-scope behavior. |
| Reader grants | Added fixture folder/project/selected-operation READ and normal-reader navigation READ on the optional folder. Existing grants and roles preserved; no package execution/admin rights added to either reader. |
| Actual Windows identities | User ran the secure local helper. Both actual reader processes connected with expected identities, sysadmin/db_owner/ssis_admin zero and ssis_logreader one only for the normal reader. Each completed 15 HTTP requests. |
| HTTP/native assertions | 84 real loopback HTTP requests and 628 passing assertions across actual readers, explicit session-impersonation probes, running and completion/scope checks. Nine independent native assertions pass. Hidden/absent bodies match for all three detail routes apart from request IDs. |
| Cleanup | All six owned servers stopped, with zero remaining owned processes/listeners; all 12 fixture executions are terminal. SQL Server/Agent remained running. |

The private run pointer is `.local/backend-validation/runs/fixture-current.private.json`. Its directory contains preflight/deployed `.ispac`, execution/grant records, native comparisons, actual/impersonated HTTP results and bodies, scope results, summary and cleanup audit. Reader passwords were entered only in the local secure prompt; none were saved. The application/SQL resources/dependency pins were unchanged, so the 101-test suite was not repeated; its earlier Windows evidence remains the baseline.

Remaining: **OBS-02** native cleanup-failure observation and the four deferred host/logging cases. C1b subsequently proves typed datetimeoffset conversion as recorded below. The legacy running estimate is evidence of current query behavior, not a prediction-accuracy guarantee. B5a3/P0b remain open for their native follow-ups; hosting stays deferred.

## Recorded baseline: 15 October 2026

The following is historical evidence from `37bc7ac00015906bbdd16f55e74daa48333b4962`, not a rerun during documentation cleanup. The initial run used the existing Windows administrator and four completed sample executions (two succeeded/two failed), Basic logging, 1,379 events including 12 errors/one warning, and two successful history rows. Dedicated fixture runs and actual reader HTTP were unavailable in that initial run; their completion is recorded above.

| Item | Recorded environment |
| --- | --- |
| Host alias | `local-lab`; Windows x64, Europe/London (Windows `GMT Standard Time`, observed UTC+01:00) |
| Python | Standard CPython 3.14.8, 64 bits, GIL enabled; official NuGet runtime already present locally; fresh `.local/validation-venv314` |
| Installation | Offline binary-wheel install from `requirements.txt` and `wheelhouse`; pip 26.2.1; `pip check` passed |
| Runtime pins | Flask 3.1.3, pyodbc 5.3.0, blinker 1.9.0, click 8.5.0, itsdangerous 2.2.0, Jinja2 3.1.6, MarkupSafe 3.0.4, Werkzeug 3.1.9 |
| Driver | ODBC Driver 17 for SQL Server, `msodbcsql17.dll` 17.10.0006, x64 |
| SQL/catalog | SQL Server 2022 Developer Edition (64-bit), 16.0.1000.6; SSISDB schema version 7/build 16.0.1000.6 |
| Identity | Current Windows identity, NTLM, **sysadmin**; dedicated monitoring/restricted identities unavailable and explicitly deferred by the user |
| Transport | Local shared memory; native connection reports encryption enabled. Private lab config uses explicit certificate-trust bypass; trusted-certificate/remote transport checks remain open |
| Application | Absolute private config; debug/testing/exception propagation off; INFO events; login timeout 5 seconds, query timeout 30 seconds; 24-hour overview, 50-row limit, `AS_OF_DATE='NOW'` |
| Server | Temporary loopback Werkzeug WSGI validation harness using the real factory/routes/driver, plus Flask CLI replay; production hosting remains B5c |

The fresh Windows runtime passed 101 database-free tests. The integration run made 105 scripted HTTP requests, compared 29 independent SQL datasets plus cards/aggregate KPIs, and retained actual plans for 17 resources. Browser review covered charts/tables/navigation, 672 event rows with search reducing to 50, and no observed console errors. Initial helper quote/CRLF/SQLSTATE assumptions were corrected by reviewing preserved bodies/events; no exercised application assertion remained unresolved.

A direct WAITFOR probe returned HYT00 at 1.014 seconds with observed native cancellation. A real details request timed out in unchanged KPI SQL with HTTP 504/HYT00 at about 1.285 seconds and recovered. The overlapping clients had about 525 ms overlap with independent 6/7-query counts. Across 129 DMV samples, active work returned to zero requests/transactions with two stable idle pooled sessions. All 12 owned server lifecycles and their listeners ended; an unrelated reused PID was preserved, and SQL Server/Agent remained running.

The first process overview took **2,419 ms** at response preparation. The table below records a later first-observed request and the median of five sequential repetitions; these are small local samples, not p95 measurements. SQL Server caches were not cleared, and browser/transfer timing is separate.

| Page | First observed in timing batch (ms) | Warm median, application (ms) | Warm median, HTTP client (ms) |
| --- | ---: | ---: | ---: |
| Overview | 465.338 | 448.409 | 457.259 |
| Details | 1,469.658 | 1,735.255 | 1,736.894 |
| Events, failed fixture | 2,581.740 | 1,359.915 | 1,371.772 |
| Values | 1,132.314 | 1,405.735 | 1,408.048 |
| History | 23.469 | 9.670 | 12.953 |

`package-kpi.sql` dominated details/events/values: its per-query warm medians were about **1,502/1,340/1,394 ms**. The overview list query took about **424 ms**. A captured aggregate KPI plan recorded **2,412 ms compilation** and **98 ms execution**; compilation cost merits investigation when the SQL/API milestone addresses this operation. No query was changed in this validation task, and no current latency threshold was invented to turn this baseline into a pass/fail budget.

The additional raw `SELECT SYSDATETIMEOFFSET()` probe **FAILS** with pyodbc's unsupported SQL type **-155**. Current checked-in page queries explicitly format/cast their timestamps, and those actual responses passed. Separate native BIGINT, Unicode NVARCHAR, NULL datetime2, Decimal, Boolean and datetime2 probes passed. This initial bare-driver limitation is resolved for opted-in typed queries by the C1b converter proof below; the default unconverted driver behavior remains unchanged.

Known legacy behavior was retained: different start/created-time cohorts, NULL warning/error display, status-independent aggregate/history scope, wildcard rather than exact-name semantics, and a history heading/limit mismatch. The initial single-project fixture could not establish isolation of identically named packages across multiple projects. The later fixture run above verifies the designed same-project/package history scope across two folders.

After the user created the reader logins and applied the initial grants, a separate read-only session-impersonation audit found enabled mapped logins, sysadmin/db_owner/ssis_admin zero for both, ssis_logreader one only for the normal reader, and four-versus-one execution visibility. The administrator context was restored. Actual reader sign-in/HTTP was NOT RUN at that stage and is now completed as recorded above.

Private original evidence is in `.local/backend-validation/runs/2026-10-15/`: inventory/configuration, test output, raw/reviewed/final request reports, responses/template snapshots, logs/plans, DMV samples, browser notes and ownership/cleanup records. The original retired docs and relocation hashes are under `runs/organization-2026-10-15/`. Old snapshots contain original absolute paths; use the relocation manifest to find moved files. The earlier documentation consolidation did not rerun SQL/packages/tests or change case results; subsequent fixture validation above completed nine cases.


## Typed datetimeoffset resolution / C1b

15 October 2026: the application now offers `execute_query(..., typed_timestamps=True)` with a connection-local -155 output converter. It keeps exact 100-nanosecond UTC instants until explicit serialization and binds canonical timestamp strings through `CONVERT(datetimeoffset(7), ?)` so Python datetime cannot truncate the seventh digit. The default legacy path remains unchanged.

On standard Windows x64 CPython 3.14.8 / pyodbc 5.3.0 / Driver 17.10.0006 / SQL 2022 16.00.1000, a read-only native run passed **26 assertions over 15 application queries**. Controlled source-offset and canonical input round-trips, +05:45/-00:30 and +/-14-hour offsets, date/year rollover, adjacent 100-nanosecond instants, large/max IDs, NULLs, Decimal/Boolean/counts and unknown codes survive strict JSON. Three real catalog rows' raw created/start/end timestamps agree with separate SQL UTC projections. A subsequent unconverted logical connection reproduces the unsupported type, and legacy formatted text stays unchanged. Every observed logical query completed cleanup. The full **130-test** database-free suite and `pip check` pass.

The current private validation connection supplied the SQL identity; normal/restricted reader HTTP was not replayed for this conversion task. Only bounded SELECTs were run; no server or catalog mutation was required. Private evidence is `.local/backend-validation/runs/c1b-20261015T202103Z/result.private.json`; the reusable ignored probe is `.local/backend-validation/tools/probe-typed-data.py`. The restricted execution context failed Windows encryption/credential setup before any query; the approved native run used the same config outside that restriction.

This closes the extra typed datetimeoffset compatibility follow-up on this baseline. It does not close **OBS-02**, change the **25/30** checklist total, complete B5a3/P0b, or establish API endpoint, other-driver/platform or hosting acceptance. Registration/decoder failure cleanup remains covered synthetically; deliberate native cleanup failure remains NOT RUN. See [C1b progress](PROGRESS.md#c1b--exact-typed-sql-to-json-boundary).
