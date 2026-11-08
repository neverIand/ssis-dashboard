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

The [task queue](PROGRESS.md#next-actions) owns checkbox status, bounded submilestones and evidence. The previous queue (C8.2c, legacy-replacement gaps, scoped integration review and unscoped History) is complete locally. On 4 November 2026 the user set this order:

1. **Budget and queue:** record the per-page budget model and the raised authored ceiling.
2. **Recorded observations:** reproduce or measure the open frontend follow-ups (timeline refresh shift, maximum-text disclosure cost, P4.5 focus) before fixing them.
3. **P5.1 change detection:** a local, owned, bounded SSISDB detector for new executions and active-state transitions, with measured SQL work. SSE transport and production stream acceptance stay under the hosting hold.

All three, plus the inserted UX review batches A and B, are complete locally as of 8 November 2026, and the P5.2 decision record is written. UX review batch C (API-backed O3/D3/O11) followed on 8 November 2026 and is complete locally ([progress](PROGRESS.md)); the user made active-run estimates opt-in with a per-process cache. The next priority needs the user's decision: a loopback-only P5.2 stream prototype (the SSE transport is currently under the hosting hold), or another item.

Environment-blocked gates (C8.3, reader SHOWPLAN, real active/Scale Out, actual browser conditions, hosting) keep their holds. The later feature ideas below still need their own priority decision.

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

The user-facing budget is what one native page loads. Enforced ceilings are **64 KiB (65,536 bytes)** packaged gzip and **320 KiB (327,680 bytes)** authored JS+CSS; the user raised the authored ceiling from 280 KiB on 4 November 2026, accepting larger source while per-page loads stay reasonable. Count all recursive `.js`/`.css`: raw bytes under `web/src`, and the sum of per-file deterministic gzip-9 bytes (`mtime=0`) under `dashboard/static/app/`, including `theme-init.js`, chunks and selected libraries. After `npm --prefix web run build`, `python -m unittest tests.test_frontend_assets` checks both ceilings and the above-ceiling failure boundary. The 140-character JS line guard preserves normal source formatting. Each frontend milestone records its authored and packaged deltas. [Progress](PROGRESS.md#accepted-reviews) owns measured totals and review receipts; these ceilings do not establish network latency.

The build is one entry bundle shared by overview, detail and History; hashed assets are cached as immutable, so moving between screens downloads nothing further. A 4 November probe split per screen: initial gzip loads became about 32 KB (overview), 36 KB (detail) and 26 KB (History), versus 49 KB unsplit, at the cost of more requests and about 4 KB more across all three. Do not split now. Introduce per-screen dynamic imports when a screen adds a heavy library or the shared bundle approaches the packaged ceiling, and then change the packaged check to each screen's initial closure (entry, static imports, CSS and `theme-init.js`) with lazy chunks counted separately.

## Later

- Improve duration forecasting after reliable history and basic estimates; advanced models remain optional.
- Revisit richer table/chart interactions and clearer package-call navigation when measured use justifies them. Any tree view must respect observation/paging limits rather than infer missing execution relationships.
- Package reruns remain a possible separate product discussion, requiring a new write/identity scope; they are outside the current read-only roadmap.
