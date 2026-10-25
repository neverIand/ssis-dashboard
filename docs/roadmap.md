# Roadmap

Scope authority for modernization on `dev-next`. See [progress](PROGRESS.md) for current status, [the plan](MODERNIZATION_PLAN.md) for architecture and [the documentation index](README.md) for procedures and evidence.

## Current product

The retained Flask/Jinja dashboard reads SSISDB and uses the legacy jQuery/Bootstrap/DataTables/SmartMenus/Morris stack. It still refreshes the whole page after 180 seconds. A separate read-only JSON API and native `/app/` overview implement compact scope/filter pickers with calendar input, all-status cards, an optional selected-cohort timeline with keyboard/table alternatives, server sorting, cursor paging, manual data-only refresh, pausable polling with hidden-tab recovery and native detail links with legacy access. Available in-app browser checks pass; actual hidden-tab/cached return and corporate-browser acceptance remain open alongside API workload/reader acceptance and replacement-screen parity.

Scope is project deployment and public `SSISDB.catalog.*` views. Legacy `msdb` storage, starting/stopping packages, SQL Agent administration and unrelated automation are excluded.

## Modernization

1. Establish workflow/query baselines and isolate configuration, database ownership, timeouts and errors.
2. Expose a documented read-only `/api/v1` API with typed data, explicit access/redaction policy, filtering, global sorting and bounded pagination.
3. Build the frontend with vanilla ES modules and authored CSS. **Vite is allowed** for development and production builds; deploy prebuilt assets.
4. Replace obsolete browser dependencies. **Chart and table libraries are allowed when complexity justifies them**; compare accessibility, maintenance, size, licensing and lifecycle behavior, then bundle them locally.
5. Preserve execution filters, details, executable/child observations, searchable events, parameters/overrides, history and charts while migrating screen by screen.
6. **Automatic and manual updates must change data in place without reloading the page.** Preserve filters, sorting, paging, scroll, focus and chart state.
7. Deliver resilient production updates using SSE initially, or WebSockets if bidirectional requirements justify them. Include shared SSISDB change detection, reconnect/resync, heartbeats, bounded queues, hidden-tab recovery, visible connection state and data-only polling fallback. A browser stream alone does not detect database changes.
8. Validate parity, permissions, builds, database work, stream/proxy capacity and rollback before retiring the legacy UI.

**Hosting is on hold at the user's request, 15 October 2026.** B5c, HOST-01/02/03, production service/container deployment, authentication/proxy/HTTPS/host logs and production stream capacity remain deferred. Local application, SQL and fixture work can continue. These eventual delivery gates remain in scope.

Vite HMR is a development feature. Data-only polling can deliver the first usable screen and serve as fallback; phase 5 still requires a working production stream when hosting resumes.

**Phase 4 local delivery, agreed 18 October 2026:** use the native design system at `3c41da7`, following the review fixes at `1a79c7d`. Deliver a read-only native execution detail page, its refresh/return behavior and an integrated local walkthrough. Then add observations, events, values, history and charts in bounded tasks. Pair each screen with the relevant Stage C workload checks. [Progress](PROGRESS.md#phase-4--native-execution-workflows) owns the task order, dependencies and exit evidence.

Environment-dependent acceptance may wait while the user prepares the test environment. Actual hidden-tab/cache behavior, corporate-browser checks and unavailable reader/workload conditions remain explicitly unverified; they do not block local phase 4 development or count as passed. [Frontend acceptance](FRONTEND_ACCEPTANCE.md) explains the browser procedures. This sequencing does not close Stage C/D3, authorize shared deployment, or resume the deferred hosting work.

## Plan Onwards
1. Complete code review for both frontend and backend: security and performance
2. UX and design improvement:
	- manual test on real world project and improve UX
	- design tweaks
	- support dark mode
3. Start adding features
	- improve clarity for execution details
	- tree view
	- rerun packages from dashboard?

## Delivery phases

| Phase | Deliverable and exit condition |
| --- | --- |
| 0 — baseline | Workflow/field parity and intended bug fixes distinguished; real query/identity baseline recorded |
| 1 — backend | Factory/configuration, pinned runtime, owned resources, safe failures and legacy adapter validated |
| 2 — Stage C API | Read-only operations, contract, typed SQL/JSON, bounded pages and access/redaction; workload/resource/reader acceptance |
| 3 — first native screen | `/app/` shell, filters/list/cards, data-only in-place refresh; complete filter → list → detail-link path. [D1a–D3c](PROGRESS.md#phase-3--first-native-screen-preparation) define the nine bounded tasks and local acceptance. |
| 4 — parity | Native detail, shared refresh/overview return, observations/children/events/values/history/charts, keyboard/responsive behavior and supported URL mapping have [P4.1a–P4.7c local evidence](PROGRESS.md#phase-4--native-execution-workflows). [Inventory, mapping and integrated replay](FRONTEND_PARITY.md) record intended differences and P0a gap dispositions. Standalone history, omitted operational labels and legacy-prefix limitations remain explicit cutover gaps; independent environment/workload acceptance remains open. Local completion does not retire legacy or switch the homepage. |
| 5 — live updates | Shared detection, production stream and [recovery/capacity checks](MODERNIZATION_PLAN.md#production-live-updates) |
| 6 — cutover | Prebuilt install, parity/load/host checks, rollback rehearsal, then obsolete UI/assets removal |

## Acceptance budgets

The 50-row execution page test-network p95 below one second remains a measurement target; list pages are capped at 200 rows. Measure calculated sorts separately. Set detector latency/load, queues/replay and concurrent stream/API budgets after the prototype. Keep local SQL, WSGI, TCP and production measurements distinct.

Frontend review decision D2 and its deduplication follow-up (25 October 2026) replace the 150 KiB authored-source reference target with enforced ceilings: **280 KiB (286,720 bytes)** of authored `web/src` JS+CSS and **64 KiB (65,536 bytes)** of packaged JS+CSS gzip. Count all recursive `.js`/`.css` files: raw authored bytes, and the sum of per-file deterministic gzip-9 bytes (`mtime=0`) in `dashboard/static/app/`, including `theme-init.js`, split chunks and any selected libraries. After `npm --prefix web run build`, `python -m unittest tests.test_frontend_assets` checks both ceilings and verifies that each check fails above its ceiling.

The deduplication candidate measures **271,258 authored bytes**, **155,913 packaged bytes** and **47,302 packaged gzip bytes**, against batch 2's 282,180 / 164,451 / 48,605 bytes. Its separate implementation target is at most **266 KiB (272,384 bytes)**; the 280 KiB test ceiling retains limited headroom. The shared detail section-table skeleton and generic section API reduce repetition while the compressed modules regain normal formatting. The user's Q1(a) decision permits whitespace-only wrapping of the 17 existing long overview lines; the universal 140-character guard now passes, with identical AST and minified output for those modules. Independent round-002 review and its reduced native overview sweep remain open. This revision does not change API row limits or establish a network/performance result; [progress](PROGRESS.md) records validation and remaining gates.

## Later

- Improve duration forecasting after reliable historical data and basic estimates; advanced models are optional.
- Revisit richer table/chart interactions and stream infrastructure when measured use justifies them.
