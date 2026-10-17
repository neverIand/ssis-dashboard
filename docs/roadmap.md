# Roadmap

Scope authority for modernization on `dev-next`. See [progress](PROGRESS.md) for current status, [the plan](MODERNIZATION_PLAN.md) for architecture and [the documentation index](README.md) for procedures and evidence.

## Current product

The retained Flask/Jinja dashboard reads SSISDB and uses the legacy jQuery/Bootstrap/DataTables/SmartMenus/Morris stack. It still refreshes the whole page after 180 seconds. A separate read-only JSON API and native `/app/` overview with filters, all-status cards, server sorting, cursor paging and legacy detail links are implemented; API acceptance, data refresh and replacement-screen parity remain tracked work.

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

## Delivery phases

| Phase | Deliverable and exit condition |
| --- | --- |
| 0 — baseline | Workflow/field parity and intended bug fixes distinguished; real query/identity baseline recorded |
| 1 — backend | Factory/configuration, pinned runtime, owned resources, safe failures and legacy adapter validated |
| 2 — Stage C API | Read-only operations, contract, typed SQL/JSON, bounded pages and access/redaction; workload/resource/reader acceptance |
| 3 — first native screen | `/app/` shell, filters/list/cards, data-only in-place refresh; complete filter → list → detail-link path. [D1a–D3c](PROGRESS.md#phase-3--first-native-screen-preparation) define the nine bounded tasks and local acceptance. |
| 4 — parity | Details/children/events/values/history/charts, keyboard/responsive behavior and legacy URL mapping |
| 5 — live updates | Shared detection, production stream and [recovery/capacity checks](MODERNIZATION_PLAN.md#production-live-updates) |
| 6 — cutover | Prebuilt install, parity/load/host checks, rollback rehearsal, then obsolete UI/assets removal |

## Acceptance budgets

Proposed budgets remain **targets**: 50-row execution page test-network p95 below one second, maximum 200 rows per list page, authored frontend JS+CSS below 150 KiB uncompressed. Record the entire bundle including selected libraries. Measure calculated sorts separately and deliberately document any target revision. Set detector latency/load, queues/replay and concurrent stream/API budgets after the prototype. Keep local SQL, WSGI, TCP and production measurements distinct.

## Later

- Improve duration forecasting after reliable historical data and basic estimates; advanced models are optional.
- Revisit richer table/chart interactions and stream infrastructure when measured use justifies them.
