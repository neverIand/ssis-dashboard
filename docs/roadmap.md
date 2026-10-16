# Roadmap

Updated 16 October 2026. See [the modernization plan](MODERNIZATION_PLAN.md) for the audit, API contract, delivery phases, and validation criteria. The roadmap describes migration targets; [implementation progress](PROGRESS.md) distinguishes completed submilestones from remaining work and integration checks.

The [backend checklist](BACKEND_CHECKLIST.md) holds procedures, results and the Windows/SQL Server baseline: **25 of 30 cases now PASS**, including all designed fixtures and both actual Windows reader accounts. [SSIS fixture steps 7–10](SSIS_FIXTURE_PROJECT_GUIDE.md) are complete. C1b now proves opt-in typed datetimeoffset conversion on that baseline; native cleanup-failure observation remains open and B5a3/P0b retain their incomplete status.

**Hosting is on hold at the user's request (15 October 2026).** Defer B5c, HOST-01/02/03, service/container deployment, production authentication/proxy/HTTPS/host-log configuration, and production stream/proxy capacity validation until reprioritized. Continue local database permissions, fixtures, application behavior and non-hosting implementation independently. The migration targets below remain in scope for later delivery.

**Stage C / delivery phase 2, the read-only API, is in progress.** C1a defines the [draft contract and local access policy](API_CONTRACT.md), with concrete schemas/examples in [OpenAPI](openapi.yaml). C1b/C1c implement exact typed SQL/JSON and shared HTTP boundaries, metadata and health resources. C2a/C2b add bounded execution pages and all 12 global sorts with exact cursor keys. C3a adds navigation; C3b/C3c add all-status summary and selected-status timelines with IANA calendar/DST buckets. C4a adds execution detail and five recorded event counts; C4b adds bounded executable statistics. C4c adds bounded child invocation observations with conservative path/source/occurrence matching. C5 adds capability-gated event pages, five categories, full-source literal Unicode search and bounded text. Children/events explicitly flag matching records without numeric IDs as unknown coverage; no GUID or invented identity substitutes for an event ID. C6 adds separate parameter/override ID pages with SQL and serializer redaction, original type labels and bounded display values. Thirteen operations are implemented and history remains planned; 308 local tests, native SQL/reader-scope comparisons, measured plans and reader I/O checks pass. Ordinary pages select bounded IDs before wide enrichment; cached parameterized queries avoid unconditional recompilation. Actual source scans, compilation, timings, policy-dependent LOB reads and reader/workload tradeoffs are recorded in progress. C7a exact-package history is next, followed by C7b estimates. Reader SHOWPLAN, independent reader HTTP, real Scale Out, deep-page/repeated-key work and representative-workload acceptance remain C8 checks. The [Stage C task breakdown](PROGRESS.md#stage-c--read-only-api-delivery-phase-2) records dependencies and exit checks. Native cleanup-failure observation stays open; hosting remains deferred. The first native screen's list/navigation/summary prerequisites pass locally; full API and production live-update completion retain their separate gates.

The [C2/C3 performance follow-up](PROGRESS.md) separates ordinary and calculated sorting, materializes page event counts before unrelated joins, and reuses navigation plans. Native plans prove fewer event scans/reads and a 201-row ordinary-page materialization bound on a transient 20,000-row cohort. Future query changes must assess operation counts and compilation as well as latency; the broader C8 workload/p95 checks remain open.

## Current

- Flask/Jinja renders the dashboard from SSISDB catalog queries.
- The frontend uses legacy jQuery, Bootstrap, DataTables, SmartMenus, and Morris/Raphael assets.
- Automatic refresh reloads the whole page after 180 seconds.

## Modernization

1. Establish the workflow/query baseline and refactor configuration, database access, connection ownership, and error handling.
2. Expose a documented, read-only `/api/v1` JSON API with filtering, bounded pagination, typed data, and appropriate access controls.
3. Build the frontend with vanilla ES modules and authored CSS. **Vite is allowed** for development and production builds; deploy prebuilt assets.
4. Replace obsolete frontend dependencies. **Chart and table libraries are allowed when complexity justifies them**; compare capability, accessibility, maintenance, size, and licensing. Bundle chosen libraries locally.
5. Preserve execution filtering, details, child packages, searchable events, parameters/overrides, history, and charts while migrating screen by screen.
6. **Eliminate full-page refresh for automatic and manual dashboard updates.** Add an HTTP stream using SSE as the initial recommendation, or WebSockets if bidirectional needs justify them. Update affected views in place and preserve filters, sorting, paging, scroll, focus, and chart state.
7. Make live updates resilient: reconnect/resync, heartbeats, bounded queues, hidden-tab recovery, visible connection status, and data-only HTTP polling fallback. Share backend SSISDB change detection across subscribers and validate proxy/worker capacity; a browser stream does not itself detect database changes.
8. Validate feature parity, permissions, production builds, query load, stream reliability, and rollback before retiring the legacy UI.

## Later

- Improve execution-duration forecasting after historical data and basic estimates are reliable; advanced models are optional.
- Revisit richer table/chart interactions and streaming infrastructure based on measured usage.

Vite's development HMR and production monitoring updates are separate features. The live-update milestone requires a working production stream, even if ordinary data fetching provides the first usable migration screen.
