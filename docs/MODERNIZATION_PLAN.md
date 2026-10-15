# ssis-dashboard-next modernization plan

Updated: 15 October 2026. Source audit: 12 October 2026.

Status: implementation in progress; backend foundation largely delivered, read-only API next. [The roadmap](roadmap.md) is the source of truth for scope and frontend decisions.

Track delivered submilestones, validation evidence, and the next bounded code task in [implementation progress](PROGRESS.md). A delivery phase may span several code tasks; the progress log records that decomposition without treating partial completion as phase completion.

Validation update, 15 October 2026: the consolidated [backend checklist](BACKEND_CHECKLIST.md) records **25 of 30 cases PASS**, including the Windows/Python 3.14/native SQL baseline, designed fixtures and both actual Windows reader accounts. [SSIS fixture steps 7–10](SSIS_FIXTURE_PROJECT_GUIDE.md) are complete after 84 additional HTTP requests and 628 passing assertions. Native cleanup-failure observation and raw datetimeoffset compatibility keep their local follow-ups explicit. At the user's request, B5c and all production service/container/proxy/transport/host-log and production stream-capacity work remain deferred. Hosting remains an eventual delivery gate and does not block current local work. The design targets remain unchanged.

## Recommendation

Keep Python, Flask, pyodbc, and the useful SSISDB queries. Turn the backend into a documented, read-only JSON API and replace the existing browser stack with vanilla JavaScript ES modules, semantic HTML, and authored CSS. Use native tables and small SVG charts where practical; chart and table libraries are allowed when their complexity justifies them. Migrate screen by screen, with the old interface available until the replacement covers its workflows and live updates.

**Vite is allowed for development and production builds.** Build assets on the developer machine or in CI and deploy prebuilt files; end users and the running server should not need npm or a build step. Keep third-party runtime dependencies small and deliberate, compare capability, accessibility, maintenance, size, and licensing, and bundle chosen libraries locally. The deployed frontend must make no public internet requests. A backend API does not require a different backend framework or a separately deployed frontend.

**Automatic and manual dashboard updates must update data in place without reloading the page.** Use an HTTP stream, initially SSE; consider WebSockets only when a concrete bidirectional requirement justifies them. Data-only polling is suitable for the first migration screen and as a fallback, but it does not satisfy the production live-update milestone. Vite HMR is a development feature and does not replace monitoring updates.

## Repository and evidence

| Item | Verified state |
| --- | --- |
| Existing fork | <https://github.com/neverIand/ssis-dashboard> |
| Upstream | <https://github.com/yorek/ssis-dashboard> |
| Audited commit | `da7e2f98f5df16b1d9a1b8e184c039adba8c8253` |
| Audit baseline comparison | At the source audit, fork `master` and upstream `master` pointed to the audited commit; zero commits ahead or behind |
| Modernization working branch | `dev-next`; publish to the personal fork's `origin/dev-next` |
| Current architecture | 8 application routes returning Jinja-rendered HTML; suggested JSON routes are commented out |
| Source size | 6 Python modules, 18 SQL files, 11 HTML templates |
| Dependencies | Unpinned `flask` and `pyodbc`; browser libraries vendored directly in `dashboard/static` |
| Browser payload | Base template references 9 local JS files totaling 698,051 uncompressed bytes, including an empty theme JS file; this is a source-size measurement, not network-transfer or performance data |
| Deployment | Python 3.6-era documentation, Ubuntu 16.04 Dockerfile, Flask development server, and an Azure/IIS configuration with a hardcoded Python 3.6 path |
| Tests | No automated application test suite or test CI workflow found |

The repository has full history and an `upstream` remote. The evidence table describes the audited legacy baseline; the project naming and planning documents are subsequent changes. The API, replacement frontend, and production live stream remain planned, not implemented. The source audit did not deploy the application.

Development and publication use the personal fork at `origin` (`neverIand/ssis-dashboard`). The `upstream` remote and `yorek/ssis-dashboard` repository are read-only: **never push to the original repository**, whether through a remote name or an explicit URL. Use `dev-next` as the modernization development base and target only the personal fork when publishing changes.

The audit covered the Python modules, all SQL queries, all page templates, dependency references, and installation documents. Python syntax parsing succeeded. An isolated, database-free check reproduced the default execution-filter mismatch and invalid-status `KeyError` described below. The application was not run against SSISDB: this environment has no supplied database configuration, and Flask/pyodbc are not installed. Query costs, SQL Server compatibility, Windows authentication, and real-data behaviour still require integration validation.

## What must survive the migration

| Workflow | Existing implementation | Replacement |
| --- | --- | --- |
| Browse folders/projects and filter executions by status | `views.py`, menu fragment, `index.html` | URL-addressable filters and API-backed execution list |
| Engine status cards and daily execution chart | `engine-kpi.sql`, `executions-statistics.sql` | Metrics endpoints, status cards, accessible charts with text/table alternatives |
| Execution inspection | `execution-details.html`, executable/child queries | Details view with separate executable and child-package sections |
| All events, errors, warnings, duplicate warnings, memory warnings | Five event queries and `execution-events.html` | Paged event API, search, explicit event-category filters |
| Execution parameter values and property overrides | Two detail queries and `execution-values.html` | Separate values endpoint and view with explicit redaction/access rules |
| Package duration history and estimates | `package-history.sql`, `execution-history.html` | History API and chart; actual and estimated values kept separate |
| Table sorting and pagination | DataTables | Accessible tables with API sorting/pagination; preserve numeric/date semantics; a justified table library is allowed |
| Periodic and manual refresh | Base template reload every 180 seconds | Production HTTP stream and data-only manual refresh; pause/resume, connection/last-updated state, polling fallback, and preserved view state |

The scope remains SSIS Catalog/project deployment and `SSISDB.catalog.*`. Legacy `msdb` package storage, launching/stopping packages, SQL Agent administration, and unrelated PowerShell workflows are outside this migration.

## Issues to fix before relying on the new API

These are source findings, not claims of measured production incidents.

| Priority | Finding and evidence | Planned correction |
| --- | --- | --- |
| First | `processors.py` imports unused `distutils.util.strtobool`; Python removed standard-library `distutils` in 3.12 [1] | Remove the import and verify clean startup on the selected Python version |
| First | `ssis.py` opens a connection for every query; it closes only the cursor on the success path | Introduce explicit connection/cursor ownership, cleanup on exceptions, and connection/query timeouts; do not share a connection between request threads |
| First | Both overview and execution-detail handlers call 10 monitor methods, including data their templates do not use | Load only the resources required by the active screen; keep catalog metadata separate from frequently refreshed execution data |
| First | `package-list.sql` aggregates event messages without restricting the aggregation to the selected execution page | Page/filter executions first for the normal ID/time sort, then retrieve counts for those IDs; benchmark calculated-field sorting separately |
| First | KPI filtering uses `start_time`, the list uses `created_time`, and several queries apply only a lower time bound | Define one explicit execution cohort, use both time bounds, and document any intentional differences |
| First | Python passes `0` for the default execution filter while `package-kpi.sql` expects `-1` for its aggregate branch | Replace magic sentinels with explicit execution-specific versus aggregate operations |
| First | Event queries use unrestricted `fetchall()`, without paging or a deterministic SQL order | Include event IDs; add bounded pages ordered by time/ID, with server-side search and category filters |
| First | Event type is concatenated into a SQL filename; unknown statuses raise `KeyError` | Explicit event/status allowlists and structured HTTP 400 responses; retain parameterized SQL values |
| First | Several queries format timestamps/durations as strings in SQL | Define JSON types, preserve offsets/nulls, and format for display in the browser |
| First | `DEBUG=True`; no application authentication is present; parameter and override pages expose operational information | Default to local-only operation; define authentication/authorization before shared hosting, turn debug off, and protect values/log endpoints |
| Next | `engine-projects.sql` returns duplicate column names, and the row-to-dictionary conversion overwrites them | Give every selected field an explicit, unique alias |
| Next | Name filters use `NVARCHAR(100)` despite larger catalog names; `all`, `%`, `_`, and `*` have ambiguous meanings | Use catalog-compatible lengths, exact names by default, and separate explicit pattern filters |
| Next | History route accepts a status but SQL hardcodes running/succeeded; heading says 15 executions while SQL selects 50; moving average includes the current row | Make history scope/limit explicit and correct labels; implement a documented estimate over prior completed successful runs |
| Next | History estimates divide by an average that may be zero/null and write estimated values into actual end-time/duration fields | Guard missing/zero history and return separate estimate fields |
| Next | Package-history links can inherit broad page filters rather than the clicked row's actual folder/project | Include folder/project/package identity in list DTOs and construct exact history links |
| Next | The 404 handler queries the database and returns a template without an explicit 404 status | Database-independent API/HTML error handling with correct status codes |

Connection cleanup is an ownership improvement; the audit did not prove a persistent connection leak. Similarly, unscoped SQL is a performance risk to measure with actual execution plans, not proof of a particular scan cost.

## Target structure and stack

| Layer | Proposed implementation |
| --- | --- |
| Runtime | Python 3.14 as the initial target; validate the chosen pyodbc wheel and ODBC driver on the actual Windows/server environment before locking it [2] |
| HTTP | Current Flask 3.1 line, application factory, and a small `/api/v1` blueprint [3] |
| Monitoring logic | Functions grouped around listing executions, metrics, events, and history; explicit query inputs and result models |
| SQL access | pyodbc and checked-in, parameterized SQL files; no ORM or additional application database |
| JSON contract | Explicit serializers and validated inputs; checked-in OpenAPI document plus contract tests |
| Browser | ES modules, native DOM/events/fetch/EventSource, authored CSS, accessible tables/charts; justified chart/table libraries bundled locally |
| Build tools | Vite is allowed for development/HMR and production asset builds; deploy prebuilt files [10] |
| Live updates | Read-only SSE stream with shared backend change detection, reconnect/resync, heartbeats, bounded queues, and data-only polling fallback; WebSockets only for justified bidirectional needs [11] |
| Local serving | Same process can serve prebuilt frontend files, the API, and the stream on one origin |
| Shared Windows hosting | Waitress is a Windows-compatible candidate behind the approved authenticated HTTPS reverse proxy; validate stream/thread/proxy capacity before selecting the production configuration [4, 12] |
| Containers | Optional supported base image with Microsoft ODBC Driver 18; verify the exact OS/driver support combination |

Flask already provides JSON responses and works naturally with native `fetch` [5]. Keeping it avoids coupling API extraction to a framework migration. Reconsider FastAPI only if future contract-generation or integration requirements justify it; simply changing frameworks would not resolve the SQL, permissions, or UI concerns identified here.

Use a modest directory split:

| Path | Responsibility |
| --- | --- |
| `dashboard/__init__.py` | `create_app`, configuration, error handlers, blueprint registration |
| `dashboard/api/` | HTTP parsing, authorization, response/status handling |
| `dashboard/monitoring.py` | Monitoring operations and coordination of queries |
| `dashboard/db.py` | Connection lifetime, query loading/execution, row mapping |
| `dashboard/serializers.py` | Stable JSON types and redaction |
| `dashboard/updates.py` | Shared change detection, subscription ownership, bounded notifications/replay, and worker shutdown |
| `dashboard/query/` | Revised catalog queries; retain useful SQL rather than reconstructing it in an ORM |
| `web/index.html`, `web/styles/` | Frontend source shell and authored styles |
| `web/src/` | `app.mjs`, API/stream clients, URL state, formatters, screen modules, and a few shared widgets |
| `web/package.json`, `web/vite.config.mjs` if Vite is selected | Reproducible development/build scripts and same-origin API/stream proxy configuration |
| `dashboard/static/app/` | Proposed location for packaged production assets; the `/app/` shell and asset paths must also work under a URL prefix |
| `tests/`, `docs/openapi.yaml` | Focused regression/contract tests and API specification |

Use ordinary modules and functions first. Create custom elements only where a reusable widget benefits from an independent lifecycle. Start with bounded, paginated tables; evaluate the existing custom datagrid separately if measured requirements call for virtualization. It is not a prerequisite for this migration.

## Frontend modernization and dependency policy

| Current dependency | Replacement and acceptance condition |
| --- | --- |
| jQuery 2.2.4 | `querySelector`, `addEventListener`, `fetch`, `AbortController`; no global `$` |
| Bootstrap 3.3.6 and SB Admin 2 styling | Authored CSS Grid/Flexbox, spacing/colour tokens, semantic forms and responsive layout |
| SmartMenus 1.0.1 | Native folder/project selectors or disclosure navigation with keyboard/focus support |
| DataTables 1.10.0-dev | Semantic tables or a justified, accessible table library, sort controls with correct semantics, bounded server paging, event search; never sort only the visible page while presenting it as global sorting |
| Morris and Raphael | Two focused charts for execution counts and duration history; use authored SVG or a justified chart library, with accessible text/table alternatives and responsive sizing |
| Font Awesome/Glyphicons | Small authored inline SVGs plus readable text labels |
| Google Fonts | System font stack; no font download needed |
| Optional Google Analytics and remote demo badge | Remove from the monitoring app |
| Vendored Flot, legacy IE assets, unused CSS/fonts, empty theme JS | Delete after reference checks and workflow parity |

Browser requirements are current corporate Edge/Chrome; smoke-test Safari and Firefox if they are used. Drop IE compatibility. Keep vanilla ES modules and authored CSS as the default. Vite may provide development HMR and production bundling from the first new screen. Pin any selected tool/library versions, keep a lockfile, and include dependency licenses in release artifacts. Production runs the prebuilt assets rather than the Vite development server [10].

Preserve filters, sorting, paging, scroll, focus, selected execution, and chart state during automatic and manual updates. Abort obsolete fetches and also use a request-generation check so an older response cannot overwrite a newer selection. Coalesce stream notifications and avoid overlapping fetches or fallback polls. Pause work while hidden, resync once on return, and show stale data with a connection/error/retry state instead of clearing useful results. A browser abort does not guarantee SQL cancellation, so database timeouts and query limits are also necessary.

Before adopting a chart/table library, record which required interactions make it useful and compare accessibility, maintained browser support, bundle size, licensing, and teardown/update behaviour. Dependency minimization is a preference, not a zero-library constraint. Remove the obsolete vendored assets only after reference checks and feature parity.

Render catalog names and event text using `textContent`, never database-derived HTML. Keep dates/durations typed until formatting with `Intl`; use English/UK display defaults with a visible timezone. Store only display preferences locally, not event messages or parameter values.

## Proposed API contract

All monitoring operations are read-only `GET /api/v1/...`. JSON resources return data, not HTML fragments or CSS class names; `/stream` instead returns `text/event-stream`. These paths are proposed, not implemented.

| Endpoint | Purpose / principal inputs |
| --- | --- |
| `/meta` | App version, supported status/event codes, display timezone and non-secret limits |
| `/folders` | Visible catalog folders |
| `/projects?folder=...` | Visible projects in a folder, with unambiguous names/IDs |
| `/metrics/summary` | Counts by execution status within folder/project/time scope |
| `/metrics/timeline` | Daily/hourly execution counts with zero-filled buckets and bounded bucket count |
| `/executions` | Filtered, sorted execution page with event counts and logging level |
| `/executions/{id}` | One execution's identity, status, actual timings and event-summary counts |
| `/executions/{id}/executables` | Paged executable statistics |
| `/executions/{id}/children` | Paged child-package observations and timings |
| `/executions/{id}/events` | Paged messages; `kind` selects all, errors, warnings, duplicate warnings, or memory warnings; plus text search |
| `/executions/{id}/values` | Parameter metadata/redacted values and permitted property overrides |
| `/history?folder=...&project=...&package=...` | Exact package history, explicit status scope, bounded count, separately labelled estimates |
| `/stream` | Authorized SSE notifications for the selected monitoring scope; typed change/resync events with resumable IDs, without parameter values or raw log messages |
| `/healthz` and `/readyz` outside the versioned API | Process liveness without a DB query; readiness with a short dependency check |

### Filters and pagination

- Use query parameters for names, including spaces, Unicode, `%`, `#`, and slashes; do not decode them a second time. Names are exact by default. A separate explicit pattern mode can retain the old `*` use case, translating and escaping SQL wildcard characters deliberately.
- Preserve the configurable 360-hour default range initially. API inputs are offset-aware `from` and `to`; use the half-open interval `[from, to)`. Resolve an omitted `to` once and return the effective bounds so the browser can reuse them across list and chart requests. Cap requested ranges, initially at 31 days with an administrator override.
- Use `created_time` for the dashboard execution cohort so created/pending executions remain visible. Status cards intentionally summarize all statuses in the same folder/project/time cohort; the table and timeline apply the selected status. Make this distinction explicit in the API contract and UI.
- Daily buckets use an explicitly configured display timezone, with Europe/London as the proposed default. Implement and test DST boundaries rather than grouping by a timezone-less SQL date. An old `AS_OF_DATE` value becomes the upper bound; it does **not** reconstruct the status of an execution at that historical moment.
- Start with `limit=50`, maximum 200, and deterministic ordering. Use cursor pagination for large execution/event lists, including the sort key and unique ID as a tie-breaker. Bind cursors to filters, direction, and effective time bounds; validate cursor contents and never treat them as authorization.
- Apply bounded pagination to folder/project collections too; the navigation must handle more items than fit on one API page.
- Capture an upper execution/event ID for a paging session to avoid new inserts shifting the page boundary. Live status changes and catalog retention can still change membership: do not describe this as a database snapshot. Offer a data-only refresh action for new data. When an update changes a sort key or filter membership, explicitly invalidate/refetch the affected page and cursors while retaining the user's view preferences; do not silently append rows outside the current paging scope.
- Use a fixed allowlist of sort columns, with correct null/numeric/date handling. Preserve required DataTables sorts; calculated duration/error-count sorts may need aggregation of the filtered cohort before paging and must be measured separately. SQL column/order fragments must never come directly from request text.
- History defaults to the last 50 running/succeeded executions, matching the actual legacy query, with an explicit option to include other outcomes. Fix the label accordingly. Event search applies across the matching execution's events, not just the current page.
- Replace unbounded “All rows” with bounded navigation. Avoid an expensive exact total count on every event poll; return `has_more` and a next cursor. Any bulk export is a later, explicitly bounded feature.

### Representation and errors

- Execution/event/statistics IDs and project LSNs are decimal **strings**, preserving SQL `bigint` precision in JavaScript.
- Timestamps are ISO 8601 values with offsets, normalized to UTC on the wire; missing start/end times remain `null`. Verify native `datetimeoffset` conversion with the chosen driver; use a tested output converter or an explicit offset-preserving SQL conversion if required.
- Durations are numeric seconds; booleans are JSON booleans; counts are numbers. Parameter values keep their SQL type metadata and a display-safe string/null value, avoiding lossy conversion of arbitrary `sql_variant` values.
- Status codes remain numeric with a stable textual name; unknown future codes produce an `unknown` label rather than a server error. Keep executable-result codes distinct from execution-status codes.
- Successful lists use `{ "data": [...], "meta": { "from": "...", "to": "...", "next_cursor": null, "has_more": false } }`. Detail endpoints return an object in `data`. OpenAPI must define actual fields rather than an unconstrained dictionary.
- JSON errors and failures before a stream starts use `application/problem+json` with `type`, `title`, `status`, a safe `detail`, and a request ID. Define 400 invalid input, 401 unauthenticated, 403 denied endpoint capability, 404 absent/not-visible execution, 503 unavailable DB, and 504 query timeout. After stream headers are sent, use a documented safe status/resync event or close the connection rather than attempting to change the HTTP status. Do not return SQL text, connection strings, or tracebacks.
- Return an empty list when a scoped catalog query legitimately has no visible rows. Do not turn every empty result into an authorization error. Failures must remain distinguishable from empty data.

The OpenAPI file is a deliverable of the API phase, not a pretense that the implementation exists today. Extend it with the stream endpoint/media type, and document the SSE event schemas and resume/resync behaviour during the live-update phase. Contract tests should keep validation, serialization, examples, and documentation aligned.

### Production live updates

SSE is the initial recommendation for server-to-browser monitoring notifications. The browser can use native `EventSource`; SSE provides named events, event IDs, reconnect behaviour, and comment heartbeats [11]. This transport does not detect SSISDB changes by itself.

- Start with one shared change-detection loop for each approved database/authorization scope. Perform bounded, timed catalog queries to detect new executions/events **and changes to existing active executions**; a maximum execution ID alone misses status transitions. Do not run a full catalog polling loop for every subscriber, and do not hold an ODBC connection open for a browser stream's lifetime.
- Initially run change detection in a deliberately owned process with explicit start/stop and no duplicate debug-reloader loop. Before using multiple workers, define how they coordinate detection and notifications; process-local queues alone do not provide cross-worker delivery. Add infrastructure only when the measured deployment needs it.
- Prefer small, authorized notifications that identify affected resources. The client coalesces them and refetches only data needed by the active view. Keep log messages, parameter/override values, and connection details out of the stream. Apply endpoint authorization to subscriptions and revalidate access on reconnect or identity expiry.
- Define ordered event IDs, a bounded replay window, and idempotent client handling. Reconnect within the window can resume; an unknown/expired ID, detector restart, retention gap, or queue overflow must trigger an explicit resync. Establish the snapshot/subscription handoff so a change between the initial fetch and stream registration cannot be silently lost.
- Bound queues, replay history, subscriber count, and event size. Coalesce notifications where safe; disconnect or request resync for slow clients. Remove subscriptions and release resources on disconnect, navigation, and process shutdown. Send heartbeats and show connecting, live, reconnecting, paused, stale, and polling states.
- On hidden-tab recovery, reconnect and resync before declaring the view current. Automatic updates and the manual refresh control use data requests and in-place rendering; preserve the documented view state and handle changed paging membership explicitly.
- If streaming is unavailable, use bounded data-only polling with backoff and no overlapping requests. Recover to streaming without running both update loops. An ordinary fetch/polling screen is an intermediate deliverable, not completion of the live-update requirement.

Validate the chosen production server and authenticated reverse proxy for streaming, buffering, compression, idle timeouts, heartbeat delivery, URL prefixes, and concurrent streams. Flask supports streaming responses, but middleware can affect them [13]. Waitress uses a fixed worker-thread pool [12]; long-lived streams need an explicit capacity budget that leaves ordinary API requests responsive. Measure database detection load and browser multi-tab behaviour on the actual stack before finalizing worker/process topology. Consider WebSockets only if bidirectional needs justify the extra server/client lifecycle; they retain the same detection, authorization, bounded-state, and recovery requirements.

## SQL and operational boundaries

Keep using supported `catalog.*` views. Do not modify SSISDB system schemas/indexes or introduce `NOLOCK` as a performance shortcut. Retain parameter binding and improve query shape before adding caches.

First optimize the execution-list/event paths: restrict execution candidates, page them, aggregate event counts for selected IDs, and use conditional aggregation for execution-level KPIs. Evaluate the calendar-generation cross join and push range restrictions down into timeline queries. Load SQL from package-relative resources rather than the process working directory. Explicitly close connections in `finally`/teardown; pyodbc's connection context manager alone is not a connection-closing policy [6].

Child packages are a distinct case: catalog documentation states that Execute Package Task children share their parent's execution instance [7]. Preserve the child view. Validate the existing pre/post-event matching against loops, repeated child packages, parallel tasks, incomplete runs, and missing verbose events; execution path and occurrence matter, not just package name. Report unavailable detail honestly when the SSIS logging level did not record it.

For estimates, start with the most recent five completed successful runs of the exact folder/project/package before the execution being estimated. Return sample count and method alongside estimated duration/end time. Return no estimate for absent/zero history; distinguish observed elapsed time from a forecast. No machine-learning dependency is needed.

Use synthetic fixtures by default for development. A real SSISDB test configuration must live outside git. Introduce reproducible Python dependency constraints, separate dev dependencies, structured request/query timing logs, explicit query/login timeouts, and a supported production server. Retain Apache-2.0 licensing and relevant attribution when replacing vendored assets.

### Identity, sensitive data, and hosting

There are two deployment modes to support deliberately:

| Mode | Identity boundary |
| --- | --- |
| Personal VDI/local use | Bind to `127.0.0.1`; use the configured Windows identity or SQL login to read SSISDB |
| Shared intranet service | Authenticate users at an approved reverse proxy and authorize the audience; use a defined backend SQL identity with the required read scope |

SSISDB catalog row visibility follows the **SQL connection identity**, not automatically the browser user [7]. A shared service account means viewers can potentially access everything that account can read. Initially support a deliberately approved common reader scope for shared hosting. If different users need different folder rights, require explicit application authorization on every endpoint, or a separately designed delegated-identity model. Merely enabling Windows authentication in IIS does not solve SQL identity delegation.

Only trust identity/proxy headers from the configured proxy, and prevent direct access that bypasses it. Keep frontend and API on the same origin; do not enable wildcard CORS. Any cache must include the authorization scope in its key. Start without a cross-user result cache.

The catalog parameter view already returns NULL for `sensitive=1` [8]. Preserve that protection and also enforce serializer-level redaction with a `redacted` marker. Apply explicit access/redaction rules to property overrides and free-text logs, which can contain operational secrets without a corresponding sensitive flag. Default to hiding unapproved override values; enabling their display requires a deliberate deployment policy. Never log parameter values or connection strings, and use `Cache-Control: no-store` for values/events.

Plan ODBC Driver 18 as a deployment change, not just a driver-name substitution: encryption defaults changed in 18 [9]. Configure certificate trust and hostname matching explicitly. Use `Encrypt=yes;TrustServerCertificate=no` for the normal deployment; do not make certificate-validation bypass the blanket migration fix. `DATABASE=SSISDB` remains explicit.

## Delivery phases

Use reviewable commits on `dev-next`, or feature branches/PRs against that development base at the listed functional boundaries, within the personal fork only. The effort ranges are planning estimates for one developer with working SSISDB access; they exclude organizational provisioning and approval lead time.

| Phase | Changes and deliverables | Exit condition | Rough effort |
| --- | --- | --- | --- |
| 0. Baseline | Record workflow/field behaviour, create synthetic fixtures, document intended semantic fixes, capture real test-DB query timings and execution plans | List, metrics, events, values, history, and children have a parity checklist; known bugs are distinguished from intended behaviour | 1–2 days |
| 1. Backend foundation | Supported Python/dependency constraints, app factory, configuration, query/connection ownership, input/result types, correct errors, default-local hosting | App starts cleanly; unit tests run without SQL Server; failures close resources; existing UI can use the refactored layer through a legacy presentation adapter | 2–3 days |
| 2. API | `/api/v1` resources and OpenAPI, paging, typed serialization, fixed cohort/query semantics, authorization/redaction boundaries | Contract and SQL integration checks pass; queries remain read-only; API is useful without the new UI | 3–5 days |
| 3. First native screen | Source shell under `/app/`, native navigation/filters, execution list, status cards, data-only polling/state/error handling; Vite/build setup if selected | One complete working path: filter → list → execution link; automatic/manual updates preserve state without page reloads; no obsolete browser libraries; any selected libraries are justified and bundled locally | 2–3 days |
| 4. Feature parity | Details, executables/children, searchable events, values, history and both charts; legacy URL mapping | All baseline workflows work; keyboard/responsive behaviour, table/chart choices, and refresh stability are checked | 4–6 days |
| 5. Production live updates | SSE endpoint and event contract, shared detection, snapshot/resume/resync, heartbeats, bounded queues, subscription cleanup, hidden-tab recovery, connection status, polling fallback, proxy/worker validation | A production stream works behind the intended authenticated proxy; reconnect/restart/overflow recovery passes; ordinary API traffic and DB load remain acceptable; all updates preserve view state | 3–5 days |
| 6. Cutover | Default to new UI, remove Jinja UI/legacy assets, package prebuilt frontend files, update Windows/container docs, CI and rollback instructions | No obsolete browser assets or public internet requests; clean production build/install and representative SSISDB/stream load pass; previous release remains deployable | 2–3 days |

Total original planning range: **17–27 developer days** for a tested replacement including production live updates. These original ranges are not a remaining-work estimate. The first usable list/filter screen should arrive earlier, after the foundation and initial API work. Re-estimate API effort after the contract, native timestamp solution and first measured paged query; re-estimate production work after hosting is reprioritized and the stream prototype is measured.

The next active stage is **Stage C / delivery phase 2: the read-only API**. Its [tracked task breakdown](PROGRESS.md#stage-c--read-only-api-delivery-phase-2) starts with C1a, the explicit contract and local access policy; C1b resolves typed/native timestamp conversion; C1c adds the common HTTP boundary; C2a delivers `GET /api/v1/executions`. Preserve the legacy presentation adapter throughout. Keep native cleanup-failure observation open without blocking unrelated API work; do not represent the formatted legacy timestamps as proof of typed datetimeoffset compatibility.

After C1, C2a and the C3a/C3b navigation/summary slices pass local contract and SQL checks, phase 3 can deliver the first native filter/list/cards screen and link to existing execution details. Required global sorts remain C2b; timeline, remaining inspection resources, events, values, history and API-wide acceptance remain explicit Stage C work. This early screen does not complete phase 2, feature parity or live updates. Production hosting/proxy/capacity work stays deferred; phase 5 still requires a validated production stream when hosting resumes.

### Coexistence and rollback

- During phases 1–5, keep legacy routes and `/app/` side by side. Use a legacy adapter for old formatted field names while the API receives typed DTOs; changing SQL values globally without adapting templates would break the old interface.
- Introduce a configuration switch for the default landing page. Preserve legacy bookmarks through explicit redirects or route translation once the new paths are complete.
- Deploy to a separate local/test binding first; compare the same scope and recorded time bounds against trusted SQL results. Any differences caused by intentional bug fixes must be listed.
- Retain the previous application version and its dependency environment for rollback. Do not remove the old version's files/env in place at cutover.
- The migration requires no SSISDB schema changes, so application rollback does not require database rollback. Reverting to the legacy version should remain limited to its existing approved exposure while its known issues remain.

## Validation that matters

| Area | Essential checks |
| --- | --- |
| Query semantics | Range upper/lower bounds; created vs started; created/pending/running/failed/succeeded; exact names and deliberate wildcards; same package name in different projects/folders |
| JSON contract | Bigint above JavaScript's safe-integer range, nullable end time, offset timestamps/DST, numeric duration, unknown status/logging codes, boolean/redacted parameters |
| Events/history/children | Stable page ordering, category counts vs filtered messages, text search, duplicate timestamps, zero-history estimates, repeated/parallel child invocations, low logging levels |
| Failure handling | Unknown endpoint/event type/status, missing/not-visible execution, DB disconnect, timeout, permission-limited identity, cleanup after exceptions |
| Browser behaviour | Back/forward/deep links, keyboard navigation, numeric/date sorting, stale-response races, no overlapping polls, refresh preserves focus/scroll/filters, readable narrow layout |
| Live updates | Real production stream through the intended proxy; existing-execution status changes, snapshot/subscription races, reconnect/replay/resync, detector restart, slow-client/queue overflow, heartbeats, identity expiry, hidden-tab recovery, multi-tab limits, fallback/recovery, subscription cleanup, and preserved paging/chart state |
| Rendering safety | HTML-like event text remains text; secrets are absent from responses/logs/caches; no external fonts/scripts/analytics |
| Performance | Compare real DB elapsed time/logical reads and HTTP payloads for the same workload; bounded rows/DOM/queues; detection queries shared across subscribers; concurrent streams leave API capacity; repeated updates do not accumulate connections/listeners |
| Deployment | Fresh install of prebuilt assets, reproducible production build if Vite is selected, bundled libraries/licenses, Windows ODBC certificate/authentication, correct SSISDB connection, stream/proxy/worker configuration, optional container path, non-root URL prefix, rollback rehearsal |

Use Python tests with a fake query boundary for most cases and a separately enabled real SSISDB integration suite. A plain SQL Server container is not a substitute for an SSIS Catalog with representative executions. Use build tools and the browser test runner as **development dependencies**; selected runtime chart/table libraries are allowed and must be bundled locally. Exercise update/recovery behaviour with a synthetic detector, then validate the actual SSISDB detection loop and production proxy separately. Keep fixtures synthetic/sanitized and out of production secrets.

Proposed initial performance budgets, to confirm after baseline: 50-row execution page p95 below 1 second on the test network, no more than 200 rows per list response, and authored frontend JS+CSS below 150 KiB uncompressed. Also record the complete payload, including any selected libraries. Define live-update latency, detection-query frequency/load, replay/queue limits, and concurrent-stream/API capacity budgets after the stream prototype. These are acceptance targets, not results measured in this audit. Measure expensive calculated-field sorts separately and adjust targets deliberately if the real catalog warrants it.

## Decisions to confirm before deployment

Planning can proceed with the defaults above. Before a shared deployment, confirm only the decisions that change implementation:

1. Is the first release personal/local, or a shared intranet service? Local is the initial development default.
2. For shared use, can all viewers share one approved SSISDB read scope, or must visibility differ by user?
3. Which SQL Server/SSIS version and ODBC authentication mode must the first release validate? Use the actual test environment; SQL Server 2022 is a reasonable first test target, not an already verified compatibility claim.
4. Does the deployed local copy contain custom changes absent from the audited legacy baseline? That baseline matched upstream; `dev-next` intentionally diverges. Compare any deployed copy before replacing it.
5. Which authenticated proxy, concurrent-viewer count, and worker/process topology must the production stream support? Validate buffering/timeouts and retain ordinary API capacity before shared deployment.

## Primary references

Repository observations refer to the audited commit above, particularly `dashboard/views.py`, `dashboard/ssis.py`, `dashboard/query/`, `dashboard/templates/`, `requirements.txt`, `Dockerfile`, and the legacy roadmap. The current [roadmap](roadmap.md) governs this plan: vanilla ES modules/authored CSS, permitted Vite and justified chart/table libraries, in-place updates, and a resilient production stream.

1. Python: [distutils removal](https://docs.python.org/3/library/distutils.html).
2. Python: [supported version status](https://devguide.python.org/versions/).
3. Flask: [application factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/).
4. Flask: [Waitress deployment](https://flask.palletsprojects.com/en/stable/deploying/waitress/).
5. Flask: [JavaScript, fetch, and JSON](https://flask.palletsprojects.com/en/stable/patterns/javascript/).
6. pyodbc: [connection lifecycle and timeouts](https://github.com/mkleehammer/pyodbc/wiki/Connection).
7. Microsoft: [catalog.executions and its permissions](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-executions-ssisdb-database?view=sql-server-ver17).
8. Microsoft: [execution parameter values and sensitive-value handling](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-execution-parameter-values-ssisdb-database?view=sql-server-ver17).
9. Microsoft: [ODBC connection keywords and encryption](https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute?view=sql-server-ver17).
10. Vite: [production builds and public base paths](https://vite.dev/guide/build.html).
11. MDN: [server-sent events, event IDs, reconnect, and heartbeats](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).
12. Waitress: [worker and connection design](https://docs.pylonsproject.org/projects/waitress/en/stable/design.html).
13. Flask: [streaming responses and middleware considerations](https://flask.palletsprojects.com/en/stable/patterns/streaming/).
