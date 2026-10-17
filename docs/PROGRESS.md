# Implementation progress

Updated 17 October 2026. Development base: `dev-next`; planning baseline: `ce8d04e`. [Roadmap](roadmap.md) owns scope; [the plan](MODERNIZATION_PLAN.md) owns architecture. This file owns status and next actions. Detailed results belong in [API validation](API_ACCEPTANCE.md) and the [backend checklist](BACKEND_CHECKLIST.md).

**Stage C remains in progress.** All 14 GET operations and all 12 execution sorts are implemented; the three review remedies pass their [recorded local checks](API_ACCEPTANCE.md#sql-remedies-replay-17-october-2026). Representative workload, resource and independent API reader acceptance remain open. The first native overview's API prerequisites are available; frontend work is a separate milestone.

**Next task: D2a / API request boundary and metadata bootstrap.** D1's source/build and Flask shell pass local checks. On 17 October 2026 the user prioritized preparing delivery phase 3; the [nine tasks below](#phase-3--first-native-screen-preparation) refine D1–D3 into independently verifiable deliveries. The remaining C8 checks do not block local frontend development; retain them for API acceptance and before cutover/shared deployment. No Stage C acceptance item is waived or marked complete by this sequencing decision. Hosting remains deferred.

## Task sizing and status

Deliver one coherent, independently verifiable task at a time. Record submilestones before expanding scope. **Complete locally** means the stated checks passed on the recorded setup; it does not imply all platforms, workloads or production hosting passed. **Deferred** means the user explicitly put the work on hold.

## Baseline and backend foundation

| ID | Status | Delivered scope or remaining exit check |
| --- | --- | --- |
| P0a | In progress | Legacy workflow coverage and intentional API differences are recorded; final replacement-screen parity remains. |
| P0b | Awaiting integration | Real SQL 2022 fixtures and actual legacy reader HTTP pass. Typed datetimeoffset is resolved; native cleanup-failure observation remains open. |
| B1 | Complete locally | App factory, deterministic private config, isolated app settings and legacy routes. |
| B2 | Complete locally | Package-relative SQL, bound parameters, per-query connection/cursor ownership and positive timeouts. |
| B3 | Complete locally | Strict legacy inputs, safe HTTP/driver errors and absent/hidden equivalence. |
| B4 | Complete locally | Legacy query budgets: overview/details/events/values/history = 6/7/4/5/2; only displayed resources are loaded. |
| B5a1 / B5a2 | Complete locally | Pinned dependency graph and clean Windows x64 standard CPython 3.14.8 environment; native imports, entry points and offline installation checked. |
| B5a3a / B5a3b1 / B5a3b2 | Complete locally | Local native baseline, fixture preparation, deployed fixture and actual Windows reader replay. |
| B5a / B5a3 / B5a3b | Awaiting integration | OBS-02's native cleanup-failure assertion remains NOT RUN. Successful native cleanup and synthetic failures do not close it. |
| B5b / B5b1 | Complete locally | Safe correlated timing/error events, cleanup observation and explicit local exception propagation. |
| B5c | Deferred | Hosting, service/container, production identity/proxy/transport/logging and stream capacity; user hold of 15 October 2026. |

Backend checklist: **25/30 full PASS**. OBS-02 is partly unobserved; OBS-03's host portion and HOST-01/02/03 are deferred. Keep these separate from Stage C acceptance.

## Stage C / read-only API (delivery phase 2)

| ID | Status | Deliverable |
| --- | --- | --- |
| C1a | Complete locally | Contract, OpenAPI, local policy and tracked contract tests. |
| C1b | Complete locally | Exact 100-ns SQL datetimeoffset/JSON boundary, BIGINT strings and strict typed serializers; native proof passed. |
| C1c | Complete locally | Shared HTTP parsing/errors/capabilities; metadata, liveness and bounded readiness. |
| C2a | Complete locally | Creation-cohort execution pages, ID order, authenticated cursors and upper-ID fence. |
| C2b | Complete locally | All 12 global sorts, exact tie/NULL keys; ordinary pages bounded before enrichment. |
| C3a | Complete locally | Visible folder/project navigation with exact names and unambiguous IDs. |
| C3b | Complete locally | All-status summary over the selected creation cohort. |
| C3c | Complete locally | Selected-status timeline, IANA calendar/DST boundaries and zero-filled buckets. |
| C4a | Complete locally | Visible execution metadata and isolated conditional event-count aggregation. |
| C4b | Complete locally | Paged executable observations; nullable timings and separate result vocabulary. |
| C4c | Complete locally | Paged child starts and conservative exact path/source pairing; unknown coverage for unidentified starts. |
| C5 | Complete locally | Paged event categories, full-source literal Unicode search, bounded text and unidentified-event coverage. |
| C6 | Complete locally | Separate parameter/override pages; SQL and serializer sensitive/policy redaction. |
| C7a | Complete locally | Exact-package history, explicit status scope, bounded ID pages and actual timings. |
| C7b | Complete locally | Separate estimates from up to five valid visible successes completed by each target start. |
| C8 | In progress | Combined correctness replay passes; complete the workload/resource/reader acceptance below. |

### Remaining acceptance

| ID | Status | Scope and exit condition |
| --- | --- | --- |
| C8.1 | Complete locally | Combined 14-operation contract/native replay with administrator and two impersonated SQL reader contexts. |
| C8.2a | Complete locally | Explicit SQL NULL binding removes measured type-discovery overhead; typed results, plans and affected fixtures compared. |
| C8.2b.1 | Complete locally | Current catalog: 20 cases × 100 WSGI samples, 70 fresh-client requests and all 25 SQL resource diagnostics. See [retained baseline](API_ACCEPTANCE.md#c82b1-retained-baseline). |
| C8.2b.2a | Complete locally | 20,000 matching synthetic executions; full/deep/NULL pages, all sorts/directions, 1,700 native samples and real reader SQL IO. See [results](API_ACCEPTANCE.md#c82b2a-retained-execution-cardinality-results). |
| C8.2b.2b | Planned — next workload | Dense events, repeated child keys, full/max executable/event/value pages and wide Unicode/LOB payloads. Check complete DTOs, candidate/enrichment bounds, source work, bytes and warm distributions; include reader SQL IO. |
| C8.2b.2c | Planned | 1,000 timeline buckets, broad/selective summaries and growing prior-success history. Check exact aggregates/estimates, scans, compilation and distributions. |
| C8.2b.3 | Complete locally | .3a narrow calculated cohorts, .3b cached ID selection/ordinary logging and .3c measured event join order. 80 paired diagnostic cases and 254 materialization checks pass; 880 alternating warm samples preserve results; combined native acceptance passes. Small-catalog tradeoffs and unresolved network budgets are recorded in [workloads](API_ACCEPTANCE.md#c82b3-execution-query-remedies). |
| C8.2c | Planned | Repeated/concurrent success, failure and cancellation; verify request isolation and no accumulation of logical connections/cursors, active requests or owned processes. |
| C8.3 | Planned | Actual Windows-reader sign-in and API HTTP, hidden/absent equivalence and network timings. Stage B's actual-reader legacy replay and administrator impersonation do not substitute. |

The C8.2b.2 parent remains open until .2b/.2c finish. Reader SHOWPLAN is NOT RUN without the required existing permission; do not add grants to make a check pass. Real active/Scale Out workloads retain explicit gaps. The proposed 50-row execution-page test-network p95 below one second is **not passed**. Synthetic SQL distributions and in-process WSGI timings are different measurements.

### Review of Stage C — 17 October 2026

C8.2b.3 resolves wide calculated cohorts, unnecessary recompilation and repeated reader permission scans; [API validation](API_ACCEPTANCE.md#sql-remedies-replay-17-october-2026) owns the review, regression and measurement records.

Two follow-ups remain in the table above: child pairing can grow with all events for repeated selected keys (C8.2b.2b), and history materializes prior-success timestamps through the latest page start (C8.2b.2c). Measure source growth before adding caches, arbitrary lookback caps or changing semantics. Shared-worker cursor-key coordination remains B5c.

After C8: code review: performance and correctness

### Pre-frontend checkpoint — 17 October 2026

Before committing the SQL remedies and documentation consolidation, reran all **344 tests: 341 database-free tests and three opt-in native SQL tests PASS**. The native tests use only connection-local synthetic sources. All three current SQL SHA-256 hashes match the retained remedy measurements; 353 document links/anchors, 16 Stage C IDs, 30 backend cases and whitespace checks pass. Test processes exited before removing the temporary work marker; selected logs and the hash-checked promotion receipt are in `.local/reports/maintenance/20261017-stage-c-handoff/`.

This checkpoint does not repeat the long workload samples, sustained/concurrent resource checks or independent reader HTTP; their remaining acceptance status is unchanged. D1 can proceed under the existing local-only phase overlap.

### Documentation and local maintenance — 17 October 2026

Closed historical runs are archived with hashes; current C8 inputs, runtime/configuration and fixtures retain their paths. [Installation and local workflow](installation.md#local-artifacts) owns cleanup/recovery instructions. The earlier review and cleanup records remain in `.local/reviews/stage-c-20261017/` and `.local/reports/maintenance/20261017-stage-c-cleanup/`.

Further consolidation reduces `docs/` from 14 files to 11 by combining API correctness/workload evidence, installation/local management and legacy references, and puts delivery phases/budgets in the roadmap. Existing case definitions, commands, result tables, dates and open gates are retained. Fourteen contract/shared-acceptance tests and 353 links/anchors pass. Preservation checks are recorded under `.local/reports/maintenance/20261017-docs-consolidation/`; no native SQL/HTTP rerun or application change is part of this documentation task.

## Later phase boundaries

Phase 3 is in progress; phases 4–6 remain planned, with production validation deferred. [The roadmap](roadmap.md#delivery-phases) defines their deliverables and exit conditions; [the plan](MODERNIZATION_PLAN.md#rollout-and-rollback) defines coexistence and rollback.

### Phase 3 / first native screen preparation

Planning recorded 17 October 2026 against `ce8d04e`. The outcome is a usable `/app/` overview: choose a visible folder/project and creation-time/status scope, inspect summary cards and a bounded execution list, open the existing execution details, and refresh data in place. The legacy homepage stays available during this phase. Details/children/events/values/history/charts and legacy URL translation belong to phase 4; production detection/SSE belongs to phase 5; cutover and asset removal belong to phase 6.

The parent milestones remain **D1 foundation**, **D2 usable overview** and **D3 refresh/acceptance**. D1 is complete locally; D2/D3 remain planned, and a parent closes only when its children pass. Each task updates this file with its implementation, checks, evidence and remaining gaps. [Overview state and refresh](MODERNIZATION_PLAN.md#overview-state-and-refresh) owns the cross-task behavior; [API semantics](API_CONTRACT.md) remains authoritative for wire values and cursor rules.

| ID | Status | Deliverable | Exit check |
| --- | --- | --- | --- |
| D1a | Complete locally | Establish `web/` with vanilla ES modules, authored CSS and a pinned Vite build/lockfile. Produce entry assets/manifest for `dashboard/static/app/`; document the supported build runtime, clean-install/build commands, development API path and packaged/ignored outputs in the installation guide. | Clean lockfile installation, repeated identical builds, asset sizes, root/prefix Flask asset serving, development proxy and legacy-file isolation pass. See the dated D1a record below. |
| D1b | Complete locally | Serve a semantic `/app/` shell from Flask with packaged assets, application/API/detail-link bases and clear startup failure state. Establish labeled filter, summary, table and connection-status regions with keyboard focus and narrow-layout foundations. | Root/prefix, shared assets, safe build-failure responses, no-SQL/legacy/API/health compatibility and local browser layout/keyboard checks pass. See the dated D1b record below. |
| D2a | Planned — next | Add a small same-origin API request boundary and `/meta` bootstrap: safe problem/request-ID handling, abort support, metadata-driven limits/statuses/sorts/timezone, and typed display helpers. Keep wire IDs/timestamps separate from display formatting. | Focused checks cover BIGINT strings, seven-digit timestamp round trips, NULL/zero/unknown codes, literal Unicode/HTML-looking text, failed/non-JSON responses and cancelled requests. Metadata failure offers retry without starting a request storm or inventing configuration defaults. |
| D2b | Planned | Add paged folder/project navigation and exact-name, creation-time and status filters. Keep editable inputs separate from applied selection; represent “all” by omission. Restore valid selection/sort/limit from `/app/` URLs and browser back/forward; keep transient paging out of shareable URLs. | More than one navigation page remains reachable without fetching the entire catalog. Changing folder clears an incompatible project. Literal `all`, wildcard characters, plus/slash/Unicode names, empty scopes, invalid ranges and delayed old navigation responses behave correctly. Offset-aware custom bounds and server-returned bounds retain their exact strings. |
| D2c | Planned | Render the first execution page and all-status summary cards for the same resolved creation cohort. Use the execution response's exact `meta.from`/`to` for summary requests. Show typed timings/counts, the display timezone, empty/loading/error states and links to existing execution details. | Complete filter → list → detail-link → return in a browser against local SSISDB. Cards clearly count all statuses, including when the table selects only one; they are not a table/page total. Unstarted executions, NULL timings, unknown statuses, no results, long names and partial request failure are represented accurately. |
| D2d | Planned | Add all API-advertised execution sort keys/directions and bounded page sizes; implement Next and Previous using opaque cursors and an in-memory path of page-entry requests. Selection/sort/size changes start a fresh first page. | Global order comes from the server, including calculated sorts and NULL/tie cases. Default 50/max 200 limits, terminal pages, forward/back navigation, expired/invalid cursors and retention/visibility changes have explicit behavior. No local page-only sort, fabricated total-page count or snapshot guarantee is introduced. |
| D3a | Planned | Add manual data-only refresh through one overview request owner. Apply request-generation checks and cancellation; update rows by identity while preserving selection, sort, current valid page, scroll and focus. Implement the documented default-window, fixed-window and cursor-reset rules. | Deliberately reorder responses while changing filters, sorting, paging and refreshing; old results never replace the current selection. First/deeper-page refresh, empty-page retention, cursor reset, detail-return navigation and partial failure follow the state table. Transient failures retain clearly stale data only for the same scope; denied access removes protected data. |
| D3b | Planned | Add polling to the same refresh path with a documented interval/backoff based on observed request cost, pause/resume controls, last-success/error state, hidden-tab pause and return resync. Own timers, requests and listener teardown together. | Slow requests, repeated refresh clicks, transient errors, hidden/visible transitions and navigation never create overlapping refresh cycles or duplicate timers. Return performs one resync; disposal stops future work. Browser abort is not counted as proof of native SQL cancellation. |
| D3c | Planned | Record integrated phase 3 browser acceptance, reproducible packaged-build checks and authored/total bundle sizes. Review the completed frontend for correctness, avoidable requests and lifecycle cleanup; update installation/use instructions and the retained evidence index. | Exercise the full path on local SSISDB in corporate Edge/Chrome, keyboard-only and narrow layouts; include Firefox/Safari smoke checks when used. Check root/prefix routing, bookmarks/back-forward, literal text, accessibility states, request races and polling recovery. Measure authored JS+CSS against the 150 KiB uncompressed target and record the whole bundle; label unrun cases and API/hosting gates separately. |

**Execution order:** `D1a → D1b → D2a → D2b → D2c → D2d → D3a → D3b → D3c`. D2c is the first end-to-end usable screen; D2d completes its table interactions; D3c is the phase 3 acceptance checkpoint. Accessibility, text safety and useful failure states are built into each task and verified together at the end.

Use the existing Flask test setup for route/build integration, focused frontend state/request tests for the hard cases, and actual browser runs for behavior. Choose the smallest adequate test tooling during D1a; do not add a framework or chart/table package for this overview. Build-only tests or mocked API responses do not establish browser/native acceptance. Keep reusable helpers and dated evidence under the existing [local-artifact rules](installation.md#local-artifacts); attribute/reuse running servers and stop task-owned resources before completion.

#### D1a / source and packaged build — 17 October 2026

Established `web/` with Vite **8.3.4**, a version-3 npm lockfile, vanilla ES modules and authored CSS. Build runtime: Windows x64, Node **22.19.0**, npm **10.9.3**; the declared build range is Node 22.12+ on 22.x / npm 10. Vite is the only direct development dependency. Node's built-in test runner adds no test package. The development-only harness proxies `/api/v1` to loopback Flask; the production JS entry, manifest and license notice are generated under `dashboard/static/app/`. [Installation](installation.md#build-the-browser-assets) owns the commands and artifact boundaries.

Clean `npm ci` from the lockfile passes, including a cache-only replay. Two subsequent production builds match each other and the prepared output byte for byte; the lockfile is unchanged. The generated-directory stale-file probe is removed on rebuild, and all **41 legacy static files** retain their original SHA-256. Frontend source Git attributes enforce LF line endings. Generated `dashboard/static/app/` files are ignored and built before packaging, rather than committed. No Flask/SQL route or query implementation changes in this task.

| Size measurement | Bytes, uncompressed |
| --- | ---: |
| Authored JS + CSS source | 396 |
| Complete browser JS, including Vite's modulepreload polyfill | 670 |
| Browser CSS | 256 |
| Browser JS + CSS total | 926 (0.90 KiB); 597 bytes with Python gzip |
| Manifest / license notice | 184 / 1,175 |
| Entire packaged output | 2,285 |

**Validation:** one Node integration test passes for native development modules, exact API proxy path/query and nonmatching-route 404s. The Python suite runs **346 tests: 343 PASS, three opt-in native SQL tests SKIP**. Its two new asset tests verify manifest dependencies, packaged notice, byte-identical JS/CSS serving at root and a simulated `/dashboard` WSGI mount, unknown-asset 404s and zero SQL connections. Documentation and whitespace checks pass. Selected install/build/dependency-tree/test logs and hashes are retained under `.local/reports/frontend/20261017-d1a/`; the reusable ignored verifier is `.local/tools/verify-frontend-build.py`.

This is the source/build foundation. `/app/` rendering, browser interaction/HMR, overview requests, data refresh and real SSISDB frontend acceptance remain D1b–D3c. The existing C8, OBS-02 and deferred hosting gates retain their status.

Before commit, recorded the user's frontend preference in `AGENTS.md` and the plan: simple, functional pages without slogans or decorative filler copy. Corrected the generated-asset boundary to ignore all of `dashboard/static/app/`, retaining source and lockfile. The Node suite additionally requires the build for packaging; Python asset checks skip only when the generated directory is absent, so a fresh backend-only source checkout remains testable.

**Pre-commit validation:** with generated assets temporarily absent, all 346 Python cases finish with **341 PASS / five SKIP** (three native SQL and two build-dependent checks). After restoring and rebuilding, **343 PASS / three native SQL SKIP**; both Node packaging/development tests pass. All four output-file hashes match the retained build. Git ignore checks confirm the generated JS, CSS, manifest and notice are excluded while `web/` source/lockfile remain eligible. Document/whitespace checks pass; follow-up logs are in `.local/reports/frontend/20261017-d1a-commit/`. D1b remains next.

#### D1b / Flask application shell — 17 October 2026

Implemented on `dev-next` after `2e9afb9`. `/app/` uses an independent semantic template and the generated Vite manifest. Shared-import styles are deduplicated, imported scripts may be preloaded, and application/API/legacy-execution bases are provided as escaped JSON through Flask URL generation. The shell loads only same-origin JS/CSS, system fonts and authored layout, without legacy browser dependencies, analytics, refresh timers, SQL work or API data requests. Controls remain disabled, counts show `—`, and connection/table text says data has not loaded. The page includes a skip link, labeled regions/inputs, a table caption/headers, visible focus and a keyboard-scrollable table container. No slogans or filler copy were added.

Missing, malformed or incomplete builds produce an HTML **503 Application unavailable** with a legacy link, safe request ID and `no-store`; building again repairs the next shell request without app restart. Unknown paths retain normal 404 behavior and unsupported methods preserve `Allow`. Application construction, legacy pages, `/healthz` and API metadata remain independent of frontend build availability. No SQL query implementation changed.

**Validation:** seven new database-free shell tests cover root/mounted prefixes and redirects, bootstrap bases, dependency cycles/deduplication, malformed/missing assets, build recovery, browser-header isolation and legacy/API/health/method behavior. The full suite runs **353 tests: 350 PASS / three opt-in native SQL SKIP**; both Node tests pass. Cache-only clean installation and two identical production rebuilds pass, with an unchanged lockfile and all 41 legacy static hashes preserved. Authored JS+CSS source is **3,235 bytes**; complete browser JS/CSS is **822 / 2,356 bytes**, **3,178 bytes total** (1,437 with Python gzip). Manifest and notice add 184 / 1,175 bytes, making 4,537 bytes of generated output; it remains ignored by Git.

**Browser scope:** local Chromium-based in-app browser, root and `/dashboard` mount, missing-build response, startup text, disabled controls, skip-to-main focus and keyboard table scrolling. Real iframe viewports at **360 / 768 CSS pixels** check the narrow layouts; an empty-table message was left-aligned so it stays visible on mobile. All preview SQL connections were blocked. Screenshots, access/test/build logs and hashes are retained under `.local/reports/frontend/20261017-d1b/`. Preview services and task-owned tabs are closed after validation; the final preview uses an explicit stop-file lifecycle because terminal Ctrl+C did not stop its earlier Windows launches.

This closes D1's local foundation. Metadata, typed display and retry handling remain D2a; filters/data/paging/refresh remain later tasks. Corporate Edge/Chrome, Firefox/Safari, full browser/native parity, independent reader, workload, hosting and streaming acceptance retain their existing gates. D1b is not a usable data overview or Stage C acceptance.

#### Acceptance carried alongside phase 3

| Gate | Remaining work and relationship to frontend delivery |
| --- | --- |
| C8.2b.2b / C8.2b.2c | Dense observation/value/text workloads and aggregate/history growth remain planned. Resume .2b then .2c when returning to API workload acceptance; a rendered overview does not close either. |
| C8.2c / C8.3 | Sustained/concurrent resources and independent Windows-reader API HTTP remain planned. A local browser run under the configured identity is not independent-reader sign-in evidence. |
| P0 / phase 4 | Record overview parity and intended API differences during D3c; replacement details, observations, event/value/history/chart workflows and legacy URL mapping remain later work. |
| OBS-02 / B5c / phases 5–6 | Native cleanup-failure evidence remains open. Hosting, authentication/proxy/HTTPS, stream capacity and cutover retain their deferred gates. |
| Performance | The execution-page test-network p95 target remains unpassed until the appropriate C8 measurements establish it. Record frontend request count, payload and rendering/build evidence separately from SQL, WSGI and network timings. |

Stage C closes only after its remaining contract/SQL/HTTP/workload/resource/reader checks pass and deferred production gates are explicitly carried forward. Do not close it from operation coverage or this review alone.
