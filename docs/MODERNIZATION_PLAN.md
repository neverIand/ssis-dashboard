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

Use vanilla ES modules, native DOM/events/fetch/EventSource, semantic HTML and authored CSS. **Vite is allowed** for development/HMR and production builds. **Chart/table libraries are allowed when their complexity is justified**: compare required interactions, accessibility, maintenance, bundle size, licensing and update/teardown behavior. Pin tools, keep lockfiles, bundle libraries locally and deploy prebuilt assets; server users should not need npm. Production makes no public requests for fonts, scripts or analytics.

Keep frontend pages simple and functional. Use concise labels and useful status messages; omit slogans, marketing taglines and decorative filler copy.

D1a uses a JS entry and Vite manifest with a relative asset base. Only `dashboard/static/app/` is generated/emptied; that output is ignored by Git and included in the prepared application delivery after building from the tracked `web/` source and lockfile. Development uses a loopback Vite harness and a same-origin `/api/v1` proxy to local Flask. The D1b Flask shell consumes the manifest through Flask's prefix-aware static endpoint, including CSS from shared imports and optional module preloads. Shell requests read build files without SQL; absent/invalid builds return a safe 503 without preventing legacy/API/health startup. The manifest is reread for each shell request so a repaired build takes effect without recreating the app. Bootstrap JSON contains only application/API/execution URL bases; D2a loads metadata separately. Execution and summary loading follow in D2c. Build commands, supported runtimes and packaged/ignored boundaries are in [installation](installation.md#build-the-browser-assets). Node's built-in test runner and existing Flask unittests provide focused coverage without another test dependency.

The request boundary permits same-origin GETs within the supplied API base, rejects redirects and uses same-origin credentials with `no-store`. It preserves wire strings, encodes query values, checks JSON envelopes and exposes only fixed safe error messages, known problem codes and validated request IDs. Metadata supplies limits, statuses, sorts, capabilities and the display timezone; invalid or missing consumed settings stop startup without fallback configuration. One metadata owner coalesces concurrent starts, cancels after a 10-second browser deadline and offers manual Retry without an automatic loop. Disposal clears the timer, aborts transport and rejects late generations; back/forward-cache restoration creates a fresh owner. This lifetime is separate from the later overview refresh owner.

Replace jQuery with native events/fetch, Bootstrap/SmartMenus with authored layout and keyboard-accessible controls, DataTables with bounded server-backed tables, and Morris/Raphael with SVG or a justified chart library. Provide chart text/table alternatives and small authored icons. Remove legacy assets only after reference checks and parity. Target corporate Edge/Chrome; include Firefox/Safari smoke checks when used, with no IE requirement.

Keep filters, sorting, paging, scroll, focus, selected execution and chart state during refresh. Abort obsolete requests and check request generations so stale responses cannot overwrite a newer selection. Coalesce notifications, avoid overlapping fetch/poll loops, pause hidden work and resync on return. Retain useful stale data with clear retry/connection state. Render catalog text with `textContent`, format typed values with `Intl`, show the timezone, and store only display preferences locally.

### Overview state and refresh

Phase 3 has [nine implementation tasks](PROGRESS.md#phase-3--first-native-screen-preparation). Keep browser modules around operations that share state: applying a selection, requesting an overview, rendering typed values and owning refresh lifetime. One coordinator owns the applied selection, effective creation bounds, page-entry cursor path and request generation; rendering and transport helpers do not maintain competing copies. A framework, general state library or domain class hierarchy is unnecessary for this screen.

Separate draft filter inputs, applied selection and display preferences. Shareable `/app/` URLs contain validated selection/sort/limit; opaque cursors and catalog rows stay out of URLs and persistent storage. Back/forward restores the selection and an available valid in-memory page context; a fresh load starts on page one. Navigation choices load bounded pages on demand. “All folders/projects/statuses” omits the corresponding API parameter, so a literal name such as `all` remains selectable.

On each new cohort, use one execution response to establish exact `meta.from`/`to`, then request summary cards with those bounds. Summary remains all-status and is not a filtered-list total. An overview generation prevents stale responses from another selection from being displayed as current; separate API requests still observe live catalog state and do not form an atomic snapshot. Keep BIGINT IDs, wire timestamps and cursors unchanged; `Intl`/browser date conversion is for display only. Custom time inputs must resolve to explicit offsets rather than silently using the browser's timezone.

| Trigger | Planned window and page behavior |
| --- | --- |
| Apply selection, sort or page-size change | Clear cursor history and request page one. The configured default window is resolved by the server, including `AS_OF_DATE`; explicit bounds remain fixed. |
| Refresh page one manually or by polling | Retain the selected filter mode, sort and size. Re-resolve the configured default window, or reuse explicit bounds; use the returned bounds for cards. Replace the old continuation path because this request establishes a new fence. |
| Refresh a later page | Replay its entry cursor with the original exact bounds/selection. Preserve the current page context, scroll and focus. Cursor `as_of` and the upper-ID fence stay fixed; changing rows are not a snapshot. A visible “Show latest” action starts a new first-page cohort. |
| Expired/invalid cursor, including after restart | Discard the invalid path, visibly explain the reset and attempt one new first page. Further failure uses the normal error state rather than a reset/retry loop. An empty retained page offers navigation or “Show latest”. |
| Return from a hidden tab | Perform one refresh using the same page/window rules, then resume the single polling schedule. Do not create another polling owner. |

Manual refresh, polling and visibility recovery share one request lifecycle; abort obsolete work and independently reject late generations. Preserve stale data only for a transient failure within the same authorized selection, with its last-success state visible. Clear protected data on denied access, and never label a previous selection's rows/cards as the newly selected scope. Dispose timers, listeners and pending browser requests together; backend timeouts/resource acceptance still own native SQL cleanup. Phase 5 can later reuse this refresh operation for coalesced notifications without treating phase 3 polling as streaming acceptance.

## Production live updates

SSE is the initial server-to-browser transport; WebSockets require a concrete bidirectional need. The transport and SSISDB change detector are separate responsibilities.

1. Use shared bounded/timed change detection per approved database/authorization scope. Detect new records **and updates to existing active executions**; a maximum execution ID alone misses transitions. Never keep an ODBC connection for the lifetime of a browser stream.
2. Own detector startup/shutdown explicitly and avoid debug-reloader duplicates. Define coordination before adding multiple workers; process-local queues and cursor keys do not provide cross-worker continuity.
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

[The roadmap](roadmap.md#delivery-phases) owns delivery phases and their exit conditions. The first native screen may start after C1/C2a/C3a/C3b pass locally; this overlap does not close Stage C. Keep legacy and `/app/` side by side until parity, use an explicit default-page switch, and preserve bookmarks through route translation. Test a separate binding first. Retain the previous application and environment for rollback; no SSISDB schema migration is required. Publication follows the personal-fork-only repository workflow.

## Acceptance targets

Contract and native checks cover exact-name/time/status cohorts, both global sort directions, ties/NULLs, Unicode, large IDs, precise offsets/DST, live retention and permission changes, redaction, missing observations and safe failures. Browser checks cover deep links/back-forward, keyboard/narrow layouts, literal text rendering, stale-response races and preserved state. Stream checks cover the handoff/replay/resync/cleanup cases above on the real proxy. A plain SQL Server instance without representative SSIS Catalog data is not equivalent integration evidence.

[The roadmap](roadmap.md#acceptance-budgets) owns proposed size/latency budgets. [API validation](API_ACCEPTANCE.md#workload-protocol) defines the distinct SQL, WSGI and network measurements; production stream budgets require the chosen host.

Before shared deployment, resolve audience/read scope, required SQL/ODBC/platform matrix, authentication/certificates, proxy/server capacity and any local legacy customizations. Preserve Apache-2.0 and dependency attribution.

## References

Implementation evidence is in [API validation](API_ACCEPTANCE.md). Relevant primary guidance: [Flask factories](https://flask.palletsprojects.com/en/stable/patterns/appfactories/), [pyodbc ownership/timeouts](https://github.com/mkleehammer/pyodbc/wiki/Connection), [SSIS execution visibility](https://learn.microsoft.com/en-us/sql/integration-services/system-views/catalog-executions-ssisdb-database?view=sql-server-ver17), [ODBC encryption settings](https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute?view=sql-server-ver17), [Vite production builds](https://vite.dev/guide/build.html), [SSE behavior](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), [Flask streaming](https://flask.palletsprojects.com/en/stable/patterns/streaming/), [Waitress design](https://docs.pylonsproject.org/projects/waitress/en/stable/design.html).
