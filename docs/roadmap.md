# Roadmap

Updated 16 October 2026. See [the modernization plan](MODERNIZATION_PLAN.md) for the audit, API contract, delivery phases, and validation criteria. The roadmap describes migration targets; [implementation progress](PROGRESS.md) distinguishes completed submilestones from remaining work and integration checks.

The [backend checklist](BACKEND_CHECKLIST.md) holds procedures, results and the Windows/SQL Server baseline: **25 of 30 cases now PASS**, including all designed fixtures and both actual Windows reader accounts. [SSIS fixture steps 7–10](SSIS_FIXTURE_PROJECT_GUIDE.md) are complete. C1b now proves opt-in typed datetimeoffset conversion on that baseline; native cleanup-failure observation remains open and B5a3/P0b retain their incomplete status.

**Hosting is on hold at the user's request (15 October 2026).** Defer B5c, HOST-01/02/03, service/container deployment, production authentication/proxy/HTTPS/host-log configuration, and production stream/proxy capacity validation until reprioritized. Continue local database permissions, fixtures, application behavior and non-hosting implementation independently. The migration targets below remain in scope for later delivery.

**Stage C / delivery phase 2, the read-only API, is in progress.** C1a defines the [draft contract and local access policy](API_CONTRACT.md), with concrete schemas/examples in [OpenAPI](openapi.yaml). C1b/C1c implement exact typed SQL/JSON and shared HTTP boundaries, metadata and health resources. C2a/C2b add bounded executions and all 12 global sorts; C3a adds navigation, and C3b/C3c add summary and IANA calendar/DST timelines. C4a/C4b/C4c add execution detail, executable statistics and conservative child observations. C5 adds searchable Unicode event pages and explicit unknown coverage for missing numeric IDs; C6 adds separate value sections with SQL and serializer redaction. C7a adds exact folder/project/package history with explicit status scope, bounded ID paging and actual timings; C7b adds separate estimates from the latest five valid visible successes completed by each target start. All fourteen operations are implemented; 341 local tests, native SQL/reader-scope comparisons, measured plans and reader I/O checks pass. Ordinary pages select bounded IDs before enrichment; event aggregation is isolated from logging joins, navigation reuses cached plans, and execution recompilation costs remain under review. Actual source scans, compilation, timings and reader/workload tradeoffs remain recorded. C8.1 combined acceptance, C8.2a measured NULL binding and C8.2b.1's [defined current-catalog workload](API_WORKLOAD.md) pass locally. Four local execution-page p95s exceed one second on sixteen rows; the full-page/network target remains open. C8.2b.2 larger/reader SQL workloads, C8.2b.3 measured fixes/budgets, C8.2c resource accumulation and C8.3 independent reader acceptance remain required. Operation coverage and local estimates do not complete Stage C. Reader SHOWPLAN, independent reader HTTP, real Scale Out, deep-page/repeated-key work and representative-workload acceptance remain C8. The [Stage C task breakdown](PROGRESS.md#stage-c--read-only-api-delivery-phase-2) records dependencies and exit checks. Native cleanup-failure observation stays open; hosting remains deferred. The first native screen's prerequisites pass locally; full API and production live-update completion retain their separate gates.

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
