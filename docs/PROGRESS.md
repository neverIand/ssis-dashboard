# Implementation progress

Updated 17 October 2026. Development base: `dev-next`; reviewed baseline: `36b48f8`. [Roadmap](roadmap.md) owns scope; [the plan](MODERNIZATION_PLAN.md) owns architecture. This file owns status and next actions. Detailed results belong in [API validation](API_ACCEPTANCE.md) and the [backend checklist](BACKEND_CHECKLIST.md).

**Stage C remains in progress.** All 14 GET operations and all 12 execution sorts are implemented; the three review remedies pass their [recorded local checks](API_ACCEPTANCE.md#sql-remedies-replay-17-october-2026). Representative workload, resource and independent API reader acceptance remain open. The first native overview's API prerequisites are available; frontend work is a separate milestone.

**Next task: D1 / first native screen foundation.** On 17 October 2026 the user prioritized preparing delivery phase 3. The remaining C8 checks do not block local frontend development; retain them for API acceptance and before cutover/shared deployment. No Stage C acceptance item is waived or marked complete by this sequencing decision. Hosting remains deferred.

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

Phases 3–6 remain planned, with production validation deferred. [The roadmap](roadmap.md#delivery-phases) defines their deliverables and exit conditions; [the plan](MODERNIZATION_PLAN.md#rollout-and-rollback) defines coexistence and rollback.

### Phase 3 / first native screen preparation

These bounded tasks implement the existing phase 3 scope; they do not start parity, production hosting or streaming work.

| ID | Status | Deliverable and validation |
| --- | --- | --- |
| D1 | Planned — next | Add the `/app/` shell and browser source/build boundary using vanilla modules and authored CSS. Serve packaged assets from Flask alongside legacy routes. Verify a reproducible production build, asset/base-path handling, and unchanged legacy/API/health routes. |
| D2 | Planned | Connect folder/project/time/status filters, summary cards and the execution list. Preserve server-side global sorting and cursor paging, reuse resolved creation bounds across list/metrics, and link visible executions to existing details. Verify empty/error/loading states and the filter → list → detail-link path. |
| D3 | Planned | Add manual and data-only polling refresh with preserved filters, sort, page, scroll and focus. Guard stale responses, prevent overlapping refreshes and resync after hidden-tab return. Verify browser behavior, keyboard/narrow layouts, literal text rendering and the recorded frontend bundle budget. |

Stage C closes only after its remaining contract/SQL/HTTP/workload/resource/reader checks pass and deferred production gates are explicitly carried forward. Do not close it from operation coverage or this review alone.
