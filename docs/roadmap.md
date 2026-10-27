# Roadmap

Scope authority for modernization on `dev-next`. [Progress](PROGRESS.md) owns completion status and the task queue; [the plan](MODERNIZATION_PLAN.md) owns architecture; [the documentation index](README.md) identifies the other canonical documents.

## Current product

The retained Flask/Jinja dashboard and native `/app/` screens coexist over public `SSISDB.catalog.*` views. The native read-only API/UI provides exact scope/date/status filters, bounded server-sorted pages, in-place refresh, execution detail tabs, searchable events, redacted values, independent exact/LIKE package history and timeline/duration charts. Supported legacy bookmarks can opt into native destinations. Operational labels and prefix-safe legacy coexistence have local coverage and accepted scoped integration review; environment acceptance remains gated.

Current scope is project deployment and monitoring. Legacy `msdb` storage, package start/stop/rerun, SQL Agent administration and unrelated automation are excluded.

## Modernization

1. Preserve deterministic configuration, owned database resources, timeouts and safe errors.
2. Maintain a documented read-only `/api/v1` contract with typed data, access/redaction policy, global sorting and bounded pagination.
3. Use vanilla ES modules and authored CSS. Vite is allowed for development/builds; ship prebuilt assets. Chart/table libraries are allowed only when their complexity is justified by accessibility, maintenance, size and lifecycle benefits, with licensing reviewed.
4. Preserve execution filters, detail/observations, searchable events, parameters/overrides, history and charts, recording intentional differences from legacy behavior.
5. Update data in place without reloading the page, preserving selection, order, paging, scroll, focus and chart state.
6. Deliver production live updates through shared SSISDB change detection and SSE initially; use WebSockets only for a concrete bidirectional requirement. Include reconnect/resync, heartbeats, bounded queues, visible connection state and polling fallback.
7. Validate parity, permissions, builds, database work, resources, stream/proxy capacity and rollback before retiring legacy.

Hosting remains on hold under the 15 October 2026 instruction: B5c, HOST-01/02/03, production identity/proxy/HTTPS/logging and stream capacity are deferred. Unavailable-environment acceptance remains parked under the 18 October instruction. Local application/SQL/fixture work may continue, but these holds do not turn unobserved conditions into passes or authorize shared deployment. Vite HMR and data-only polling do not satisfy production streaming.

## Next priorities

The [three-item task queue](PROGRESS.md#next-actions) owns checkbox status, bounded submilestones and evidence. All three are complete locally, with scoped independent acceptance recorded on 27 October:

1. **C8.2c resource/concurrency acceptance:** local repeated requests, cancellation/timeouts and cleanup under bounded load are independently accepted.
2. **Legacy-replacement gaps:** independent history entry, operational labels and legacy-prefix behavior are implemented and reviewed locally with regression/native/browser evidence and intentional workflow differences.
3. **Scoped integration review:** resulting frontend/API/SQL boundaries are independently accepted; reproduced focus and legacy-label compatibility findings are resolved. Independent reader/browser/workload/hosting gates remain open.

The completed broad security/performance reviews, dark-mode work and local parity inventory remain the baseline in Progress. Completing this queue does not resume parked environment/hosting work or start the later feature ideas below; those need a new priority decision.

## Delivery phases

| Phase | Deliverable and exit condition |
| --- | --- |
| 0 — baseline | Workflow/field parity, intentional differences and real query/identity baseline. |
| 1 — backend | Factory/configuration, pinned runtime, owned resources, safe failures and legacy adapter. |
| 2 — Stage C API | Read-only operations, typed SQL/JSON, bounded pages, access/redaction and workload/resource/reader acceptance. |
| 3 — first native screen | Overview/filter/list/navigation, in-place refresh and actual lifecycle acceptance; [D1a–D3c status](PROGRESS.md#phase-3--first-native-screen-preparation). |
| 4 — parity | Detail/sections/charts, keyboard/responsive behavior and supported URL mapping. [Local delivery](PROGRESS.md#phase-4--native-execution-workflows) and [replacement gaps](FRONTEND_PARITY.md#remaining-gaps-and-documentation-work) are distinct from independent environment acceptance. |
| 5 — live updates | Shared detection, production stream and [recovery/capacity checks](MODERNIZATION_PLAN.md#production-live-updates). |
| 6 — cutover | Prebuilt install, resolved parity/load/host gates, bookmark decisions, rollback rehearsal and explicit default-route switch, then obsolete UI/assets removal. |

## Acceptance budgets

The 50-row execution-page test-network p95 below one second remains a measurement target; list pages are capped at 200 rows. Measure calculated sorts separately. Set detector load/latency, queues/replay and concurrent stream/API budgets after the prototype. Keep SQL, in-process WSGI, TCP/browser and production measurements distinct.

The accepted frontend review/refactor establishes enforced ceilings of **280 KiB (286,720 bytes)** authored JS+CSS and **64 KiB (65,536 bytes)** packaged gzip. Count all recursive `.js`/`.css`: raw bytes under `web/src`, and the sum of per-file deterministic gzip-9 bytes (`mtime=0`) under `dashboard/static/app/`, including `theme-init.js`, chunks and selected libraries. After `npm --prefix web run build`, `python -m unittest tests.test_frontend_assets` checks both ceilings and the above-ceiling failure boundary. The 140-character JS line guard preserves normal source formatting. [Progress](PROGRESS.md#accepted-reviews) owns measured totals and review receipts; these ceilings do not establish network latency.

## Later

- Improve duration forecasting after reliable history and basic estimates; advanced models remain optional.
- Revisit richer table/chart interactions and clearer package-call navigation when measured use justifies them. Any tree view must respect observation/paging limits rather than infer missing execution relationships.
- Package reruns remain a possible separate product discussion, requiring a new write/identity scope; they are outside the current read-only roadmap.
