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
| B5a | Phase 1: runtime/dependency baseline | Planned | Deliver B5a1–B5a3 below: reproducible dependencies, Python 3.14 validation, then driver/catalog compatibility. Keep local evidence separate from integration evidence. |
| B5b | Phase 1: operational timing | Planned | Add focused request/query timing and safe error logging without exposing SQL parameters, credentials, or connection strings; verify representative success/failure paths. |
| B5c | Phase 1: hosting baseline | Planned | Document and verify the startup/server configuration for the chosen deployment target. Split Windows and container delivery into separate tasks when those targets are confirmed; production stream capacity remains phase 5. |

### Runtime milestone decomposition

B5a combines dependency selection, interpreter changes, and native/database compatibility. Keep those as separate reviewable tasks; do not claim runtime completion from a dependency-install check alone.

| ID | Status | Scope and exit condition |
| --- | --- | --- |
| B5a1 | Planned; next | Choose and document a runtime/version policy and reproducible dependency constraints with minimal dependencies. Validate installation from the declared files in an isolated ignored environment, dependency consistency, factory startup, and the database-free suite. Record the interpreter actually used. |
| B5a2 | Planned | Validate the Python 3.14 target and compatible pyodbc binary/runtime dependencies. Recreate an isolated environment, run the full database-free suite and entry points, and document unsupported/unverified platforms rather than extrapolating from one platform. |
| B5a3 | Planned | With P0b's approved test configuration, validate deployed ODBC driver/catalog compatibility, authentication, row conversion, timeouts, and resource behaviour. Record the actual combination and keep this integration gate open until evidence exists. |

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

Next task: **B5a1**, make dependency installation reproducible and document the runtime policy. Python 3.14 replay and native driver/catalog checks are separate B5a2/B5a3 tasks.
