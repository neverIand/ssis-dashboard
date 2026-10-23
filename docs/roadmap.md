# Roadmap

Scope authority for modernization on `dev-next`. See [progress](PROGRESS.md) for current status, [the plan](MODERNIZATION_PLAN.md) for architecture and [the documentation index](README.md) for procedures and evidence.

## Current product

The retained Flask/Jinja dashboard reads SSISDB and uses the legacy jQuery/Bootstrap/DataTables/SmartMenus/Morris stack. It still refreshes the whole page after 180 seconds. A separate read-only JSON API and native `/app/` overview implement compact scope/filter pickers with calendar input, all-status cards, server sorting, cursor paging, manual data-only refresh, pausable polling with hidden-tab recovery and native detail links with legacy access. Available in-app browser checks pass; actual hidden-tab/cached return and corporate-browser acceptance remain open alongside API workload/reader acceptance and replacement-screen parity.

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
| 4 — parity | First deliver native execution detail, in-place refresh and return to the overview; then observations/children/events/values/history/charts, keyboard/responsive behavior and legacy URL mapping. [P4.1a–P4.7](PROGRESS.md#phase-4--native-execution-workflows) define the independently verifiable tasks. |
| 5 — live updates | Shared detection, production stream and [recovery/capacity checks](MODERNIZATION_PLAN.md#production-live-updates) |
| 6 — cutover | Prebuilt install, parity/load/host checks, rollback rehearsal, then obsolete UI/assets removal |

## Acceptance budgets

Proposed budgets remain **targets**: 50-row execution page test-network p95 below one second, maximum 200 rows per list page, authored frontend JS+CSS below 150 KiB uncompressed. Record the entire bundle including selected libraries. Measure calculated sorts separately and deliberately document any target revision. Set detector latency/load, queues/replay and concurrent stream/API budgets after the prototype. Keep local SQL, WSGI, TCP and production measurements distinct.

## Later

- Improve duration forecasting after reliable historical data and basic estimates; advanced models are optional.
- Revisit richer table/chart interactions and stream infrastructure when measured use justifies them.
