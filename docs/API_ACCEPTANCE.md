# Stage C API acceptance

Updated: 17 October 2026. C8.1/C8.2a/C8.2b.1 and C8.2b.2a's [execution-cardinality/reader SQL slice](API_WORKLOAD.md#c82b2a-retained-execution-cardinality-results) are complete locally. The existing 341-test application baseline is unchanged. Observation/aggregate/history workloads, measured remedies/budgets, resource acceptance and independent reader HTTP remain open; the test-network target is not passed. The [roadmap](roadmap.md), [contract](API_CONTRACT.md), [OpenAPI](openapi.yaml) and [progress](PROGRESS.md) retain their scope and separate integration gates.

## Operation matrix

Every row requires no-store JSON, a server-generated request ID and the documented success/problem schema. [Shared acceptance tests](../tests/test_api_acceptance.py) check this inventory against the OpenAPI 200 responses and exercises shared validation, methods, failure mapping and capability guards on the production routes. Resource-specific tests remain responsible for full ordering, precision, cursor, redaction and synthetic edge cases.

| Operation | Accepted behavior and intended legacy difference | Combined native check | Local result |
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

Run `python -m unittest discover -s tests -v` with [development requirements](../requirements-dev.txt). The four combined HTTP tests cover every production GET's unknown input, body rejection, safe 405/Allow, no-store/request IDs, unavailable/timeout/unexpected driver failures, zero-SQL guards and metadata/liveness independence. A further acceptance test requires every API bind marker to belong to an explicit SQL declaration, the precondition for optimized NULL binding. These driver failures are injected database-free cases, not real authentication/permission or timeout evidence. Existing tests separately cover safe conversion/cleanup failures, typed payloads and cursor policies.

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

C8.1 baseline replay: **1,249 assertions / 118 schema-validated WSGI responses / 171 application queries PASS**. Three SQL contexts each cover all fourteen operations. The expected response split is 82 success, twelve capability 403, three policy-bound cursor 400, twenty hidden/absent 404 and one native timeout 504. The timeout is the only failed query; every owned query cleans up successfully. Raw bodies, log captures, account/connection details and reusable native tools stay ignored under `.local/backend-validation/`. No package execution, catalog writes, grants, persistent objects, cache flushes, TCP server or production rollout is needed for C8.1.

Largest body is **56,381 bytes** (events); C8.1 successful handler observations range from sub-millisecond liveness to **2,847 ms** (executions). Executable pages take **1,184–1,614 ms** and timeline **1,534–1,833 ms** in that baseline. These are recorded observations, not representative workload/p95 acceptance or a latency target pass. Single-request query budgets pass: metadata/liveness zero, readiness/summary/timeline one, detail two, and first scoped collection pages at most three. An owned-helper/database-request audit passes; repeated/concurrent accumulation remains C8.2c work.

Private evidence: `.local/backend-validation/runs/c8-acceptance-20261016T175637109241Z/acceptance.private.json` and its offline `acceptance-summary.private.json`. Reusable ignored tools are `probe-api-acceptance.py` and `summarize-api-acceptance.py`. Earlier exploratory selections are excluded from these totals. No real active/Scale Out workload was created or exercised.

### C8.2a binding follow-up

The API's explicitly typed SQL batches opt into a driver-provided NULL marker, preserving SQL NULL and all non-NULL input values while bypassing costly type discovery. Legacy defaults and SQL resources are unchanged. Three interleaved samples across all 25 SQL resources produce **300 identical typed-result comparisons**. Query medians fall **3,967 → 523 ms** for ordinary execution pages, **1,713 → 29 ms** for executable pages and **1,977 → 27 ms** for timeline; these measurements exclude connection setup. All fourteen nullable-resource plan pairs preserve outputs and do not increase source work. Thirteen preserve exact source work; event enrichment improves from **672 → 4** event-table rows and **1,515 → 51** total source logical reads on the retained catalog pair. These are local comparisons; workload, compilation and reader-distribution acceptance remain open.

Eight affected fixture/precision replays pass **141,621 assertions / 770 schema responses / 1,414 queries**, including NULL/tied cursor keys, Unicode/DST/precision, all twelve sorts and redaction. The 6,345-unit XML input independently returns identical 72-bucket typed results. The final combined replay again passes **1,249 assertions / 118 responses / 171 queries**, preserving all three reader scopes, bytes and query budgets. The sole expected native timeout is **HYT00/504 after 1,036 ms**; readiness recovers in **25 ms**, and every query cleans up. Current-catalog handlers vary across acquisition/query costs: executions **116–762 ms**, timeline **18–179 ms**, executables **187–1,063 ms**; unchanged resources also vary from the separate C8.1 run. Separate-run handler ranges do not establish overall speedup or p95.

A same-process paired on/off check adds **198 assertions / 66 successful WSGI responses / 144 queries**, with identical per-route data/bytes and clean owned resources. Three interleaved samples give handler medians **5,042 → 719 ms** for a created-time execution list, **2,789 → 17 ms** for timeline and **2,001 → 144 ms** for executables. Two unchanged controls also vary; their timing differences are not gains from this fix. Representative workload/p95 remains C8.2b.

Private combined evidence is `.local/backend-validation/runs/c8-acceptance-20261016T182335365627Z/acceptance.private.json` and its offline summary. The [C8.2a progress record](PROGRESS.md#c82a--measured-null-binding) records parameter inventory, paired measurements, native fixture/plan files and the explicit binding precondition.

### C8.2b.1 defined workload baseline

The [protocol and complete result table](API_WORKLOAD.md) now define twenty scenarios across all fourteen operations. Two warmups per case precede 100 round-robin samples: **2,000 schema responses / 3,700 queries PASS**. Source fingerprints, data, unique request IDs, row/query bounds and owned cleanup pass. Five fresh clients per operation add **70 schema responses / 125 queries**; **87 native diagnostic calls** cover 29 parameter sets/all 25 SQL resources. Client startup, observed SQL cache state, timed API phases and untimed plan/IO/compile observations are separate.

Four sixteen-row execution pages have local WSGI p95 **1,064–1,092 ms**; the proposed full 50-row/network target is **not passed**. Execute phases dominate their medians; repeated statement compilation and ordinary logging enrichment are measured follow-ups. Cached plan metadata is not recurring compile time. Maximum body is **26,204 bytes** on a 50-event continuation; wide-text/full-page workloads remain open. Existing administrator visibility and fresh processes do not prove normal/restricted reader HTTP. No runtime/SQL/dependency change was made for this baseline.

### C8.2b.2a execution-cardinality and SQL readers

The [full result table and scope limits](API_WORKLOAD.md#c82b2a-retained-execution-cardinality-results) add 20,000 matching temporary executions, maximum-width names, full 50/max-200 pages, selective/deep cases and actual NULL-block continuations. **153 API responses / 242 queries**, **1,700 native samples / 3,000 batches**, **69 actual-plan/IO diagnostics** and **36 configured/normal/restricted SQL diagnostics plus twelve controls** pass. Ordinary materialization remains 51/201; calculated global cohorts retain their complete metrics. Model p95 is 303–584 ms for broad ordinary pages and 4,716–5,905 ms for calculated pages; source/cache/cleanup/transport differences prevent a network-budget or API-overhead inference.

Fresh source plans capture spills in six scenarios and substantial calculated temporary work. Restricted SQL scope returns two rows with 16,557/16,633 persistent-source logical reads, versus 368/233 for the sixteen-row configured/global-reader scope. Reader SHOWPLAN permissions remain zero. C8.2b.3 must preserve exact results, global order and ordinary bounds while comparing these costs; independent sign-in/HTTP, capacity and remaining workloads stay open. The 341-test suite is a retained baseline, not a new test run for this documentation/native-workload task.

| Check | Status / required evidence |
| --- | --- |
| Production-route boundary suite and existing regressions | PASS: 341 tests (337 at C8.1 + four binding/declaration tests); the four combined HTTP tests retain their 111 production-route requests, with no real database access. |
| Combined native WSGI/SQL journey and existing reader scope | PASS locally: 1,249 assertions, all fourteen operations in all three SQL contexts, independent comparisons, safe negative paths and clean owned resources. This is SQL impersonation/WSGI evidence. |
| Native readiness timeout and recovery | PASS: final C8.2a driver HYT00, safe 504 in 1,036 ms, one failed query with clean cleanup; liveness succeeds with zero queries and the next readiness returns ready in 25 ms with one query. This is a driver-cap observation, not an end-to-end deadline guarantee. |
| C8.2a nullable-bind inventory/fix | PASS locally: all 25 resources profiled; all fourteen nullable-resource actual-plan/IO pairs, affected fixtures, long XML, exact typed results and combined reader-scope replay pass. |
| C8.2b.1 defined current-catalog workload | PASS as a local baseline: twenty cases × 100 warm samples, seventy fresh-client first responses and 87 native diagnostics; all recorded data/outcome/cleanup checks pass. Four execution p95s exceed one second on sixteen rows; no production/network/full-page budget pass. |
| C8.2b.2a execution-cardinality / reader SQL slice | PASS locally: 153 schema responses, seventeen cases × 100 native SQL samples, 69 source-work/plan diagnostics, 36 actual-catalog reader diagnostics plus twelve controls. Full 50/max-200/deep/NULL continuations and exact insert bounds pass. Temporary-source timing is not full-page/network acceptance. |
| C8.2b.2b/.2c/.3 remaining workloads / fixes / budgets | OPEN. Dense observation/text, repeated keys, summary/1,000 buckets/history growth remain. Calculated-cohort/temporary work, captured sort spills, fresh compilation and restricted-reader public-view IO need measured remedies and budget accounting. |
| C8.2c sustained/concurrent resource accumulation | NOT RUN. Clean owned resources in individual replays/final audits do not prove repeated/concurrent capacity. |
| C8.3 independent normal/restricted Windows-reader HTTP | NOT RUN for Stage C. Older Stage B actual-reader checks do not cover the completed API. Record actual process identity, sanitized request manifest and independent SQL for the same identity; never administrator impersonation as a substitute. |
| Reader SHOWPLAN and real Scale Out/active workloads | NOT RUN where permission/workload is unavailable. Keep explicit coverage gaps; no permission changes or package runs are implied. |
| OBS-02 native cleanup-failure observation | NOT RUN; synthetic failures and successful native cleanup do not close this case. |
| B5c / production authentication, transport, host logs and stream | Deferred under the existing hosting decision; no Stage C evidence passes these gates. |

C8.3 must run the completed request inventory through actual loopback HTTP under each reader's real Windows process identity, using secure local credential entry when needed. Record process identity and independent SQL visibility under the same identity, effective capabilities, the fourteen success paths, hidden/absent equivalence, redaction, safe failures and sanitized per-request evidence. Administrator-session impersonation and the old fifteen-request Stage B legacy replay do not satisfy this gate. Do not request passwords in chat. Production authentication/proxy exposure stays deferred.

After C8, preserve the separately requested performance/correctness code review in [progress](PROGRESS.md#stage-c--read-only-api-delivery-phase-2).
