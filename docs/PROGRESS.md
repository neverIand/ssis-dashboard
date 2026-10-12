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
| B2 | Phase 1: database query boundary | Planned; next | Move SQL loading/execution behind a small operation boundary; use package-relative query resources, explicit connection/cursor closing on success/failure, and login/query timeouts. Verify with fake ODBC resources, including execute/fetch failures and non-project working directories. Preserve existing row shapes and SQL semantics. |
| B3 | Phase 1: inputs and errors | Planned | Validate event/status/detail inputs; return correct HTTP statuses; make 404 handling independent of SSISDB; keep database details and secrets out of client errors. Add error-path regression tests. |
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

The tests validate application construction and server-rendered HTML, not browser JavaScript or real SQL results. No real SSISDB connection, Windows/SQL authentication, Python 3.14, container, IIS host, production server, or stream integration was validated. The remaining database/filter/error/runtime work belongs to B2–B5c and the API phase; B1 does not mark those issues fixed.

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
| Missing pages and DB failures | Application error-handler registration is retained | Database-independent 404/status policy in B3; resource/error cleanup in B2 |

Next task: **B2**, the database query/resource boundary. Keep its scope to connection ownership, timeouts, package-relative query loading, and legacy row compatibility; defer query reshaping and HTTP error policy to their own tasks.
