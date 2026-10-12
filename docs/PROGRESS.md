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
| B3 | Phase 1: inputs and errors | Planned; next | Validate event/status/detail inputs; return correct HTTP statuses; make 404 handling independent of SSISDB; keep database details and secrets out of client errors. Add error-path regression tests. |
| B4 | Phases 0–1: legacy query usage | Planned | Stop loading resources unused by the active screen; separate aggregate and execution-specific KPI calls and fix the `0`/`-1` mismatch. Record deliberate behaviour changes and test exact query arguments. Cohort/pagination/typed JSON changes belong to the API phase. |
| B5a | Phase 1: runtime/dependency baseline | Planned | Select and constrain Python/dependency versions and validate the Python 3.14 target, pyodbc wheel, and required driver combination. Record local versus integration evidence. |
| B5b | Phase 1: operational timing | Planned | Add focused request/query timing and safe error logging without exposing SQL parameters, credentials, or connection strings; verify representative success/failure paths. |
| B5c | Phase 1: hosting baseline | Planned | Document and verify the startup/server configuration for the chosen deployment target. Split Windows and container delivery into separate tasks when those targets are confirmed; production stream capacity remains phase 5. |

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
| Overview, folder/project/status navigation, metrics/timeline | Populated synthetic overview renders; original navigation URLs and filters work | Real query results/cohort semantics; unused query removal and KPI aggregate fix in B4 |
| Execution details, executables, child packages | Synthetic executable and child sections render with status helpers | SQL field parity and repeated/parallel/incomplete child observations |
| Event messages | Synthetic event row renders and HTML-like text stays escaped | Category/filter semantics, bounded querying/search, invalid-input handling, and real event volumes |
| Parameters and property overrides | Both synthetic sections render, including parameter flags | Real typed/sensitive values and endpoint access/redaction rules |
| Duration history | Populated synthetic history/table/chart data renders | History scope/limit/estimate fixes and actual SSISDB results |
| Refresh and browser state | Legacy templates are retained | Legacy full-page refresh remains; in-place updates and stream recovery belong to phases 3–5 |
| Missing pages and DB failures | Application error-handler registration is retained; B2 fake-ODBC tests cover resource ownership and timeout wiring through failure paths | Database-independent 404/status policy in B3; actual driver/server cleanup and timeout behaviour need integration evidence |

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

Next task: **B3**, validated inputs and HTTP error handling, including database-independent 404 responses. Keep SQL reshaping and aggregate KPI corrections in their assigned tasks.
