# Modernization plan

[The roadmap](roadmap.md) defines scope. [Progress](PROGRESS.md) owns milestone status and open gates; [API semantics](API_CONTRACT.md) and [OpenAPI](openapi.yaml) own the interface. This document records architectural decisions and future delivery boundaries.

## Architecture

Keep Python, Flask, pyodbc and useful checked-in SQL. Serve a read-only API and prebuilt browser assets from the same application origin. Organize functions around operations; introduce a class only when its state and lifecycle belong together. No ORM, extra application database or framework migration is required.

| Boundary | Responsibility |
| --- | --- |
| `dashboard/__init__.py`, `config.py` | Application construction and private configuration |
| `api.py`, `api_validation.py`, `errors.py` | HTTP inputs, capabilities, safe response/status handling |
| `frontend.py`, `templates/app/` | Native shell, validated packaged-entry assets, prefix-aware bootstrap URLs and build-failure response |
| `executions.py`, `navigation.py`, `metrics.py`, `timeline.py`, inspection/event/value/history modules | Resource-specific query coordination and DTO assembly |
| `db.py`, `query/` | Bound SQL, timeout settings and ownership of each connection/cursor |
| `timestamps.py`, `serialization.py`, `cursors.py` | Exact typed data, explicit JSON primitives and authenticated paging state |
| `ssis.py`, `views.py`, templates | Retained legacy presentation adapter |
| `web/` and `dashboard/static/app/` | Browser source/build inputs and ignored generated assets included in prepared deliveries |
| `web/src/api.js`, `bootstrap.js`, `display.js` | Same-origin requests and safe errors; metadata startup lifetime; typed display without changing wire values |
| `web/src/selection.js`, `filters.js` | Exact selection validation, immediate folder/project scope and draft/applied filters; table order, popovers, history and teardown |
| `web/src/catalog-search.js`, `navigation.js` | Cancellable search across bounded catalog pages, navigation DTO checks and explicit continuation/retry |
| `web/src/range-editor.js`, `time-range.js` | Calendar/exact-bound editing, configured-zone conversion, DST resolution and server-anchored presets |
| `web/src/overview.js`, `render-overview.js` | Current overview request generation, exact-bound resource sequencing, typed response checks and native DOM presentation |
| Future update detector/stream modules | Change detection, subscription ownership, bounded notifications and shutdown |

The initial mode is loopback under one configured SQL identity. Browser identity headers cannot select that identity. Separate query connections own their resources and use live catalog observations; a cursor is not a database snapshot. Read-only catalog access may create connection-local temporary tables; it must not modify SSISDB system objects or data.

## Data and legacy boundary

Keep the legacy adapter alongside the new API until replacement-screen parity. The API corrects mixed time cohorts, wildcard sentinels, formatted string types and unbounded reads; these corrections do not silently change the legacy parity baseline. Preserve actual NULL timings and unknown numeric codes. Child invocations are observations, and estimates remain separate from actual timing. [API semantics](API_CONTRACT.md) owns the detailed rules; [the operation matrix](API_ACCEPTANCE.md#operation-matrix) checks them.

## SQL and resource decisions

Ordinary execution sorts must seek/select the bounded page before metadata, logging and event enrichment. Global calculated sorts may calculate keys over the whole cohort; prefer narrow working rows where measurement supports it. Keep event aggregation isolated from unrelated joins. A bounded result does not bound source scans, repeated-key windows, permission checks or history-source growth.

Current measured choices—narrow calculated cohorts, cached ID selection/logging and constrained event join order—are recorded with their tradeoffs in [the SQL remedy results](API_ACCEPTANCE.md#c82b3-execution-query-remedies).

Validate source and temporary scans, actual rows, logical/LOB reads, materializations, spills, compilation, response size and elapsed time under representative identities. Retain verified reductions in work despite noisy small-catalog latency unless they cause a material regression or disproportionate complexity. Apply RECOMPILE only to query shapes with measured justification. Do not modify system indexes, use internal-table permission shortcuts, introduce NOLOCK or hide unmeasured work behind a result cache. [The workload protocol](API_ACCEPTANCE.md#workload-protocol) defines comparable measurements.

Preserve parameter binding, exact 100-ns timestamps, BIGINT strings and explicit serializers. Typed calls use the connection-local datetimeoffset converter; bind `sql_timestamp()` strings with `CONVERT(datetimeoffset(7), ?)` to preserve the seventh digit. Opt into explicit NULL binding with `declared_parameters=True` only when SQL declares every input type; retain legacy defaults for legacy queries. Each query closes cursor and connection, attempts both closes after failure, and records safe metadata after cleanup. Browser cancellation does not guarantee native SQL cancellation; driver timeouts and request/resource tests remain necessary.

## Frontend and dependency policy

Use vanilla ES modules, native DOM/events/fetch, semantic HTML and authored CSS. Vite is allowed for development and builds; additional chart/table libraries require a demonstrated benefit in interaction, accessibility, maintenance, size and lifecycle behavior, with licensing reviewed. Pin tools and bundle dependencies locally. Production makes no public font/script/analytics requests. Keep labels concise and pages functional, without decorative copy or animation.

`web/` owns source and locked build inputs; only ignored `dashboard/static/app/` is generated/emptied. Prepared application deliveries include that complete output and require no Node/npm at runtime. The Flask shell rereads the manifest, validates referenced assets and uses prefix-aware static/application/API bases with relative asset imports. Shell rendering performs no SQL; an invalid/missing build returns a safe 503 without disabling legacy/API/health routes. [Installation](installation.md#build-the-browser-assets) owns commands, runtimes and packaging checks; [the roadmap](roadmap.md#acceptance-budgets) owns enforced size ceilings.

Successful native overview/detail shells enforce `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. Use external same-origin scripts/styles, a non-executable JSON configuration block, text-only DOM writes and CSSOM position updates. Guards reject executable inline content, HTML injection sinks and dynamic execution. Legacy pages and the shared 503 fallback keep framing-only CSP; Fetch Metadata isolation, `nosniff` and `X-Frame-Options: DENY` still apply. Shells remain `no-store`. Only successful/partial/conditional `/static/app/assets/*` responses receive immutable one-year caching; unhashed files, errors and aliases escaping that directory keep their existing behavior.

Shared request helpers permit only same-origin GETs inside the configured API base, reject redirects, use same-origin credentials/no-store and validate envelopes, consumed fields and request IDs. Display only fixed safe errors; never expose raw driver/server diagnostics. Metadata owns limits, statuses, sorts, capabilities and display timezone; invalid settings stop startup. Its separate bootstrap owner coalesces starts, uses a 10-second deadline and offers manual Retry. Disposal cancels work and rejects late generations; retained-document return creates a fresh settings owner.

### Native loading geometry (UX batch F part 1)

Reserve header/status and loaded table/chart geometry during replacement, retaining accessible loading/error states. Use keyed rows/disclosures and current-focus/scroll preservation; do not reclaim focus after the user moves it. G/H supersede F1's fixed feedback-slot presentation. Geometry must be checked in a browser, not inferred from DOM structure tests.

### Native layout density (UX batch G)

The current shared design uses Soft grey light/dark tokens in `styles.css`, system fonts, restrained status colours with text labels, compact controls and no styling dependency. System follows the OS; explicit Light/Dark is the only persisted preference (`sd-theme`). A same-origin classic `theme-init.js` applies the stored choice before paint, and cross-tab preference changes stay synchronized. Content can widen to 120 rem; narrow layouts retain internal table/tab scrolling rather than document overflow.

Overview has compact scope/filter controls, linked summary counts, one table pager and the optional timeline below its toggle. Detail has scoped breadcrumbs, an entry-package/ID/status heading, one summary strip and one active section tab. Shared toolbars carry section status and Retry; described tips and disclosures preserve definitions/exact content. Fixed-layout disclosure tables bound open text to `min(18rem, 50vh)` with keyboard scrolling; History uses nowrap columns and internal scrolling. [Usage](installation.md#run-locally) owns control instructions and [frontend acceptance](FRONTEND_ACCEPTANCE.md) owns geometry/keyboard/theme procedures.

### Overview state and refresh

Organize modules around shared operations and lifetime, not a domain class hierarchy. `overview.js` owns applied selection, effective bounds, cursor paths, data requests and generations; renderers own DOM projections. `refresh-loop.js` owns one schedule and observes completed cycles without making data requests.

Keep draft filter inputs, applied selection and display preferences separate. Shareable URLs contain validated selection/sort/limit and relative preset tokens only. Exact catalog names are neither trimmed nor normalized; omitted scope means all, while a literal `all` remains selectable. Canonical names live in the selection session because single-line inputs can strip characters. A folder change clears its dependent project; exact row links set both names together. Status commits on Done/outside/Tab close, Escape discards its draft, presets apply immediately and custom dates use Use range. Reset keeps scope/order. Invalid URLs clear the view and expose an explicit reset.

Catalog pickers are lazy and independently cancellable. Browse at metadata `default_limit`; debounced search scans at `max_limit` within `20 * default_limit` rows per action, rounded to whole pages. Partial results require explicit continuation. Project browsing requires a folder, while exact-name entry can span folders. Each request has a 15-second deadline; close/replace/dispose aborts it and rejects late results. Expiry requires a manual restart and denial clears choices. Continuation focus respects user movement.

Created bounds use the configured display timezone. Date-only ranges include both dates; timed upper bounds are exclusive. Reject DST gaps and require explicit repeated-time occurrence. Preserve untouched exact offsets/seven fractional digits and track edits per bound. Relative `created=24h|7d|30d|today` uses a metadata/list server anchor plus monotonic elapsed time, not client wall time or an extra metadata read per cycle. Custom/bookmarked bounds stay absolute; omitted bounds retain server-default semantics.

A normal overview cycle serially reads executions, all-status summary and the timeline only when open. The list supplies exact effective `from`/`to`; cards use those bounds but ignore the selected status. Timeline uses the list's folder/project/status and bounds, without list order/limit/cursor. These are live observations, not one atomic database snapshot. Each overview request has a 30-second deadline. Execution failure prevents subsequent reads; summary failure is independent and may still be followed by the timeline. Summary Retry rereads summary and an open timeline without another list.

| Trigger | Page/window behavior |
| --- | --- |
| Selection/order/size change | Clear old data/cursor paths and start page one; reject every obsolete generation. |
| Refresh page one | Re-resolve default/relative bounds; retain explicit bounds. Establish a new upper fence and rebuild continuations. |
| Refresh/visit a later page | Replay its entry cursor and original exact bounds/fence; preserve page view. Changing catalog rows still are not a snapshot. |
| Previous to page one | Relative presets re-resolve; other selections retain their bounds. Rebuild the forward path. |
| Expired/invalid cursor | Explain one first-page reset. Further failure waits for action; an empty retained page still offers backward/first navigation. |
| Fresh reload/navigation | Restore URL selection and start page one. |
| Proven retained-document return | Revalidate metadata, refetch the saved path, then restore pause/view anchors. Keep at most eight recent paths in memory. |

All sorts remain global API sorts with stable ties; pages are bounded and never locally reordered to simulate global sorting. Metadata controls available orders/sizes, including valid nonstandard URL limits. Summary links select statuses; Total clears status and Other selects supported remaining codes. Loading controls preserve focus/targets while the owner rejects disabled activation; removing a focused Other link falls back to Total.

Manual refresh, polling and eligible visible return use the same non-overlapping owner. Schedule after the entire cycle, with delay `min(300000, max(30000, ceil(cycle_ms * 5), failure_backoff_ms))` and transient backoff 30/60/120/240/300 seconds. Success resets failures; nonretryable errors stop automation. Manual work replaces the timer; repeated activations coalesce. User pause survives selection changes and keeps manual refresh available. Hidden documents schedule no new cycle; active work may finish. Visible return requests one resync, coalesced with initial/restored work or queued after active work; pause/nonretryable stopping wins. Dispose requests/listeners/timers together on `pagehide`.

Retain labeled prior observations only for transient failures in the same authorized scope. Changed selection/bounds clear incompatible data; malformed resource data clears the affected resource, and 401/403 clears the overview and cursor paths. Render exact IDs/timestamps as display projections only; distinguish NULL, zero, unknown codes, actual duration and observed active elapsed. Refresh patches keyed rows and preserves completion-time scroll/current focus, with a table-region fallback when a focused row disappears.

The optional timeline consumes server-defined contiguous UTC/calendar buckets, timezone/DST/partial edges and zero filling; it never invents boundaries or silently downgrades an excessive Hour request. UTC-start-keyed SVG stacks show succeeded/failed/other, with actual-start counts in the full table alternative. Selection/keyboard inspection is local; grain changes make one owned request. Preserve same-grain selection, including intentional empty buckets; initial/grain-change fallback is the latest nonempty bucket. Closing aborts only timeline work and rejects late results. Same-cohort transient errors may retain labeled counts; malformed/400 clears the timeline. Checkpoints contain open/grain/selection/view anchors, never payloads; chart choices/results stay out of URL/history/storage.

## Native execution detail and section ownership

`/app/executions/{id}` is an explicit database-free Flask shell using the shared build/startup boundary and a validated decimal-string ID. It loads metadata, then the authorized base execution independently of overview dates/status. Overview links open native detail; Legacy detail remains explicit. `mountBootstrap` owns settings/status; detail has its own coordinator rather than hidden copies of overview controls. [Progress](PROGRESS.md#phase-4--native-execution-workflows) records local delivery and separate gates.

Supported legacy `?native=1` entry is translated after browser isolation and before legacy handlers/SQL. It generates prefix-safe temporary redirects; unsupported input gets a database-free 409 with explicit choices. Native visibility/capabilities still govern arrival. No automatic legacy fetch or default-homepage switch is authorized. [Parity](FRONTEND_PARITY.md#p47b-translation-contract) owns exact mapping, input and fallback rules, including the unsupported independent-history route.

One detail owner groups execution ID, generation, authorized base observation, section state and refresh lifetime. An ID change cancels/clears the old view; late success/error/denial cannot affect the replacement. Base loading gates follow-ups. Missing/hidden/denied base or execution-scoped 404 clears the execution and stops automatic retries. A section denial clears that section; a global history 404 does not invalidate the base. Malformed responses are not stale-success evidence. Transient errors may retain labeled observations only within the same authorized execution/section scope.

The active permitted tab is Events, Executables, Package calls, Parameters, Overrides or History. Normal refresh performs base then that section only (two serial reads); tab/page/sort/search/Retry actions use their existing section request. Disabled tabs expose concise policy information and send zero reads. Each section owns query/cursor/view state, while the detail owner queues replacements behind base work or cancels obsolete section work. Tables have no timers or transport owners.

A successful base read with non-null `ended_at` lets the current cycle finish, then disables interval/backoff/visible-return refresh and Pause/Resume. Manual Refresh and section actions remain available. Failures retain the last terminal state; a later successful running read restores eligibility and the user's prior pause. Reload/cache return refetches before deciding; terminal/data state never enters the checkpoint. Overview polling remains independent.

Public fragments encode the active tab/event category only. A valid available fragment wins; otherwise failed execution defaults to permitted Events/Errors, then Executables. Tab/category changes replace history rather than adding Back entries. Count links select categories and clear event search; unavailable Events never receives speculative requests. Explicit deep-link/count arrival may reveal/focus the tab once; ordinary refresh must not move focus. Available tabs support roving keyboard navigation.

`table-order.js` owns supported header/size view operations. `section-table.js` shares control/Retry state, keyed reconciliation, status/empty rendering, focus/scroll/disclosure restoration and disposal across the four renderers. Adapters retain section-specific cells, filters and focus policies. `createDetailLoader().section(key)` exposes existing section actions; request sequencing/cancellation/generations remain inside the detail owner. Share proven repeated behavior without turning distinct DTO/query state into one generic domain hierarchy.

| Section | Data and lifetime boundary |
| --- | --- |
| Executables | Statistics-ID invocations, exact package/executable paths, nullable timings and the separate executable-result vocabulary. Repeated invocations remain distinct. |
| Package calls | Start-event observations within the parent execution. Readable paths retain exact raw paths/source metadata and separate rows. Start/end recorded versus End unconfirmed describes pairing, never child success or a reconstructed graph. |
| Events | Immediate category plus explicitly applied literal search; category/order changes preserve drafts as specified. Full-source search may match beyond a truncated returned prefix. Event IDs, text, source and unknown coverage remain exact; render text only. |
| Parameters / Overrides | Independent fixed-ID pages share value validation/presentation. Sensitive, policy-redacted, unredacted NULL, empty and truncated values remain distinct; clearing/redaction removes old hidden text. `values` gates both sections; `override_values` additionally gates nonsensitive override values while preserving metadata. |
| History | Exact folder/project/entry-package identity comes from the authorized base, never overview dates/patterns. The UI explicitly requests every known status initially; API omission still means 2/7. History owns ID-order/status/cursor state, current-execution marking and independent paging. |

Every section keeps bounded server order and at most one explained cursor reset. Policy-invalidated value paths clear prior text before fallback, even if fallback fails. Fresh metadata gates restoration; denied capabilities drop retained state. History identity changes clear rows/paths before reloading. Actual timing/active elapsed and server-estimated duration/end/sample count remain separate; missing estimates clear old values. [API semantics](API_CONTRACT.md) owns exact DTO, redaction, pairing and estimate rules.

The optional history chart projects only the validated loaded page in chronological creation/ID order, without changing table order or making requests. Actual bars, zero circles and dashed estimates remain distinct; missing values have no mark. Finite scaling handles extreme durations. Keyboard/pointer inspection, selected ID and open state are local; refresh reuses keyed marks and changed pages select a valid loaded ID. The full history table remains the text alternative. Clearing/closing history clears the chart; same-scope transient errors may retain labeled data. No rows/estimates/sample values are persisted.

The `overview` return parameter is a validated selection query, never an arbitrary URL and never an execution API parameter. Explicit Overview opens page one; only a genuinely retained browser document can restore its old page path after fresh settings/data reads. Detail checkpoints contain ID, pause, active tab, queries/cursors and value-free view anchors in memory, excluding fetched rows/text/paths/estimates. Search drafts/cursors never enter URL/history/storage. Dispose owned listeners/requests/timers and protected text together. Browser abort does not prove SQL cancellation.

[Frontend acceptance](FRONTEND_ACCEPTANCE.md) owns browser procedures; [the work queue](PROGRESS.md#next-actions) prioritizes resource/concurrency evidence, retained parity gaps and scoped integration review. Accepted observation/history SQL work remains separate from C8.2c resources, C8.3 reader HTTP and the parked browser/hosting gates.

## Production live updates

SSE is the initial server-to-browser transport; WebSockets require a concrete bidirectional need. The transport and SSISDB change detector are separate responsibilities.

1. Use shared bounded/timed change detection per approved database/authorization scope. Detect new records **and updates to existing active executions**; a maximum execution ID alone misses transitions. Never keep an ODBC connection for the lifetime of a browser stream.
2. Own detector startup/shutdown explicitly and avoid debug-reloader duplicates. Define coordination before adding multiple workers; process-local queues do not provide cross-worker continuity, and cursors need one shared `API_CURSOR_SECRET_KEY`.
3. Send small authorized resource-change notifications, without raw messages, values or connection details. Coalesce client refetches and recheck subscription access on reconnect or identity expiry.
4. Define ordered event IDs, bounded replay and idempotent handling. Snapshot/subscription handoff must not lose changes. Unknown/expired IDs, restart, retention gaps and queue overflow require explicit resync.
5. Bound queues, subscribers, replay and message sizes. Disconnect or resync slow clients, send heartbeats, and release subscriptions on disconnect/navigation/shutdown.
6. Show connecting/live/reconnecting/paused/stale/polling state. Hidden-tab return requires resync. Fall back to data-only polling with backoff and no overlapping loops; stop polling when streaming recovers.

Validate buffering, compression, idle timeouts, heartbeats, URL prefixes and stream/API capacity on the chosen authenticated proxy and production server. A thread-per-stream server needs an explicit capacity budget. Measure database detection load and multi-tab behavior before choosing topology. Development HMR and an ordinary polling screen do not satisfy this production milestone.

## Identity and hosting

Local development binds to `127.0.0.1`. Shared hosting requires an approved audience and authenticated HTTPS proxy, no direct-access bypass, and an explicitly approved SQL read scope. A shared SQL account exposes its scope to authorized viewers; per-user rights require endpoint authorization or designed identity delegation. A browser login alone does not change SQL identity. Trust proxy headers only through the configured boundary and avoid wildcard CORS and cross-user result caches.

API events and values are disabled by default; overrides have an additional display policy. Sensitive values remain NULL in both SQL and serialization. These flags govern API routes; legacy coexistence retains its previous SQL-identity access. Host/access/startup logs need their own review in addition to safe application logs.

Hosting is deferred by the user's 15 October 2026 instruction. When resumed, select a supported server/proxy/runtime combination, certificate trust and service identity; repeat native checks under that identity. Waitress is a Windows candidate requiring stream-capacity validation. An ODBC Driver 18 migration must explicitly review encryption/certificate settings. Optional containers need a current supported OS/driver recipe; the legacy Ubuntu/Python image is not current acceptance evidence.

## Rollout and rollback

[The roadmap](roadmap.md#delivery-phases) owns phase exits. Native overview/detail and supported mapping coexist with legacy; local P4.7 completion does not close Stage C, retire legacy assets or change the default homepage. G01 independent history, G02 operational labels and G05 legacy-prefix limitations require implementation or explicit workflow decisions before cutover. The current queue closes resource evidence and these gaps before expanding scope, with review focused on changed integration boundaries.

When deployment resumes, test a separate binding, complete the required identity/browser/workload/host checks and rehearse an explicit homepage switch and rollback. Retain the previous application/environment and supported bookmarks; no SSISDB schema migration is required. Publication follows the personal-fork-only repository workflow. Written procedures or simulated environments do not establish native acceptance, and this plan does not resume the existing hosting hold.

## Acceptance targets

Contract and native checks cover exact-name/time/status cohorts, both global sort directions, ties/NULLs, Unicode, large IDs, precise offsets/DST, live retention and permission changes, redaction, missing observations and safe failures. Browser checks cover deep links/back-forward, keyboard/narrow layouts, literal text rendering, stale-response races and preserved state. Stream checks cover the handoff/replay/resync/cleanup cases above on the real proxy. A plain SQL Server instance without representative SSIS Catalog data is not equivalent integration evidence.

[The roadmap](roadmap.md#acceptance-budgets) owns enforced frontend size ceilings and proposed latency budgets. [API validation](API_ACCEPTANCE.md#workload-protocol) defines the distinct SQL, WSGI and network measurements; production stream budgets require the chosen host.

Before shared deployment, resolve audience/read scope, required SQL/ODBC/platform matrix, authentication/certificates, proxy/server capacity and any local legacy customizations. Preserve Apache-2.0 and dependency attribution.

## References

Implementation evidence is in [API validation](API_ACCEPTANCE.md). Relevant primary guidance: [Flask factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/), [pyodbc ownership/timeouts](https://github.com/mkleehammer/pyodbc/wiki/Connection), [SSIS execution visibility](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-executions-ssisdb-database?view=sql-server-ver17), [ODBC encryption settings](https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute?view=sql-server-ver17), [Vite production builds](https://vite.dev/guide/build.html), [SSE behavior](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Flask streaming](https://flask.palletsprojects.com/en/stable/patterns/streaming/), [Waitress design](https://docs.pylonsproject.org/projects/waitress/en/stable/design.html).
