# Roadmap

Updated 12 October 2026. See [the modernization plan](MODERNIZATION_PLAN.md) for the audit, API contract, delivery phases, and validation criteria. The roadmap describes migration targets; [implementation progress](PROGRESS.md) distinguishes completed submilestones from remaining work and integration checks.

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
