# Implementation progress

Updated: 12 October 2026. Development base: `dev-next`.

The [roadmap](roadmap.md) defines scope; the [modernization plan](MODERNIZATION_PLAN.md) defines the design and delivery phases. This tracked document records smaller implementation milestones, their evidence, and the next bounded task. Update it with every code task. A completed submilestone does not mean its whole parent phase is complete.

## Task sizing and status

Prefer one coherent implementation boundary per task, with concrete exit checks and a reviewable commit. Split a milestone further when it combines unrelated behaviour, requires unavailable integration evidence, or grows beyond a focused review. Record the split here before extending its scope.

Statuses: **Planned**, **In progress**, **Complete**, or **Awaiting integration**. Complete means its stated local exit checks passed; SQL Server, driver, proxy, and deployment claims require their own recorded integration evidence.

## Baseline and backend foundation

These milestones implement roadmap item 1 and delivery phases 0–1. Phases 0 and 1 remain incomplete until all their required checks, including real SSISDB validation, pass.

| ID | Parent | Status | Scope and exit condition |
| --- | --- | --- | --- |
| P0a | Phase 0: workflow baseline | In progress | Add synthetic workflow fixtures as each backend slice needs them; maintain a field/workflow parity checklist and distinguish known bugs from intended behaviour. B1 establishes route/template coverage, not complete query parity. |
| P0b | Phase 0: real-data baseline | Planned | With an approved SSISDB test configuration, record representative list/metrics/events/values/history/children behaviour, query timings, and execution plans. |
| B1 | Phase 1: startup/configuration | Complete | Independent application factory, deterministic configuration loading, per-app monitoring configuration, explicit entry points, debug-off defaults, and database-free legacy page tests. Existing URLs and template endpoint names are preserved; the evidence and integration limits are recorded below. |
| B2 | Phase 1: database query boundary | Complete | Package-relative SQL loading and a standalone parameterized query operation own each connection/cursor. Positive login/query timeouts are validated and applied; fake-ODBC tests cover acquisition, execution/fetch/mapping, cleanup, and non-project working directories. Legacy shapes and checked-in SQL are preserved; native integration remains P0b/B5a work. |
| B3 | Phase 1: inputs and errors | Complete | Validate event/status/detail inputs and positive BIGINT execution IDs before queries; use fixed SQL resource maps; return safe HTML errors with correct HTTP statuses and database-independent routing errors. Treat absent/not-visible execution records alike. Synthetic HTTP/ODBC failure checks pass; API problem JSON and live permission/driver behaviour remain separate work. |
| B4 | Phases 0–1: legacy query usage | Complete | Query only data consumed by each legacy screen and its shared navigation. Separate aggregate and execution event-KPI operations; keep the legacy SQL `-1` contract behind the aggregate adapter and reject invalid execution selectors. Per-route query counts, exact resource/parameter binding, populated rendering, and error short-circuit tests pass. Cohort/pagination/typed JSON and measured SSISDB performance remain separate work. |
| B5a | Phase 1: runtime/dependency baseline | Awaiting integration | B5a1 dependency constraints and B5a2 Windows x64/standard CPython 3.14 replay are complete. Native driver/catalog compatibility remains B5a3, deferred to the user's consolidated manual checks after the B milestones. |
| B5b | Phase 1: operational timing | Complete | Structured request/query/error events use server request IDs and safe fields. Synthetic stage/cleanup/cancellation, log-sink, repeated-context, and concurrent-request checks pass, plus a native missing-driver negative probe. The tracked manual checklist covers the user's deferred real-data and hosting checks. |
| B5c | Phase 1: hosting baseline | Planned | Document and verify the startup/server configuration for the chosen deployment target. Split Windows and container delivery into separate tasks when those targets are confirmed; production stream capacity remains phase 5. |

### Runtime milestone decomposition

B5a combines dependency selection, interpreter changes, and native/database compatibility. Keep those as separate reviewable tasks; do not claim runtime completion from a dependency-install check alone.

| ID | Status | Scope and exit condition |
| --- | --- | --- |
| B5a1 | Complete | Published runtime versions were reviewed; the normal requirements command applies exact constraints for the complete eight-package graph. Online resolution, clean offline installation from another working directory, dependency consistency, idempotent resolution, app entry points, and all 77 database-free tests passed on Windows x64/CPython 3.11.4. Python 3.14/native checks remain B5a2/B5a3. |
| B5a2 | Complete | The pinned graph installs on standard CPython 3.14.8/Windows x64 using cp314 wheels. Native modules load, all 77 database-free tests and entry points pass, and repeat installation proposes no changes. Other platform/free-threaded/native-DB claims remain separate checks. |
| B5a3 | Awaiting integration | No test configuration is currently available. At the user's request, document driver/catalog, authentication, row conversion, timeout/resource, and permission checks for manual execution after the B milestones. Keep this gate open until actual results exist. |

## Later phase boundaries

Do not expand a backend foundation task into these phases. Decompose them into concrete submilestones here when implementation approaches.

| Parent phase | Intended slices | Status |
| --- | --- | --- |
| 2: API | Execution-list contract/query semantics first; then metrics/metadata, details/children, events/values/history, and access/redaction checks | Planned |
| 3: first native screen | Shell/build choice, URL filters/list/cards, data-only updates and preserved state | Planned |
| 4: feature parity | Details/children, searchable events, values, history/charts, legacy URL mapping | Planned |
| 5: live updates | Detector prototype/capacity, stream contract, snapshot/resume/resync, bounded subscriptions, browser recovery, production proxy validation | Planned |
| 6: cutover | Prebuilt assets, legacy removal, deployment/CI documentation, load validation, rollback rehearsal | Planned |

## B1 work record

Scope: startup/configuration and legacy presentation registration. Database execution/cleanup, SQL fixes, API resources, production hosting, and streaming are separate milestones above.

Completed locally on 12 October 2026:

- Added `create_app`, moved legacy view/template registration out of global app decorators, and retained all eight URL patterns and endpoint names. Importing the package no longer constructs an application or loads a user configuration file.
- Isolated defaults and mapping overrides between app instances. Monitoring reads configuration from the active Flask app context. Configuration file precedence is explicit; optional root configuration works outside the project directory and loading does not mutate environment variables.
- Removed the unused `distutils` import, defaulted debug to off, and updated the Flask CLI, Visual Studio launcher, and explicit `dashboard.wsgi:app` entry point. The IIS handler now names that entry point; its old interpreter path is still a B5c deployment task.
- Added populated synthetic presentation fixtures and standard-library regression tests. Updated local development instructions and linked this progress log from the roadmap, plan, and README.

Validation environment: Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**. Runtime packages were installed from the existing local wheelhouse; no additional application or test dependency was introduced.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -v` | Passed: 19 tests | Configuration defaults/precedence/failure/isolation, nested app contexts, import/entry-point behaviour, populated legacy templates, links, context helpers, escaping, and static assets; database connections rejected by test guards |
| `python -m flask --app dashboard:create_app routes` | Passed | All eight legacy endpoints plus static serving registered without a database connection |
| `python -m flask --app dashboard/__init__.py routes` | Passed | Legacy Flask app-path discovery still finds the factory |
| `python -m pip check` | Passed | The installed local runtime dependency graph is consistent |

The B1 tests validate application construction and server-rendered HTML, not browser JavaScript or real SQL results. No real SSISDB connection, Windows/SQL authentication, Python 3.14, container, IIS host, production server, or stream integration was validated. At B1 completion, the remaining database/filter/error/runtime work was assigned to B2–B5c and the API phase; later milestone records below track that work separately.

## Workflow baseline coverage

This checklist is the initial P0a coverage. Complete SQL field/semantic parity and real-data evidence remain work for P0a/P0b and the relevant implementation milestones.

| Workflow | Current local evidence | Remaining evidence/work |
| --- | --- | --- |
| Overview, folder/project/status navigation, metrics/timeline | Populated synthetic overview renders; original navigation URLs and filters work; B4 records six required query calls and bound status/name/window/count arguments | Real query results/cohort semantics and timings; aggregate event-KPI adapter is tested locally but not displayed on the overview |
| Execution details, executables, child packages | Synthetic executable and child sections render with status helpers | SQL field parity and repeated/parallel/incomplete child observations |
| Event messages | Synthetic event row renders for all five categories and HTML-like text stays escaped; unsupported categories fail before queries | Real category/filter semantics, bounded querying/search, and event volumes |
| Parameters and property overrides | Both synthetic sections render, including parameter flags | Real typed/sensitive values and endpoint access/redaction rules |
| Duration history | Populated synthetic history/table/chart data renders | History scope/limit/estimate fixes and actual SSISDB results |
| Refresh and browser state | Legacy templates are retained | Legacy full-page refresh remains; in-place updates and stream recovery belong to phases 3–5 |
| Missing pages and DB failures | B2 verifies resource cleanup; B3 covers database-independent routing/static/method errors, missing-execution short circuit, safe HTML/status mapping, and an ODBC timeout through cleanup to HTTP | Actual row visibility, driver/server error states, cleanup, and timeout enforcement need integration evidence; API problem JSON and access controls are later work |

## B2 work record

Scope: SQL resource loading, parameter binding, connection/cursor ownership, and driver-level timeout settings. Preserve checked-in SQL and legacy row shapes. Input/HTTP error policy, query reshaping, and the default KPI execution-filter fix remain B3/B4/API work.

Completed locally on 12 October 2026:

- Added `dashboard/db.py` with package-relative UTF-8/BOM-aware SQL resource loading, flat `.sql` resource-name validation, and a query operation that accepts explicit settings without requiring a Flask context. SQL/parameter preparation happens before connection acquisition.
- Each operation owns a new logical connection and cursor, applies the query timeout before creating the cursor, binds parameters, and attempts cursor/connection closes on success, failure, or cancellation. A failing cursor close still attempts connection closing. Cleanup errors retain the original operation error; if the operation otherwise succeeds, a close failure propagates instead of reporting success.
- Added positive, configurable driver-level login/query timeouts: `DB_LOGIN_TIMEOUT_SECONDS=10` and `DB_QUERY_TIMEOUT_SECONDS=30`. App construction and query execution reject unbounded/invalid settings without echoing their values. The legacy monitor passes the active app's connection/timeouts to the boundary.
- Preserved pyodbc transaction defaults, parameter order, SQL resources, and legacy single/list/empty result shapes. Returned values are not formatted or converted into JSON. The `0`/`-1` KPI mismatch and HTTP/error policy remain scheduled work.
- Added 23 standard-library database-boundary tests and documented the settings and integration limits. No dependency was added. Test-created temporary directories were cleaned after verification.

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 42 tests total (19 B1 + 23 B2) | Fake ODBC covers connect/timeout-setting/cursor/execute/fetch/mapping failures, query/cleanup cancellation, both close failures, primary-error preservation, timeout ordering/validation, distinct resources per call, parameter binding, typed/empty results, Unicode SQL, and execution outside the project directory; the legacy page suite also passes |
| `python -m flask --app dashboard:create_app routes` | Passed | Existing application endpoints register without SQL Server |
| `git diff --check` and SQL-resource diff | Passed | No whitespace errors and no checked-in SQL changes |

These checks validate resource ownership and settings wiring using fake ODBC objects. They do not prove native-driver timeout enforcement, physical connection release/pool behaviour, transaction behaviour against SSISDB, real row conversion, or query performance. Login/query settings are not an end-to-end HTTP deadline. Record those integration results under P0b/B5a before making production claims; the parent backend phase remains incomplete.

## B3 work record

Scope: validation and HTTP failures for the retained legacy UI. Query/cohort reshaping, aggregate KPI correction, API representations, authentication/capability enforcement, and comprehensive timing remain separate milestones.

Completed locally on 12 October 2026:

- Added database-independent validation for case-sensitive execution statuses, the five legacy event categories, the two internal detail categories, and positive SQL Server `BIGINT` execution IDs. Views validate user selectors before constructing the monitor or running a query. Monitor status/event/detail operations also reject unsupported selectors before the query boundary; event/detail SQL names now come from explicit resource maps.
- Replaced the database-dependent 404 template/handler with a standalone HTML error page. Unknown routes and missing static files return 404 without querying the catalog. Unsupported methods retain 405 and its `Allow` header; HEAD errors retain status/headers without a response body.
- Detail, event, and value routes first fetch the requested execution record. An empty visible result returns 404 and runs no subsequent queries. Present records retain legacy rendering and links. No catalog row-visibility inference or browser authorization challenge was added.
- Added safe 400/404/500/503/504 handling. Timeout SQLSTATEs map to 504; selected database connection/login/driver states map to 503; other driver errors remain 500, including SQL programming errors. Responses never echo input/driver diagnostics, SQL, connection strings, or tracebacks. Database/unexpected-error logs contain only safe status/SQLSTATE fields and a server-generated request ID; request/query timing remains B5b work.
- Every response carries `X-Request-ID`; error pages show the same ID and disable caching. Client-supplied IDs are not trusted. Added 22 standard-library regression tests, updated development instructions and the legacy Visual Studio file manifest, and introduced no dependency.

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 64 tests total (42 previous + 22 B3) | Invalid status/event/ID routes reject before monitor creation; fixed resource selection and parameter binding; all supported statuses/categories render; largest BIGINT accepted; missing executions skip subsequent queries; routing/static/405/HEAD errors; safe driver/unexpected failures and logs; unique server request IDs; timeout cleanup before HTTP response and empty fake-ODBC row through 404 |
| `python -m flask --app dashboard:create_app routes` | Passed | All eight legacy endpoints plus static serving retained |
| `git diff --check` and SQL-resource diff | Passed | No whitespace errors and no checked-in SQL changes |

These checks use synthetic monitoring/ODBC objects and do not prove actual SSISDB row visibility, endpoint permissions, deployed driver SQLSTATEs, native timeout enforcement, or production logging/hosting behaviour. Legacy HTML errors are implemented; API problem JSON and access checks remain phase 2, and stream failures remain phase 5. History filter semantics and the aggregate execution sentinel are unchanged and remain assigned work. The parent backend phase remains incomplete.

## B4 work record

Scope: legacy screen query selection and explicit event-KPI operations. Keep the checked-in SQL, time/cohort/name/status semantics, row shapes, and frontend templates intact. API query redesign and native performance measurement remain separate work.

Completed locally on 12 October 2026:

- Removed overview calls for execution info, event KPIs, executables, and children; removed execution-detail calls for engine status cards, the daily chart, and the execution list; removed event/history calls whose results their templates do not consume. Retained folder/project queries where the shared navigation uses them. Values still require both detail queries and event KPI cards.
- Replaced the ambiguous `get_package_kpi()` operation with `get_aggregate_event_kpi()` and `get_execution_event_kpi(execution_id)`. Aggregation binds `-1` only inside the legacy SQL adapter and retains folder/project/start-time filtering across statuses. Execution KPIs require an explicit positive BIGINT ID and bind neutral name patterns, independent of the monitor's selected execution or screen filters. Removed the helper that silently converted an unset execution selection to `0`; other execution resource operations now validate their selected ID before querying.
- Overview status cards continue to use `engine-kpi.sql`; there is no new overview event-KPI card or aggregate query. The aggregate adapter's `0`/`-1` correction is covered as a backend operation. Existing SQL branch semantics, including lower-only aggregate time bounds and execution-specific queries outside the dashboard time window, were not redesigned.
- Added 13 standard-library regressions that render the actual views and monitor over a recorded synthetic query boundary, verify exact resources/parameters/result modes for all eight routes and five event categories, retain visible content/navigation, and check missing/invalid request short circuits. Separate selector checks cover wildcard/Unicode/bound values, the full BIGINT range, aggregate defaults, conflicting screen state, and invalid execution selection. No dependency was added.
- Decomposed the upcoming B5a runtime work into dependency constraints, Python 3.14 validation, and native driver/catalog integration before expanding its implementation scope.

Successful legacy page query calls per request, verified with synthetic boundary traces:

| Screen | Before B4 | After B4 | Preserved data |
| --- | --- | --- | --- |
| Overview and folder/project/status variants | 10 | 6 | Navigation, status cards, daily chart, execution table |
| Execution details | 10 | 7 | Navigation, package information, event KPIs, executables, children |
| Events (all five categories) | 5 | 4 | Package information, event KPIs, escaped messages |
| Values/overrides | 5 | 5 | Package information, event KPIs, both value sections and flags |
| Package history | 5 | 2 | Server header, history table, duration chart |

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 77 tests total (64 previous + 13 B4) | Per-screen query contracts, retained populated rendering, explicit aggregate/execution selection, invalid IDs rejected before query calls, and existing configuration/database/error regressions |
| `git diff --check` and SQL/template diff | Passed | No whitespace errors and no checked-in SQL or frontend-template changes |

The counts describe logical query calls for successful requests; failures may stop earlier. Synthetic traces do not measure SSISDB latency, execution plans, event volumes, native connection pooling, actual row visibility, or aggregate results against SQL Server. SQL cohort fixes and history scope/estimates remain phase 2 work, and real performance evidence remains P0b/B5a3. The parent backend phase remains incomplete.

## B5a1 work record

Scope: reviewed package versions, automatic runtime constraints, clean installation, and development runtime policy. Interpreter upgrades, native ODBC/SSISDB compatibility, production servers, and container modernization remain separate tasks.

Completed locally on 12 October 2026:

- Added `constraints.txt` and included it from `requirements.txt`, so the existing install command applies exact pins without another flag. Flask and pyodbc remain the only direct dependencies; the complete required graph has eight distributions. Optional extras and third-party test tools were not added.
- Reviewed the publishers' metadata/release notes and validated stable updates from Flask 3.1.2 to 3.1.3, Werkzeug 3.1.5 to 3.1.9, MarkupSafe 3.0.3 to 3.0.4, and Click 8.3.1 to 8.5.0. The new Click graph does not require Colorama; it is absent from the clean runtime. Other runtime pins remain the tested versions below. Extended the existing invalid-path regression to cover an overlong decimal execution segment with Python's normal integer-conversion limit; the updated converter returns a database-free 404.
- Created an independent environment under `.local/venv-b5a1`, resolved/downloaded binary wheels from public PyPI into ignored `wheelhouse/`, then installed offline using the tracked requirements. Installation from `.local/` with an absolute requirements path resolved the included constraints correctly. Verified that every installed runtime distribution matched its pin, and repeat resolution proposed no changes. Retained the ignored environment, reports, wheels, and reusable inspection scripts for follow-up checks.
- Documented the current validated Windows x64/CPython 3.11 baseline and the still-pending standard CPython 3.14 target. Documented clean/offline installation, version-review checks, installer/runtime separation, and the limits of version-only constraints. Updated README guidance, the Visual Studio manifest, and Docker's input-copy instruction so both requirements and constraints are present before its install step. The legacy Docker/IIS/Visual Studio interpreter settings remain unsupported hosting work; no container was built.

Pinned runtime distributions:

| Distribution | Version | Role |
| --- | --- | --- |
| Flask | 3.1.3 | Direct |
| pyodbc | 5.3.0 | Direct |
| blinker | 1.9.0 | Required transitive |
| click | 8.5.0 | Required transitive |
| itsdangerous | 2.2.0 | Required transitive |
| Jinja2 | 3.1.6 | Required transitive |
| MarkupSafe | 3.0.4 | Required transitive |
| Werkzeug | 3.1.9 | Required transitive |

Validation environment: Windows x64, **CPython 3.11.4**, **pip 23.1.2**, using `.local/venv-b5a1`. The bundled installer/bootstrap packages are not application pins.

| Check | Result | Evidence |
| --- | --- | --- |
| Online binary-wheel resolution via `pip download -r requirements.txt` | Passed | All eight required distributions resolved to the reviewed pins using public PyPI |
| Clean offline install using `--no-index --only-binary=:all: --find-links wheelhouse` | Passed | Installed from the declared requirements outside the project directory; complete installed runtime graph matches `constraints.txt` |
| Repeat offline install resolution with `--dry-run` | Passed | Installer report contains no proposed package changes |
| `python -m pip check` | Passed | No broken runtime requirements |
| `python -m unittest discover -s tests -q` | Passed: 77 tests | The existing factory/configuration, entry-point, populated template, query/resource, input/error, and per-screen query-contract suite passes with the new dependency snapshot; no live DB connection |
| Flask version/route CLI checks | Passed | Flask 3.1.3/Werkzeug 3.1.9; all eight legacy endpoints plus static serving registered |
| Ignore/status/diff checks | Passed | Environment, wheelhouse, inspection scripts, and install reports remain ignored; no SQL, frontend-template, or application-code changes |

The existing environment's pip 26 download was unresponsive and was interrupted. The fresh environment's bundled pip 23.1.2 completed online resolution/offline checks; its optional update check was disabled for bounded validation commands. The root cause of the older command's delay was not established. All task-owned CLI sessions were closed and no workspace Python process remained after checks.

This snapshot fixes package versions, not wheel hashes, Python patch versions, operating-system libraries, or deployed ODBC drivers. Python 3.14, non-Windows/native integration, actual authentication/row conversion/timeout behaviour, production hosting, and container builds remain unverified. The parent backend/runtime phase remains incomplete.

## B5a2 work record

Scope: standard CPython 3.14 compatibility using the same pinned dependency graph. Real SSISDB/driver behaviour, free-threaded Python, other platforms, and production hosting remain separate checks.

Completed locally on 12 October 2026:

- Downloaded the official standard x64 CPython 3.14.8 NuGet runtime into `.local/`, following the Python project's CI-runtime documentation. Verified a 64-bit `cp314-win_amd64` build with the GIL enabled, plus bundled `venv`/`ensurepip`. Created a new `.local/venv-b5a2` without changing the system Python, PATH, or launcher registrations. The archive, runtime, wheels, reports, and reusable preparation script remain ignored.
- Resolved the same eight runtime pins on the actual 3.14 interpreter. Downloaded `pyodbc-5.3.0-cp314-cp314-win_amd64.whl` and `markupsafe-3.0.4-cp314-cp314-win_amd64.whl`; installed offline from the requirements file while outside the project directory. No source compilation or additional runtime dependency was needed.
- Verified the complete installed graph, native pyodbc and MarkupSafe extension loading, dependency consistency, and repeat installation with no proposed changes. All 77 tests pass, including factory/configuration/import/entry-point subprocess tests, populated legacy pages, fake-ODBC cleanup, safe failures, and per-screen query contracts.
- Verified Flask version discovery and both `dashboard:create_app` and `dashboard.wsgi:app` route discovery. Updated the development guidance to prefer standard CPython 3.14, select the interpreter explicitly, and create a new environment when changing Python minor versions. No application-code, SQL, frontend-template, or dependency-pin change was necessary.

Validation environment: Windows x64, **CPython 3.14.8**, **pip 26.2.1**, Flask **3.1.3**, pyodbc **5.3.0**, using `.local/venv-b5a2`. Runtime source: [official NuGet package](https://www.nuget.org/packages/python/3.14.8); package choice follows [Python's Windows CI documentation](https://docs.python.org/3.14/using/windows.html#the-nuget-org-packages).

| Check | Result | Evidence |
| --- | --- | --- |
| Runtime/ABI/build probe | Passed | CPython 3.14.8, 64 bits, `cp314-win_amd64`, GIL enabled |
| Binary-wheel resolution and clean offline install | Passed | Exact eight-package graph; matching cp314 native wheels; included constraints also resolve outside the project directory |
| Native imports and `python -m pip check` | Passed | pyodbc/MarkupSafe `.pyd` modules load; no broken requirements |
| Repeat install `--dry-run` | Passed | Installer report proposes no changes |
| `python -m unittest discover -s tests -q` | Passed: 77 tests | Same database-free suite on the new interpreter; test-created subprocesses use its executable |
| Flask CLI and factory/WSGI route discovery | Passed | All eight legacy routes plus static serving register through both entry points |
| Ignore/diff checks | Passed | Local runtime/environment/wheels/scripts/reports are ignored; runtime pins and application/SQL/templates remain unchanged |

Native extensions load with this Windows/interpreter ABI; this does not validate a deployed SQL Server driver or real catalog. No SSISDB connection, authentication, actual row conversion, native timeout enforcement, permission visibility, production server, or other OS/architecture/free-threaded Python was validated. At the user's request, B5a3/P0b are deferred to consolidated manual checks after the B milestones; prepare a tracked checklist during B5b rather than waiting for a database configuration now.

## B5b work record

Scope: focused application request/query timing and safe error events, plus the requested consolidated manual checks. Native SSISDB tests remain deferred until the user finishes the B implementation checks; production hosting and stream instrumentation remain separate work.

Completed locally on 12 October 2026:

- Added JSON application events for query completion, request completion, database errors and unexpected request errors. They share the server-generated request ID. Fixed endpoint/resource labels, status/outcome, durations, row counts, query counts and validated SQLSTATEs are recorded; raw input/URLs/headers, SQL/parameters, configuration, credentials, row values and exception text/tracebacks are excluded.
- Added an optional completion observer to the standalone DB operation without introducing a Flask dependency there. Query timing spans acquisition, timeout setup, cursor creation, execution, fetch, mapping and resource cleanup. Success/empty/failure/cancellation and cleanup failures remain distinct; observers run after cleanup, preserve active query/cleanup errors, and do not change outcomes on ordinary observer errors.
- Moved request-ID hooks into the timing boundary, reset counters at each request, and guard duplicate teardown observations. HTTP failures and dispatch cancellation produce safe summaries; manually pushed contexts do not create phantom requests. Tests cover retained and concurrent contexts. Request duration stops at response preparation, not body/network/stream completion.
- Added a validated `LOG_LEVEL` setting, default INFO, for the process-wide application logger. Logging sinks are best effort; a failed sink cannot replace a safe HTTP error. Added 17 standard-library regressions and updated the existing query-contract assertion for the optional observer.
- Prepared [the tracked manual backend checklist](BACKEND_CHECKLIST.md): environment/configuration, driver/authentication/visibility/types, every legacy workflow and query counts, bad input/missing rows, native timeouts and recovery, log correlation/redaction, cold/warm measurements, pooling/cleanup, and pending hosting checks. Each case has steps, expected evidence, and a NOT RUN result field. Known legacy cohort/history/access limitations and separate API/stream gates are explicit.

Validation environment: Windows x64, standard **CPython 3.14.8**, **pip 26.2.1**, the same eight pinned runtime distributions, using `.local/venv-b5a2`.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 94 tests (77 previous + 17 B5b) | Safe JSON fields and IDs, deterministic durations/sums, query failure stages, empty/multi-row shapes, both cleanup attempts, primary-error preservation, cancellation, observer/sink errors, retained/concurrent request isolation, no phantom/double summaries, and all earlier regressions |
| Native Windows driver-manager negative probe | Passed | A confirmed unregistered driver returns IM002/503 before any server connection; three correlated query/error/request events, no credential canary, one failed acquisition. This is not SSISDB/SQL-driver integration evidence. |
| Factory/WSGI registration and diff/ignore checks | Passed | Application endpoints remain registered; no SQL/template/dependency-pin changes; probes/test reports and local runtime remain ignored |

Timing/log transport is best effort and does not impose a total HTTP deadline. SQL preparation is outside query timing; request timing excludes network/body transfer and future stream lifetime. Application-event sanitization does not configure external server/proxy/access/startup logs. Native authentication, data correctness, row visibility, driver timeout enforcement, actual pooling/cleanup, representative performance and chosen-host behaviour remain manual gates in the checklist; none is marked complete here.

Next task: **B5c**, the bounded hosting/startup baseline. Split deployment targets into separate submilestones before implementation as needed. B5a3/P0b stay awaiting the user's consolidated checks after the B implementation work.
