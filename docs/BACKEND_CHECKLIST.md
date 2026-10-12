# Backend manual validation

Updated: 12 October 2026. Development base: `dev-next`.

Run this checklist after the B implementation milestones, as requested. [Implementation progress](PROGRESS.md) records automated evidence; this document records the remaining checks against your SSISDB and eventual host. **No real SSISDB check below has been completed.** B5a3/P0b remain open; hosting rows also need the B5c implementation. Passing synthetic tests or importing pyodbc does not close those gates.

Record **PASS**, **FAIL**, or **NOT RUN**, with the date and reason. Use **N/A** only when a case does not apply, and explain why. Keep private configuration, execution identifiers, screenshots, query plans, and full host logs in an ignored directory such as `.local/backend-validation/`. Commit only a sanitized summary of results and evidence locations; never commit credentials or connection strings.

## Prepare the test environment

1. Use a dedicated SSISDB test environment and a monitoring identity with the intended read/visibility permissions. Identify one succeeded, one failed, one running or incomplete execution, one execution with children, one with nonsensitive parameter/override values, and a package with duration history. If a case is unavailable, record it rather than generating arbitrary catalog writes.
2. Select a fresh standard CPython 3.14 environment. Record the exact Python patch/architecture, all runtime package versions, ODBC driver name/version, SQL Server/catalog version, authentication mode, host/server configuration, timezone, and commit. Use a private alias for the server/identity in the tracked summary.
3. Install from `requirements.txt`, then run `python -m pip check`, `python -m unittest discover -s tests -q`, and `python -m flask --app dashboard:create_app routes`. The current local evidence is Windows x64/CPython 3.14.8, eight pinned runtime packages, and 94 passing database-free tests.
4. Store the real connection settings in a private Python config file, selected with an **absolute** `DASHBOARD_CONFIG` path. Include `LOG_LEVEL='INFO'`, `DEBUG=False`, positive login/query timeout settings, and a small initial window/list limit, for example `HOUR_SPAN=24` and `EXECUTION_COUNT=50`. Record the actual settings used without publishing credentials.
5. Start the local development server on loopback for these checks. Use the selected virtual environment's executable. Save application events and browser request IDs locally. Shared-host checks must use the eventual B5c host; the development server does not validate production hosting.

Example PowerShell commands after selecting the environment:

```powershell
$env:DASHBOARD_CONFIG = 'C:\private\ssis-dashboard-test.cfg'
python -m pip check
python -m flask --app dashboard:create_app routes
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Stop the server with Ctrl+C when finished; verify its process has exited. Do not stop unrelated Python processes. Preserve the original configuration before changing it for negative tests and restore it before continuing normal checks.

## Runtime, configuration, and catalog access

| ID | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- |
| ENV-01 | Inspect `sys.version`, pointer size, GIL state, installed package versions, and `pip check` in the environment used by the server. | Standard CPython 3.14, intended architecture, clean dependencies matching `constraints.txt`; record actual patch and installer. Free-threaded/other-platform results need their own evidence. | NOT RUN |
| ENV-02 | Run `python -c "import pyodbc; print(pyodbc.drivers())"`; compare with the private connection's driver name and installed driver's version. | The selected SQL Server driver is present for the interpreter's architecture. Importing pyodbc alone is insufficient. Record the real driver/server/authentication combination. | NOT RUN |
| CFG-01 | Start with the absolute private config selector, then start from another working directory using the same selector and an explicit application/module path. | The selected settings are used consistently; no accidental dependence on cwd or a different `config.cfg`. Record how the host locates the application. | NOT RUN |
| CFG-02 | In a temporary private config, try login/query timeouts of `0`, a string, and a boolean; try an invalid `LOG_LEVEL`. Run route discovery rather than a DB page. Restore valid settings. | Startup rejects invalid settings before database acquisition; errors identify the setting without echoing its value. `DEBUG=False` remains the intended host default. | NOT RUN |
| DB-01 | Open the overview with the intended monitoring identity and check its server label against the private test alias. | Successful connection, expected catalog, readable results, correct Unicode and native value conversion; six successful query events and one request summary. | NOT RUN |
| DB-02 | Repeat the workflow with an approved identity having narrower catalog visibility, including an execution visible to the first identity but hidden to this one. | Results respect catalog visibility. A successful empty execution lookup returns the same 404 as an absent execution and runs no follow-up queries. A SQL permission error is a safe backend error, not automatically a browser 403. | NOT RUN |
| DB-03 | Check timestamps, Unicode names/messages, NULL end times, numeric durations, nonsensitive typed values, and BIGINT binding using representative rows. A checked-absent maximum BIGINT execution ID can test binding without creating a row. | Values render without conversion/overflow errors; absent valid IDs return 404 after one lookup. Preserve private examples and driver types for mismatches. | NOT RUN |

## Browser workflow and query parity

For each request, copy its `X-Request-ID` from browser developer tools and find the matching application events. Query counts below apply to successful requests and count logical database operations, including connection acquisition; they do not count physical pooled connections. Error responses may stop earlier.

| ID | Page / steps | Expected result / query calls | Result |
| --- | --- | --- | --- |
| UI-01 | Open `/`, folder, project, and valid status-filter navigation; compare the table/cards/chart with the checked-in SQL for the same private settings. | Server header, folder/project navigation, cards, daily chart, execution links, warnings/errors, status/logging labels, and table fields render. **6** queries. Preserve discrepancies as P0b baseline evidence. | NOT RUN |
| UI-02 | Open a visible execution's `/execution/<id>` page, including children and incomplete executables where available. | Correct execution identity/version, event KPIs, executables, children, durations/statuses and navigation. **7** queries. NULL/parallel/incomplete children must not make the page fail. | NOT RUN |
| UI-03 | Open the same execution's five event categories: `all`, `errors`, `warnings`, `duplicate-warnings`, `memory-warnings`. | Correct category and escaped message text, package/component/path fields, and KPI links. **4** queries per page. Compare category results with the corresponding resource, including legacy text-pattern heuristics. | NOT RUN |
| UI-04 | Open `/execution/<id>/values` for controlled nonsensitive parameter and property-override fixtures. | Both sections, native values and Set/Override flags render correctly; event KPIs and identity remain correct. **5** queries. Check actual catalog handling of sensitive values; API capability/redaction enforcement is still phase 2 work. | NOT RUN |
| UI-05 | Follow the package-history link for a package with repeated runs and a currently running example, if available. | Table, durations, averages and chart render; any running estimate is compared with the legacy query's current formula. **2** queries. Record unreliable/missing estimates for the API/history work. | NOT RUN |
| UI-06 | Use Unicode/spaces and a quote-containing test name where available; exercise the existing `*` wildcard behaviour. Check an execution older than the configured overview window. | Parameters remain bound, names/messages stay readable, and an explicitly visible execution remains accessible with its own KPIs. Literal `%`/`_`, long-name truncation, and `all` ambiguities must be recorded against legacy semantics. | NOT RUN |
| UI-07 | Compare browser table/chart results with private direct SQL results using the same selected identity and settings. | Record field/cohort/ordering differences and representative counts, not just screenshots. Do not infer SQL parity from a rendered page alone. | NOT RUN |

## HTTP failures and recovery

| ID | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- |
| HTTP-01 | With an unavailable/missing-driver test config, request an unknown URL, nonexistent static file, and unsupported method. Also try unknown status/event selectors and execution ID `0`/overflow. | Database-independent 404/405/400, safe HTML, request ID, `Cache-Control: no-store`; 405 retains `Allow`. These rejected requests have **0** queries. Normal Python integer-conversion limits may reject extremely long decimal paths as 404 before the view. | NOT RUN |
| HTTP-02 | Request a checked-absent valid execution and the corresponding event/value URLs; repeat for a hidden execution under the restricted identity. | 404, one successful lookup with `rows=0`, **1** query and **0** query failures; no KPI/event/value follow-up queries. Absence and filtered invisibility share the same response. | NOT RUN |
| HTTP-03 | Use a temporary config naming a confirmed unregistered driver; include only dummy credential canaries. Restore the original config. | Safe 503 for IM002/IM003; one failed acquisition, correlated error/query/request events, no credential canary in application events or HTML. This has local native Windows-driver-manager evidence, but must still be checked on the actual host. | NOT RUN |
| HTTP-04 | Test rejected login and an unreachable **approved test endpoint** with a short positive login timeout. Measure elapsed time and record only the SQLSTATE and safe status. | Class `08`/`28000` map to 503, HYT00/HYT01 to 504; other states remain safe 500. Record actual state, elapsed time and recovery. A login timeout setting is driver-controlled, not a total HTTP deadline. | NOT RUN |
| HTTP-05 | Run the bounded native query-timeout probe described below, then, if an approved slow catalog fixture is available, trigger an HTTP query timeout with that fixture. | Driver reports a timeout around the chosen bound; application HYT00/HYT01 mapping is 504 and subsequent valid requests work. Record direct-probe and actual HTTP evidence separately; neither substitutes for the other. | NOT RUN |
| HTTP-06 | Restore the valid config after each negative test; repeat a normal page several times. | No persistent failure, leaked active query, stale error page, or empty-data success hiding a DB failure. Record native cleanup and pooling observations. | NOT RUN |

### Bounded native query-timeout probe

Use a disposable test connection to the approved SQL Server with `connection.timeout = 1`, and execute the fixed statement `WAITFOR DELAY '00:00:05'`. This requests a five-second delay without catalog writes; server scheduling may extend its actual elapsed time. It is not an app SQL-resource change or a guaranteed HTTP deadline. Create a temporary ignored Python script using the private configuration, a monotonic timer, and safe reporting of only SQLSTATE/elapsed time. Attempt both cursor and connection closes in `finally` even if one fails. Do not print the exception diagnostic or connection string. Run it once, record the actual result, then verify a normal connection still works.

See Microsoft's [WAITFOR documentation](https://learn.microsoft.com/en-us/sql/t-sql/language-elements/waitfor-transact-sql) and pyodbc's [query-timeout setting](https://github.com/mkleehammer/pyodbc/wiki/Connection#timeout). If the fixture returns normally after roughly five seconds, record timeout enforcement as **FAIL/unresolved** for that driver combination. Do not simulate a production outage or change global SQL Server timeout settings. A direct ODBC probe establishes driver behaviour; an HTTP timeout needs its own controlled slow catalog case.

## Timing, logging, and resource checks

| ID | Steps | Expected result / evidence | Result |
| --- | --- | --- | --- |
| OBS-01 | At `LOG_LEVEL='INFO'`, correlate a successful and failed response with their application events. | One `request_completed` per dispatched request; queries share its server-generated ID and have consecutive `query_index` values. Counts/failures match actual logical operations; requests with no DB work have zero counts. | NOT RUN |
| OBS-02 | Inspect success, failed connect, timeout, missing row, and, where reproducible, cleanup-failure events. | `query_completed` carries resource basename, outcome, elapsed milliseconds, row count or null, failure stage and cleanup flag. Empty success has zero rows; query failure is not represented as empty success. | NOT RUN |
| OBS-03 | Check application messages for dummy credential/parameter/URL/header canaries, raw SQL, values and tracebacks. Separately inspect host/proxy/access/startup output. | Application event fields omit them, including raw URL/path/query/body/header/exception text. Host/access/startup logs are a separate B5c configuration check; do not assume they inherit application sanitization. | NOT RUN |
| OBS-04 | Compare cold and warm requests over a small representative set; record per-query timings and query plans where authorized. | Query time covers acquisition through cleanup; request time ends at response preparation. Browser/network/body-transfer time is separate. Record actual numbers; logical-query reductions are not measured latency promises. | NOT RUN |
| OBS-05 | Send a small pair of overlapping requests from separate clients, then repeat sequential requests. | Distinct request IDs, independent query counts and sums, no duplicate summaries or counters carried into the next request. Record wall-clock observations without a production load test. | NOT RUN |
| RES-01 | After successful, failed and timed-out requests, inspect active queries/connections through an approved DBA/test-monitoring session if available. | Cursor/connection cleanup and native cancellation are effective; repeated requests do not grow active work/resources indefinitely. Do not grant the app broad monitoring rights just for this check. Idle physical pooled sessions may remain after logical closes. | NOT RUN |
| RES-02 | Stop the task-created server and inspect its process/listener ownership. Start it again with the valid test config. | The owned server/process tree stops cleanly; unrelated processes remain running; a fresh startup recovers normally. A free port alone is not full process-cleanup evidence. | NOT RUN |

## Hosting checks to finalize during B5c

| ID | Steps / required evidence | Expected result | Result |
| --- | --- | --- | --- |
| HOST-01 | Use the selected production server's documented launcher, Python/runtime, bind address, WSGI target and private config. | Reproducible startup with debug off and intended loopback/private binding. Native dependency/driver checks repeat under the service identity. Exact commands remain pending B5c. | NOT RUN |
| HOST-02 | Exercise restart, unavailable DB, shutdown and owned-resource cleanup on the chosen host. If a container is selected, build/run its actual recipe and repeat native checks there. | Healthy restart/recovery, safe errors, consistent versions/config and no leaked owned workers. The historical Ubuntu 16.04/Python 3.6 image is not current evidence. | NOT RUN |
| HOST-03 | Inspect access/authentication/proxy boundaries, log redaction and transport policy before sharing the host. | Deployment restrictions work for the intended audience. API authorization/redaction is phase 2; production streaming buffering/capacity/heartbeats are phase 5 and cannot be marked complete here. | NOT RUN |

## Known semantics and open gates

- Legacy status cards use a `start_time` cohort; the execution list uses `created_time`. Several resources have only a lower time bound. Status selection does not narrow the aggregate event-KPI operation. Shared-cohort/both-bound API semantics remain phase 2 work; capture baseline differences rather than treating the current pages as that future contract.
- Overview status cards use `engine-kpi.sql`; the explicit `get_aggregate_event_kpi()` backend operation is not displayed as an overview event card. Its legacy `-1` branch and bound parameters have automated coverage, but real aggregate SQL results still need P0b evidence if that operation is used.
- History's status path segment is validated but does not change its SQL scope. History limits/estimates, exact-name filtering, name-length handling, future status codes, pagination and typed JSON remain API work. Full-page refresh and existing browser libraries remain until their frontend milestones.
- Synthetic/native-negative checks do not establish real authentication, catalog row visibility, sensitive-value access, data correctness, query plans, native timeout enforcement or physical pooling behaviour. Keep failed/not-run native cases open and bring them back after the consolidated check.

## Consolidated result record

| Field | Value |
| --- | --- |
| Date / tester | Pending |
| Commit / host alias | Pending |
| Python / architecture / GIL | Pending |
| Runtime pins / installer | Pending |
| Driver / catalog version / authentication mode | Pending |
| Private config/evidence location (no credentials) | Pending |
| Passed / failed / not-run case IDs | Pending |
| Cold/warm timings and query-plan evidence | Pending |
| Known differences / follow-up tasks | Pending |

After results exist, update the case statuses and `docs/PROGRESS.md` with a sanitized summary. B5a3/P0b and the parent backend phase stay incomplete until the relevant real-data/host evidence passes; do not mark them complete from this checklist's existence.
