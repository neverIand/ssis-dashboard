# Stage C API acceptance

Updated: 16 October 2026. C8.1 is complete locally: 337 database-free tests and the combined native replay pass. C8.2 is next. The [roadmap](roadmap.md) defines scope, [contract](API_CONTRACT.md) defines semantics and [OpenAPI](openapi.yaml) defines the response schemas. This is the combined acceptance record; individual SQL/fixture proofs remain in [progress](PROGRESS.md). C8.1 does not close C8.2 workload/resource acceptance, C8.3 independent reader HTTP, or deferred hosting/stream work.

## Operation matrix

Every row requires no-store JSON, a server-generated request ID and the documented success/problem schema. [Shared acceptance tests](../tests/test_api_acceptance.py) check this inventory against the OpenAPI 200 responses and exercises shared validation, methods, failure mapping and capability guards on the production routes. Resource-specific tests remain responsible for full ordering, precision, cursor, redaction and synthetic edge cases.

| Operation | Accepted behavior and intended legacy difference | Combined native check | C8.1 result |
| --- | --- | --- | --- |
| `GET /api/v1/meta` | Public limits/vocabularies/effective capabilities; no connection or server identity. Browser identity headers do not change SQL scope or capabilities. | Effective flags and all twelve execution sorts; zero queries. | PASS: WSGI/SQL |
| `GET /healthz` | Process health independent of SSISDB; no legacy page dependency. | Healthy during a database timeout; zero queries. | PASS: WSGI/SQL |
| `GET /readyz` | One zero-row catalog dependency query, with a one/two-second driver cap; no diagnostic exception text. | Ready, native timeout, recovery; one query per call. | PASS: WSGI/SQL |
| `GET /api/v1/folders` | Visible folder IDs/names with visible projects, unique aliases and bounded keyset paging. | Compare the full collection with independent catalog folders/projects. | PASS: WSGI/SQL |
| `GET /api/v1/projects` | Exact folder scope, literal wildcard characters and separate folder/project identity. | Compare projects for a visible folder; hidden/absent names are equivalent empty collections. | PASS: WSGI/SQL |
| `GET /api/v1/executions` | Creation-time `[from,to)` cohort including no-start rows; actual NULL timings, string BIGINTs and global orders before paging. Display settings do not replace explicit bounds. | Full ID traversal versus visible independent SQL; reuse returned bounds for metrics; detail IDs remain usable. | PASS: WSGI/SQL |
| `GET /api/v1/metrics/summary` | All statuses in the same folder/project/creation cohort, even when the list selects succeeded only. No current-status-at-a-past-time claim. | Counts and total versus the entire independent cohort; selected-status list count matches that status card. | PASS: WSGI/SQL |
| `GET /api/v1/metrics/timeline` | Zero-filled IANA calendar buckets over the selected creation cohort. Starts/successes/failures describe those created executions, not separate start/end-time throughput buckets. | Each bucket versus independently grouped creation timestamps and selected statuses; totals match the selected list. | PASS: WSGI/SQL |
| `GET /api/v1/executions/{id}` | Visible execution lookup independent of overview time range. Counts include recorded NULL-ID events and use one conditional aggregation. | Common fields versus list/history; all five event categories versus independent SQL. | PASS: WSGI/SQL |
| `GET /api/v1/executions/{id}/executables` | Observed statistics identity; nullable incomplete timings and result codes distinct from execution status. | Full statistics-ID traversal and execution identity versus the public statistics view. | PASS: WSGI/SQL |
| `GET /api/v1/executions/{id}/children` | Exact invocation/path observations; ambiguous/missing ends stay incomplete. Unidentified starts are explicit unknown coverage. | Identified start IDs and unidentified coverage versus independently selected raw start events. | PASS: WSGI/SQL |
| `GET /api/v1/executions/{id}/events` | Default capability denied before SQL. Once enabled: full-source literal Unicode search/category filtering, bounded text and explicit unknown coverage for NULL IDs. | Five category traversals/counts versus visible raw events and detail counters; hidden/absent IDs have identical 404. | PASS: WSGI/SQL |
| `GET /api/v1/executions/{id}/values` | Default capability denied; parameters/overrides are separate pages. Sensitive values always NULL; override display requires its additional policy flag. | Both ID inventories and sensitive/policy markers versus independent metadata, without reading sensitive source values. | PASS: WSGI/SQL |
| `GET /api/v1/history` | Exact folder/project/package, no overview date scope, bounded ID pages and separate estimates. Latest five prior visible successes exclude self/future runs; actual ends are retained. | Full default history versus independent identity/status selection and estimate calculation; common fields match detail/list. | PASS: WSGI/SQL |

## Shared boundary checks

Run `python -m unittest discover -s tests -v` with [development requirements](../requirements-dev.txt). The four combined acceptance tests cover every production GET's unknown input, body rejection, safe 405/Allow, no-store/request IDs, unavailable/timeout/unexpected driver failures, zero-SQL guards and metadata/liveness independence. These driver failures are injected database-free cases, not real authentication/permission or timeout evidence. Existing tests separately cover safe conversion/cleanup failures, typed payloads and cursor policies.

The native combined replay uses one in-process WSGI application and current public SSISDB views. Independent SQL controls validate navigation, the creation cohort, statuses/buckets, recorded event categories, observation/value IDs and history estimates. Local policies are changed only inside that process. Existing administrator/normal/restricted SQL contexts are tested; reader contexts use administrator-session `EXECUTE AS LOGIN`, which is not independent Windows-reader sign-in or TCP HTTP.

| Current-catalog case | Administrator | Normal SQL reader | Restricted SQL reader |
| --- | --- | --- | --- |
| Visible executions | 16 | 16 | 2 |
| Selected creation cohort / succeeded list | 11 / 10 | 11 / 10 | 1 / 1 |
| Selected execution's recorded events / statistics | 120 / 14 | 120 / 14 | 20 / 2 |
| Child observations / default history rows | 4 / 2 | 4 / 2 | 0 / 1 |
| Parameters / sensitive parameters in that execution | 10 / 0 | 10 / 0 | 15 / 1 |
| Additional populated override policy case | One row, disabled/enabled | One row, disabled/enabled | One row, disabled/enabled |

All three contexts also pass empty-cohort list/summary/timeline agreement and policy-change cursor rejection before SQL. The restricted context has hidden executions and passes normalized hidden/absent equivalence on all five execution-scoped operations. Administrator/normal contexts see every current execution, so an additional hidden-ID comparison is not applicable to them. The actual sensitive parameter stays redacted; current override examples are nonsensitive. Sensitive-override and other synthetic boundary proofs remain in C6's existing tests/evidence.

## Evidence and remaining gates

Final retained replay: **1,249 assertions / 118 schema-validated WSGI responses / 171 application queries PASS**. Three SQL contexts each cover all fourteen operations. The expected response split is 82 success, twelve capability 403, three policy-bound cursor 400, twenty hidden/absent 404 and one native timeout 504. The timeout is the only failed query; every owned query cleans up successfully. Raw bodies, log captures, account/connection details and reusable native tools stay ignored under `.local/backend-validation/`. No package execution, catalog writes, grants, persistent objects, cache flushes, TCP server or production rollout is needed for C8.1.

Largest body is **56,381 bytes** (events); successful handler observations range from sub-millisecond liveness to **2,847 ms** (executions). Executable pages take **1,184–1,614 ms** and timeline **1,534–1,833 ms** in this small replay. These are recorded observations, not representative workload/p95 acceptance or a latency target pass. C8.2 must investigate the remaining driver binding, compilation and source-work costs before making a performance claim. Single-request query budgets pass: metadata/liveness zero, readiness/summary/timeline one, detail two, and first scoped collection pages at most three. A final owned-helper/database-request audit passes; repeated/concurrent accumulation remains C8.2 work.

Private evidence: `.local/backend-validation/runs/c8-acceptance-20261016T175637109241Z/acceptance.private.json` and its offline `acceptance-summary.private.json`. Reusable ignored tools are `probe-api-acceptance.py` and `summarize-api-acceptance.py`. Earlier exploratory selections are excluded from these totals. No real active/Scale Out workload was created or exercised.

| Check | Status / required evidence |
| --- | --- |
| Production-route boundary suite and existing regressions | PASS: 337 tests (333 previous + four combined tests); 111 additional production-route requests in the four tests, with no real database access. |
| Combined native WSGI/SQL journey and existing reader scope | PASS locally: 1,249 assertions, all fourteen operations in all three SQL contexts, independent comparisons, safe negative paths and clean owned resources. This is SQL impersonation/WSGI evidence. |
| Native readiness timeout and recovery | PASS: driver HYT00, safe 504 in 1,007 ms, one failed query with clean cleanup; liveness still succeeds with zero queries and the next readiness returns ready in 60 ms with one query. This is a driver-cap observation, not an end-to-end deadline guarantee. |
| C8.2 representative workload/p95/cold-warm/compile/IO | NOT RUN for API-wide acceptance. Individual milestone measurements are evidence, not a capacity claim. Include remaining nullable-bind overhead and narrow history-source growth. |
| C8.3 independent normal/restricted Windows-reader HTTP | NOT RUN for Stage C. Older Stage B actual-reader checks do not cover the completed API. Record actual process identity, sanitized request manifest and independent SQL for the same identity; never administrator impersonation as a substitute. |
| Reader SHOWPLAN and real Scale Out/active workloads | NOT RUN where permission/workload is unavailable. Keep explicit coverage gaps; no permission changes or package runs are implied. |
| OBS-02 native cleanup-failure observation | NOT RUN; synthetic failures and successful native cleanup do not close this case. |
| B5c / production authentication, transport, host logs and stream | Deferred under the existing hosting decision; no Stage C evidence passes these gates. |

C8.3 must run the completed request inventory through actual loopback HTTP under each reader's real Windows process identity, using secure local credential entry when needed. Record process identity and independent SQL visibility under the same identity, effective capabilities, the fourteen success paths, hidden/absent equivalence, redaction, safe failures and sanitized per-request evidence. Administrator-session impersonation and the old fifteen-request Stage B legacy replay do not satisfy this gate. Do not request passwords in chat. Production authentication/proxy exposure stays deferred.

After C8, preserve the separately requested performance/correctness code review in [progress](PROGRESS.md#stage-c--read-only-api-delivery-phase-2).
