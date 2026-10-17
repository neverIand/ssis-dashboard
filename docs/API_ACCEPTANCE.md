# API validation

This document owns correctness coverage, workload protocols and dated results. [The contract](API_CONTRACT.md) defines behavior; [progress](PROGRESS.md#remaining-acceptance) owns completion status and open gates. Stage C acceptance remains incomplete.

- [Operation matrix](#operation-matrix) and [shared boundary checks](#shared-boundary-checks)
- [Workload protocol](#workload-protocol): cases, sampling, SQL diagnostics and evidence
- [Review replay](#review-replay-17-october-2026) and [post-remedy replay](#sql-remedies-replay-17-october-2026)
- [Milestone evidence](#retained-evidence), [current-catalog measurements](#c82b1-retained-baseline), [20,000-execution results](#c82b2a-retained-execution-cardinality-results) and [SQL remedies](#c82b3-execution-query-remedies)

## Operation matrix

Every row requires no-store JSON, a server-generated request ID and the documented success/problem schema. [Shared acceptance tests](../tests/test_api_acceptance.py) check this inventory against the OpenAPI 200 responses and exercise shared validation, methods, failure mapping and capability guards on the production routes. Resource-specific tests remain responsible for full ordering, precision, cursor, redaction and synthetic edge cases.

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

Run the [tracked test suite](installation.md#test-and-diagnose). Tracked tests cover every production GET's unknown/duplicate/empty/invalid input, request body rejection, safe 405/Allow, no-store/request IDs, driver-error mapping and zero-SQL capability guards. Resource tests cover typed data, sorting, NULL/tie precision, cursor binding, redaction and failure cleanup. Contract tests validate OpenAPI/references/examples and invalid instances. Every API bind marker must have an explicit SQL type declaration before optimized NULL binding can be used.

Database-free tests replace the query boundary or driver; they do not execute SQL semantics or prove native permissions/timeouts. Native replays independently compare public catalog navigation, cohorts, counts/buckets, observation/value identities and history estimates. Reader `EXECUTE AS LOGIN` checks SQL scope but do not prove actual Windows sign-in/TCP HTTP.

Expected query budgets: metadata/liveness zero; readiness/summary/timeline one; detail two; navigation/execution/history first pages at most two; observation/value first pages at most three. Continuations omit the initial fence. Hidden/absent execution-scoped operations stop after one lookup; denied capabilities and invalid inputs use zero queries.

## Workload protocol

Retained measurements keep their original dates, revisions, source sizes and identity scope. Local SQL and in-process WSGI timings do not pass the proposed full-page/test-network target.

### Current-catalog baseline

Use the existing private local validation configuration and public SSISDB views. Record interpreter, driver/server version, source counts, SQL role/visibility, effective capabilities, UTC window, code revision, sample order and start/end times in ignored evidence. Export only sanitized counts/timings to tracked documents. Preserve SQL settings, catalog data, permissions and shared caches. No package runs, TCP server, service changes or new dependencies are required.

Choose the successful execution with the most eligible child starts (`OnPreExecute`, exact `\Package` package path, a nested execution path), using execution ID as a descending tie-breaker. Its UTC creation day supplies explicit `[from,to)` bounds reused across execution list/metrics. Navigation/history use its exact folder/project/package; choose an existing populated override execution separately. Keep events/parameters enabled and override value display disabled within the benchmark application. Redaction remains enforced.

| Case | GET operation / selection | Maximum application queries |
| --- | --- | --- |
| meta | `/api/v1/meta` | 0 |
| live | `/healthz` | 0 |
| ready | `/readyz` | 1 |
| executions-id | `/api/v1/executions`, `limit=50`, ID descending, explicit window, all statuses | 2 |
| executions-created | Same cohort/limit, created-time descending | 2 |
| executions-duration | Same cohort/limit, calculated duration descending | 2 |
| executions-errors | Same cohort/limit, calculated error count descending | 2 |
| folders | `/api/v1/folders`, `limit=50`, name ascending | 2 |
| projects | `/api/v1/projects`, exact folder, `limit=50`, name ascending | 2 |
| summary | `/api/v1/metrics/summary`, same creation window, all statuses | 1 |
| timeline | `/api/v1/metrics/timeline`, same window, hourly buckets, all statuses | 1 |
| detail | `/api/v1/executions/{id}` | 2 |
| executables | `/api/v1/executions/{id}/executables`, `limit=50`, started-time ascending | 3 |
| children | `/api/v1/executions/{id}/children`, `limit=50`, started-time ascending | 3 |
| events-first | `/api/v1/executions/{id}/events`, `limit=50`, message-time ascending, all events | 3 |
| events-next | Same selection and a valid continuation from the first page | 2 |
| parameters | `/api/v1/executions/{id}/values`, parameters, `limit=50` | 3 |
| overrides | Same operation for a populated override execution, overrides, display policy disabled | 3 |
| history | `/api/v1/history`, exact names, default status scope, `limit=50` | 2 |
| empty-executions | ID page with explicit empty UTC day, all statuses | 1 |

If a required source example is unavailable, record `NOT RUN` for that case; do not relabel an empty result as a populated or full-page workload. Other sorts, larger data, selective filters, repeated child keys, 1,000 buckets, maximum text/pages and readers belong to C8.2b.2. Current-catalog row counts may be below 50 and do not pass the proposed full-page budget.

### Sampling and timing

- **Warm client / observed SQL cache:** one application process; each query still owns/closes its own connection and cursor. Run two untimed requests per case, then 100 serial round-robin rounds over the fixed case order. Record every observation, including failures/outliers. Report median, nearest-rank p95 (`sorted[ceil(0.95*n)-1]`) and maximum separately per case; do not pool unlike cases or extrapolate production throughput from serial latency. SQL data/plan caches retain their observed state, with recompiling statements identified separately.
- **Fresh client / observed SQL cache:** five new interpreter processes per unique operation, each making that operation's first request. Record client setup separately from the first handler duration and overall child-process wall time. Client setup includes Python/sampler imports, configuration, application construction and instrumentation; it is not production-server startup. Schema-tool imports and validation happen in the parent after the measured response. Only representative default cases enter this set. Report all five observations and range/median, without a cold p95. No OS/data/plan-cache coldness is implied.
- **Driver phases:** time connection acquisition, timeout/converter setup, cursor acquisition, execute, fetch and each close using a private proxy around the same native driver calls. Preserve arguments and connection ownership. Correlate with safe `query_completed` reports. Mapping/application/serialization/logging time remains a labeled residual; instrumentation/schema-validation overhead is not silently counted as database execution.
- **Request boundary:** measure `test_client.get` through response completion; parse/validate response JSON afterward. This includes WSGI/application serialization but excludes real TCP, proxy, browser and host scheduling costs. The network p95 target remains open until independent HTTP evidence exists.
- **Result/size checks:** validate the success schema, no-store/request ID, row/bucket limit, query budget and clean query outcomes. Compare data fingerprints across repeated requests, excluding only time-varying `elapsed_seconds`/`remaining_seconds`; their schema/type checks still apply. Preserve per-case response bytes and record catalog identity/status/time/count fingerprints before/after. Treat changed source data as drift, not a performance regression. Sensitive source values never enter an independent control or tracked output.

### SQL diagnostics

Use separate untimed native calls with the same captured SQL resource/parameters and explicit NULL binding. Capture actual plans, selected/materialized rows, persistent-source scans/actual rows read, regular and LOB logical reads, spills/warnings and `STATISTICS TIME`. The retained diagnostic pass changes only [`NOCOUNT` to OFF](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-nocount-transact-sql?view=sql-server-ver17) to expose intermediate statement boundaries. Timed requests use the unmodified SQL resources. Diagnostic execute/fetch boundaries and cache entries can differ; their wall times are not workload latency samples.

Run repeated identical batches for compilation diagnostics. Record actual parse/compile CPU/elapsed messages for each execution, using [SQL Server's statement timing](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-statistics-time-transact-sql?view=sql-server-ver17). Keep individual messages; their aggregate is a diagnostic message sum, not an assumed non-overlapping wall-clock partition. When a batch emits no compile message, record that absence rather than zero; inspect plan cache flags alongside it. An actual plan's `CompileTime` is its last compilation metadata and cannot be added as recurring cost on every cached execution. Record recompiling statements and [cache reuse](https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide?view=sql-server-ver17#execution-plan-caching-and-reuse) evidence explicitly. Do not add/remove `RECOMPILE` based solely on one small-catalog handler time.

Current configured-identity plans do not prove reader plan behavior. C8.2b.2 may measure public-view IO under existing reader impersonation where allowed; missing SHOWPLAN stays `NOT RUN`. Actual Windows-reader sign-in/TCP HTTP remains C8.3.

### Evidence and exit criteria

Keep reusable native samplers, exact private manifests, raw bodies/selectors/plans/logs and machine/account details under ignored `.local/backend-validation/`. Persist sample progress so an interrupted run does not discard completed observations. The sanitized summary must reconcile sample counts, schema/status failures, query budgets, phases, payload ranges, source drift and cleanup outcomes.

Track the remaining workload, resource, reader and production gates in [progress](PROGRESS.md#remaining-acceptance).

### C8.2b.2a execution-cardinality protocol

This bounded slice uses 20,000 matching executions and two excluded creation-boundary records in connection-local temporary sources. Populate maximum-width Unicode names, NULL observation/environment/logging keys, tied timestamps, all nine selectable statuses, per-execution warning/error events and unrelated parameter rows. Only the execution ID has a source index; these temporary sources test cardinality and query shape, without reproducing SSISDB security/view joins or physical indexes. Keep actual source counts, fixture SQL/hash and native typed oracle rows privately.

Seventeen retained cases cover ID/created-time/duration/error-count orders with first 50, first 200 and rank-10,000 continuation 200, plus exact folder, exact project, status, narrower time and explicit pattern filters. A deep cursor is authenticated from independently ordered native source keys at rank 10,000; it is a direct seek check, not a claim of sequentially traversing fifty pages. Additional correctness requests cover all twelve sorts, both directions, first/deep 200-row pages. A separate check seeks into the NULL-key block at rank 19,000 for each nullable sort in both directions, then follows the actual server-issued cursor to rank 19,200. Native SQL collation orders the independent oracle; compare complete observed DTO values, timestamps, NULLs, counts, durations, elapsed time, ceilings and continuation flags.

Keep two timing channels separate. Three prepared-connection WSGI observations per case, after two warmups, check schema, payload bytes, query budgets and actual cursor/connection closure; native connection acquisition and fixture population happen before the handler timer. Included cleanup covers temporary fixture work as well as the query batch. Report their median/range, **no WSGI p95 from three observations**. A separate prepared native session runs 100 serial fixed round-robin SQL samples per case after two warmups. It times execute/fetch/native result collection/cursor close for the checked-in batches with only source-name substitution and the current declared-parameter binding. Reset query-owned temporary materializations and commit the sampler's reset transaction between requests outside timing. That session remains sampler-owned until its final close. Its nearest-rank SQL p95 excludes acquisition, fixture/reset, API mapping/serialization and transport; neither channel closes the proposed full-page/network target. Fresh temporary sources/cache behavior and cleanup differ between these channels; subtracting their medians would not measure API overhead.

Fresh-session diagnostics collect actual rows/materialization, regular/LOB IO and per-execution compile messages for each distinct retained resource/parameter set. Their diagnostic SQL changes only `NOCOUNT` to preserve statement messages. Temporary object identity/cache behavior differs from public catalog views, so synthetic compilation cannot establish recurring catalog cost. Existing reader comparisons use the actual catalog's public views with administrator-session impersonation, independent native controls and IO/TIME; missing reader SHOWPLAN remains `NOT RUN`. Check catalog fingerprints before/after each phase and release every sampler-owned connection.

## Recorded results

### Review replay: 17 October 2026

Reviewed application revision `9bd7a9c` / repository baseline `36b48f8`, with unchanged application code, SQL and dependency pins. Fresh validation:

| Check | Result and limit |
| --- | --- |
| Full tracked suite | **341 tests PASS**, Windows x64 / standard CPython 3.14.8 |
| Native combined replay | **1,249 assertions / 118 schema responses / 171 queries PASS**, all 14 operations in administrator, normal and restricted SQL contexts |
| Status/capability/failure coverage | 82 success, 12 capability 403, 3 policy-bound cursor 400, 20 hidden/absent 404, one deliberate native timeout 504; readiness recovered |
| Cleanup | Every observed owned query cleanup succeeded; the controlled timeout was the only failed application query; no TCP server was started |
| Focused logging conversion | **8 native cases PASS** with same-named nonsystem string parameters: two detail lookups, ID/created-time pages and all four calculated-sort shapes; disposable connection-local fixtures only |
| Retained workload bounds | Rechecked **51 actual page-plan observations**: ordinary page/count inserts exactly 51/201 candidates, no ordinary whole-cohort materialization; calculated cohort/counts reach 20,000 |

The focused conversion probe did not reproduce a new correctness defect; it is not proof of every future SQL plan. The workload-bound check is an offline recheck of retained plans, not a fresh timing run. No catalog data, permissions or package execution changed. No production, real Scale Out/active workload, independent reader sign-in/HTTP or sustained-resource acceptance is claimed.

Private evidence: `.local/backend-validation/runs/c8-acceptance-20261017T010821473592Z/acceptance.private.json` and its checked summary; focused review helper/results are in `.local/reviews/stage-c-20261017/`. Design/performance findings and next actions are in [progress](PROGRESS.md#review-of-stage-c--17-october-2026).

### SQL remedies replay: 17 October 2026

After C8.2b.3, **341 database-free tests pass** (344 discovered, three opt-in native tests skipped); those **three native SQL tests also pass separately**. The [checked-in suite](../tests/native/README.md) executes actual SQL over temporary sources and compares complete rows across all sorts/directions, NULL tails, precision, filters and retention boundaries.

Fresh combined acceptance again passes **1,249 assertions / 118 schema responses / 171 queries** across all 14 operations and administrator/normal/restricted SQL contexts. The status split remains 82 successes, 12 capability denials, three policy-bound cursor failures, 20 hidden/absent results and one deliberate timeout; readiness recovers and every owned query cleanup succeeds. This is in-process WSGI and SQL impersonation, not independent reader sign-in/HTTP.

Private replay: `.local/backend-validation/runs/c8-acceptance-20261017T103153811074Z/acceptance.private.json`. Native regression/unit logs, exact SQL comparisons and the [workload results](#c82b3-execution-query-remedies) are retained under `.local/sql-remedies-20261017/`. Existing production/resource/reader gates remain open.

### Retained evidence

These are dated milestone results, not reruns during document consolidation. Raw records, plans and account/data details remain ignored under `.local/backend-validation/`; use its run/tool indexes. Detailed per-task logs remain available with `git show 36b48f8:docs/PROGRESS.md`.

| Milestone | Evidence retained / design consequence |
| --- | --- |
| C1a | OpenAPI 3.1.1 / JSON Schema 2020-12, 14 operations, concrete schemas/examples and invalid-instance checks; no SQL claim from schema validation |
| C1b | Native exact datetimeoffset conversion: 26 assertions / 15 queries, including adjacent 100-ns instants and extreme offsets; legacy conversion unchanged |
| C1c | 42 assertions / 9 native WSGI responses / 4 query attempts, real readiness timeout/recovery and missing-driver handling |
| C2/C3 performance review | Event work 16 scans / 32,112 rows / 2,192 logical reads → 1 / 2,007 / 137; ordinary 20,000-row fixtures materialize at most 201 candidates; cached navigation retained. 355 WSGI responses / 479 queries / 87,243 assertions |
| C3b/C3c | Independent summary/cohort and IANA/DST timeline comparisons, exact boundaries/zero buckets and native reader SQL scopes; grouped output bounds do not bound cohort scans |
| C4a | One conditional event aggregation replaces repeated category queries; actual-plan source-work reduction retained with its catalog lookup/IO tradeoff |
| C4b/C4c | Native observation paging, repeated/parallel/ambiguous child fixtures and path/source matching; metadata selected after bounded candidates; deep/repeated-key workload gates remain |
| C5 | 139,146 native assertions / 480 schema responses; Unicode search, NULL IDs, fixed SQL fragments and safe text prefixes. Real Scale Out remains separate |
| C6 | 2,013 native assertions / 345 schema responses; section IDs, canaries, SQL plus serializer redaction and typed display values |
| C7a | 786 native assertions / 140 schema responses; exact identities, both ID directions, precision, status scope and guarded system logging conversion |
| C7b | Prior-success oracle, exact duration totals and rounded estimate ends; indexed visible timestamp source avoids repeated catalog expansion while retaining history-growth work |
| C8.1 | 16 October combined replay: 1,249 assertions / 118 responses / 171 queries; fresh equivalent replay above |
| C8.2a | 300 identical typed-result binding comparisons; 770 affected schema responses / 1,414 queries / 141,621 assertions; all 14 nullable-resource plan pairs preserve results without increased source work |
| C8.2b.1/.2a | [Current-catalog distributions, compilation, execution cardinality, reader IO and their exact measurement limits](#workload-protocol) |

The C8.2a interleaved query-only median examples were 3,967→523 ms (ordinary execution page), 1,713→29 ms (executable page), and 1,977→27 ms (timeline). These excluded connection setup. They justify removing driver NULL type discovery on explicitly typed batches, not an overall HTTP/p95 speedup claim.

The original combined replay's administrator/normal/restricted scopes saw 16/16/2 executions. It checked the restricted hidden/absent behavior on all five execution-scoped operations and enabled/disabled value policy without reading sensitive source values. Stage B separately recorded actual Windows reader legacy HTTP; C8.3 must still exercise the API under those actual process identities.

### C8.2b.1 retained baseline

Completed locally 16 October 2026, application revision `9bd7a9c`, Windows x64/CPython 3.14.8, pyodbc 5.3.0, ODBC Driver 17 **17.10.0006**, SQL Server **16.0.1000.6**. The configured SQL identity is administrator; this is neither independent reader HTTP nor representative production data. Visible sources contain **3 folders, 3 projects, 16 executions, 238 executable statistics, 2,009 events, 242 parameters and one override**. The selected parent has fourteen statistics and four children. Source counts and exact execution identity/status/time fingerprints match before/after.

After forty warmups, **2,000 schema-validated responses / 3,700 application queries PASS**: 100 samples for each of twenty cases. All fourteen operations are covered; data fingerprints, unique request IDs, query budgets, row caps, native phase correlation and both resource closes pass. Each case has a stable response size. The largest body is **26,204 bytes** for the 50-event continuation. Warmups and exploratory pilot samples are excluded from the following nearest-rank p95 results.

| Case | Median / p95 / maximum handler ms | Data rows or objects | Response bytes |
| --- | --- | --- | --- |
| meta | 0.53 / 1.20 / 2.44 | 1 object | 1,383 |
| live | 0.35 / 0.87 / 1.04 | 1 object | 127 |
| ready | 4.18 / 77.41 / 145.68 | 1 object | 130 |
| executions-id | 719.21 / 1,077.56 / 1,691.79 | 16 | 8,344 |
| executions-created | 749.41 / 1,063.93 / 1,331.20 | 16 | 8,342 |
| executions-duration | 762.09 / 1,091.58 / 1,499.03 | 16 | 8,348 |
| executions-errors | 735.28 / 1,065.99 / 1,251.16 | 16 | 8,343 |
| folders | 18.92 / 873.58 / 977.04 | 3 | 500 |
| projects | 11.60 / 851.29 / 1,137.19 | 1 | 419 |
| summary | 3.65 / 134.31 / 374.72 | 1 object | 581 |
| timeline | 21.06 / 231.00 / 394.99 | 24 | 3,880 |
| detail | 19.72 / 638.22 / 790.94 | 1 object | 713 |
| executables | 41.23 / 370.52 / 829.04 | 14 | 5,331 |
| children | 149.81 / 918.70 / 3,969.43 | 4 | 1,698 |
| events-first | 259.33 / 569.55 / 807.03 | 50 | 23,487 |
| events-next | 254.49 / 604.76 / 1,022.61 | 50 | 26,204 |
| parameters | 49.97 / 395.02 / 892.11 | 10 | 3,020 |
| overrides | 47.74 / 394.92 / 773.45 | 1 | 494 |
| history | 77.13 / 291.23 / 1,038.88 | 2 | 1,464 |
| empty-executions | 126.13 / 240.45 / 412.04 | 0 | 352 |

**The proposed one-second full-page/network target is not passed.** These execution pages contain only sixteen rows and exclude TCP/production hosting; even this local screening has four execution p95s above one second. Their median summed execute phases are **683–699 ms**, versus **0.89–3.81 ms** for connection acquisition. ID execution's execute-phase p95 is **1,045.81 ms**; mapping and application overhead are small. These are per-phase distributions, not additive p95 components. Navigation and child tails also occur in execute; the child maximum is retained as an outlier, not discarded or assigned an unproved cause.

The fresh-client pass adds **70 schema-validated first responses / 125 successful queries** in seventy new interpreter processes. Per-operation client-setup medians are **271–289 ms**, including sampler imports/configuration/application setup. Selected first-handler median/range observations are **816 / 717–909 ms** (ID executions), **135 / 106–379 ms** (timeline), **237 / 98–428 ms** (executables) and **183 / 114–736 ms** (children). All fourteen operations have five observations, stable data and clean owned resources. These are fresh-client observations with existing SQL caches, without a cold p95 or production-server startup claim.

#### Compilation and source work

The untimed pass covers **29 distinct resource/parameter sets across all 25 resources**, with three fresh-connection repeats each: **87 native queries PASS** with identical typed outputs per set. Actual IO and operator counters are retained, including LOB reads and warnings. Ordinary page/count materializations contain sixteen rows, below the 51-candidate bound; this does not prove the bound on larger cohorts. Representative second-repeat totals exclude connection-local/work tables:

| Query shape | Persistent-source scans / logical reads / LOB logical reads | Additional observed work |
| --- | --- | --- |
| ID / created execution pages | 21 / 368 / 0 | Each reads 3,872 parameter rows (242 × 16) for logging enrichment |
| Duration / error calculated pages | 21 / 233 / 0 | Each reads 242 parameter rows; whole matching cohort has sixteen rows |
| Event first / continuation pages | 4 / 388 / 0 | Each reads 120 event-table rows and 4,018 operation-message rows for a 50-row response |
| History page | 13 / 249 / 0 | Two returned targets; 484 parameter rows, one materialized eligible prior success |

Payload/candidate bounds do not establish bounded total source work. The ordinary-page parameter enrichment and event-page access are concrete larger-workload follow-ups. Zero LOB reads on this catalog do not satisfy wide-text/value acceptance. Warnings include conversions, missing temporary-table statistics and some memory grants; no spill warning appears in the captured plans. These are observations, not automatic reasons to rewrite SQL.

Per-execution parse/compile message elapsed sums for the three diagnostic repeats are:

| Query shape | Reported parse/compile elapsed ms, repeats 1 / 2 / 3 |
| --- | --- |
| Execution fence, populated cohort | 263 / 95 / 70 |
| ID page | 579 / 526 / 592 |
| Created-time ordinary page | 262 / 415 / 383 |
| Calculated duration page | 562 / 411 / 583 |
| Calculated error page | 503 / 530 / 764 |
| Execution fence, empty cohort | 110 / 115 / 145 |

The fence is uncached on every diagnostic repeat; each ID/ordinary page shows three uncached statements. Calculated branches also contain recurring uncached statements. This is evidence of material recurring compilation to test before adjusting hints. The message sums include all reported statement scopes and are not a wall-clock subtraction from the sampled WSGI time.

Cached examples show why the distinction matters. Folder page plan metadata stays at **349 ms**, while actual repeated compile messages are **353 / 0 / 0 ms**. Timeline statement metadata totals **181 ms** in each plan; its messages are **185 ms / not emitted / not emitted**, with cache retrieval flags true. The history batch's first message sum is **1,054 ms**, followed by **0 / 0 ms**, while last-plan metadata remains. Do not charge those historical costs to every warm request. Three diagnostics are not a compile p95; warm navigation tails require further cache/plan investigation rather than a blanket hint change.

#### Evidence and remaining work

Retained private directories under `.local/backend-validation/runs/` are `c82b1-20261016T184442343257Z` (manifest, source fingerprints, forty warmups, 2,000 JSONL samples, phase summaries and offline checked summary), `c82b1-fresh-20261016T185355895427Z` (seventy first-request records) and `c82b1-plans-20261016T190056664708Z` (29 × 3 plan/IO/time records). Reusable ignored tools are `probe-api-workload.py` and `summarize-api-workload.py`; the warm sampler source/hash is saved with its run. Exploratory pilot and incomplete diagnostic attempts are excluded. No runtime code, SQL resource, dependency, permissions or shared cache was changed.


### C8.2b.2a retained execution-cardinality results

Completed locally 17 October 2026 with unchanged application/SQL revision `9bd7a9c` (repository baseline `bfe4914`). These are synthetic source-cardinality and actual-catalog SQL-scope checks, not a test-network or production-capacity pass. All catalog source counts and execution identity/status/time fingerprints match before/after every phase.

The connection-local fixture contains **20,002 executions, 99,998 events and 38,182 parameters**. Exactly 20,000 executions match the broad window. Main name widths are 128/128/260 UTF-16 units; observation, environment and logging NULLs remain present. Exact folder/project, status, narrower-time and pattern cohorts contain 200/1,177/2,222/4,000/2,000 rows respectively.

**153 schema responses / 242 application queries PASS**: 48 first/deep correctness responses across all twelve sorts/both directions, twenty NULL-block/actual-continuation responses, 34 warmups and 51 measured responses (three per case). Ordered IDs, all observed fields/vocabularies, timestamps/counts/durations/elapsed values, ceilings/continuations, request IDs, row/query bounds and actual cursor/connection closure pass. The NULL-block pairs begin at rank 19,000 and follow the returned cursor to 19,200.

**1,700 native samples / 3,000 checked-in SQL batches PASS**, after 34 excluded warmup samples/60 batches. Each case has 100 observations and stable typed output, including the sentinel. Timing is native client wall time for the one or two SQL batches on a prepared session, including result collection/cursor close; preparation, reset/commit, API serialization and transport are excluded. WSGI observations have fresh prepared sources per query and include cleanup; their three-sample ranges are not p95s or a framework-overhead estimate.

| Case | DTO rows | Native SQL median / p95 / max ms (N=100) | Prepared WSGI median (min–max) ms (N=3) | Body bytes |
| --- | ---: | ---: | ---: | ---: |
| id-50 | 50 | 174.87 / 303.43 / 441.56 | 1,834.40 (1,708.94–2,190.26) | 103,197–103,198 |
| id-200 | 200 | 204.11 / 351.82 / 553.33 | 1,517.12 (1,334.65–2,666.10) | 410,417–410,421 |
| id-deep-200 | 200 | 192.36 / 323.47 / 394.30 | 1,104.40 (915.33–1,196.51) | 409,942 |
| created-50 | 50 | 334.61 / 547.38 / 620.77 | 1,879.65 (1,612.80–2,018.44) | 104,534 |
| created-200 | 200 | 369.66 / 583.83 / 768.33 | 1,579.69 (1,249.66–1,913.69) | 410,155 |
| created-deep-200 | 200 | 368.67 / 546.49 / 718.64 | 1,403.71 (1,256.64–1,692.82) | 410,182 |
| duration-50 | 50 | 1,488.39 / 5,653.85 / 7,891.51 | 3,151.72 (2,411.55–3,434.87) | 104,148 |
| duration-200 | 200 | 1,443.78 / 5,415.28 / 9,967.35 | 3,859.74 (2,966.92–6,409.89) | 413,393 |
| duration-deep-200 | 200 | 1,528.86 / 4,716.19 / 10,815.42 | 4,868.94 (3,790.03–5,509.51) | 412,775 |
| errors-50 | 50 | 1,893.55 / 5,484.41 / 9,959.65 | 3,614.27 (2,409.13–8,334.83) | 103,238 |
| errors-200 | 200 | 1,948.89 / 5,905.03 / 7,603.64 | 3,996.61 (3,199.55–4,079.81) | 410,405 |
| errors-deep-200 | 200 | 1,983.68 / 5,520.04 / 7,430.19 | 6,481.30 (3,163.38–10,401.06) | 410,373–410,376 |
| exact-folder | 50 | 180.87 / 361.59 / 468.48 | 2,478.01 (2,113.35–2,830.91) | 104,337 |
| exact-project | 50 | 232.16 / 423.01 / 585.25 | 2,180.98 (2,124.15–3,755.13) | 103,221 |
| status-filter | 50 | 290.06 / 487.76 / 757.70 | 1,480.02 (1,374.07–2,620.30) | 103,960 |
| time-filter | 50 | 903.56 / 2,733.03 / 4,166.56 | 2,202.65 (1,762.56–3,423.59) | 103,266–103,267 |
| pattern-filter | 50 | 228.03 / 429.28 / 803.64 | 2,314.70 (2,148.33–2,856.67) | 104,513 |

#### Larger-source work diagnostics

All 23 distinct retained resource/parameter sets have three fresh-session plan/IO/TIME observations (**69 queries**). Diagnostic setup precedes statistics and timing; only source names and `NOCOUNT` differ from the checked-in batches. The second repeat below is a labelled observation, not a latency percentile. Source IO counts only fixture source tables; total IO also includes query temporaries/worktables. Access rows use `ActualRowsRead` when present and `ActualRows` otherwise.

| Case | Source scans / logical / LOB reads | All logical / LOB reads | Execution / event / parameter access rows |
| --- | ---: | ---: | ---: |
| id-50 | 3 / 740 / 0 | 759 / 0 | 51 / 99,998 / 38,182 |
| id-200 | 3 / 765 / 0 | 834 / 0 | 201 / 99,998 / 38,182 |
| id-deep-200 | 3 / 760 / 0 | 829 / 0 | 201 / 99,998 / 38,182 |
| created-200 | 3 / 4,063 / 0 | 4,142 / 0 | 20,002 / 99,998 / 38,182 |
| created-deep-200 | 3 / 4,063 / 0 | 4,142 / 0 | 20,002 / 99,998 / 38,182 |
| duration-200 | 14 / 4,229 / 0 | 12,774 / 0 | 20,000 / 99,998 / 38,182 |
| duration-deep-200 | 14 / 4,229 / 0 | 12,772 / 0 | 20,000 / 99,998 / 38,182 |
| errors-200 | 25 / 4,229 / 0 | 36,595 / 0 | 20,000 / 99,998 / 38,182 |
| errors-deep-200 | 25 / 4,229 / 0 | 36,583 / 0 | 20,000 / 99,998 / 38,182 |
| exact-folder | 3 / 1,564 / 0 | 1,587 / 0 | 5,001 / 99,998 / 38,182 |
| status-filter | 3 / 4,063 / 0 | 5,142 / 0 | 19,995 / 99,998 / 38,182 |
| time-filter | 7 / 4,137 / 0 | 10,647 / 0 | 19,499 / 99,998 / 38,182 |

Actual page/count materializations remain at most **51/201 rows**. Ordinary queries do not materialize a whole execution cohort. Calculated sorts retain global cohort metrics; full-cohort and query-temporary work must be evaluated separately from the bounded returned page. Fresh temporary object/cache behavior is not SSISDB permission-view behavior. Per-execution compile messages and last-plan/cache metadata remain private; compile-message sums are not non-overlapping wall-clock components or recurring catalog-cost estimates.

#### Existing reader SQL scope and IO

**12 context/case sets × three repeats = 36 diagnostic queries**, plus twelve independent controls, compare ID, created-time, duration and error-count pages through actual public views in configured/normal/restricted SQL contexts. These are administrator-session impersonation checks, not independent Windows-reader sign-in or HTTP. Source IO below excludes query temporaries/worktables.

| SQL context | Case | Visible rows | Source scans / logical / LOB reads, second repeat |
| --- | --- | ---: | ---: |
| Configured administrator | executions-id | 16 | 21 / 368 / 0 |
| Configured administrator | executions-created | 16 | 21 / 368 / 0 |
| Configured administrator | executions-duration | 16 | 21 / 233 / 0 |
| Configured administrator | executions-errors | 16 | 21 / 233 / 0 |
| Restricted reader | executions-id | 2 | 3,436 / 16,557 / 0 |
| Restricted reader | executions-created | 2 | 3,436 / 16,557 / 0 |
| Restricted reader | executions-duration | 2 | 3,450 / 16,633 / 0 |
| Restricted reader | executions-errors | 2 | 3,450 / 16,633 / 0 |
| Normal reader | executions-id | 16 | 21 / 368 / 0 |
| Normal reader | executions-created | 16 | 21 / 368 / 0 |
| Normal reader | executions-duration | 16 | 21 / 233 / 0 |
| Normal reader | executions-errors | 16 | 21 / 233 / 0 |

Reader result order and complete projected native values match independent controls, repeats are stable and owned resources close after `REVERT`. Reader SHOWPLAN and independent reader HTTP retain their explicit gaps. No grant, catalog write, package run, shared-cache flush, dependency change or TCP server was needed.

#### Findings, evidence and remaining gates

The six broad ordinary native SQL p95s are **303–584 ms**, while broad calculated cases are **4,716–5,905 ms**; the duration-deep maximum remains **10,815 ms**. These are prepared temporary-source client measurements. JSON bodies span **103,197–104,534 bytes** at 50 rows and **409,942–413,393 bytes** at 200 rows. Actual catalog reader pages remain below 50 rows, so neither the synthetic model nor small reader scopes pass the proposed full-page/test-network budget.

The independent insert-cardinality checker reconciles all 51 page-plan observations with the oracle: `#execution_page`/`#page_counts` contain exactly the 51/201 requested candidates; `#execution_cohort`/global `#execution_counts` contain the matching global calculated cohort (20,000 broad, 2,222 status-filtered, 4,000 time-filtered). Duration-200 records 40,000 cumulative cohort access rows; errors-200 records 60,000 cohort access rows plus 20,000 count rows. These are cumulative operator access rows, not distinct rows or separate materializations. Total logical reads are **12,774** and **36,595**, versus **4,142** for created-200, even though those source-only totals are **4,229 / 4,229 / 4,063**. Query-temporary work is material and must remain visible in comparisons.

At least one fresh diagnostic repeat captures `SpillToTempDb`/`SortSpillDetails` for **created-50, created-deep-200, duration-200, duration-deep-200, errors-200 and errors-deep-200**. Timed warm samples did not collect plans, so these warnings cannot be assigned to individual timing outliers. Preserve global metrics and compare narrower calculated cohorts/page enrichment, temporary access, memory/spills and native public-view/reader behavior before adopting a fix. The large fixture reads its 38,182 parameter rows once per retained page plan, whereas C8.2b.1's small actual catalog repeats parameter reads for ordinary pages; do not assume one shape applies to every cardinality or identity.

Both existing readers are non-sysadmin/non-owner and have SHOWPLAN permission **0**. The normal reader has `ssis_logreader`; the restricted reader does not. The restricted reader returns two matching rows but has much higher public-view IO than the sixteen-row administrator/global-reader scope. No reader access-row or plan inference is made without SHOWPLAN, and no grants were added. C8.2b.3 must include this scope in SQL comparisons.

Private directories under `.local/backend-validation/runs/` are `c82b2a-20261017T000435455105Z` (oracle/manifests/API/check-summary), `c82b2a-sql-warm-20261017T001618212098Z` (1,700 JSONL samples), `c82b2a-nullable-20261017T004759410529Z`, `c82b2a-plans-20261017T004952048347Z` (69 plans/IO/TIME calls and exact insert-bound check) and `c82b2a-readers-20261017T005325474980Z`. Sources and offline verifiers remain ignored and reusable. The separate three-round native pilot is excluded. Requested local log/index housekeeping overlapped samples 1,574–1,625; no other task-owned SQL workload ran concurrently. All raw timings are retained; no isolated-capacity acceptance is claimed.

C8.2b.2b/.2c retain observation/text/summary/timeline/history workloads. C8.2c sustained/concurrent resources, C8.3 independent Windows-reader HTTP, reader SHOWPLAN, real active/Scale Out data, OBS-02 and deferred hosting/stream retain their own gates. The baseline above did not change application/SQL sources; subsequent remedies are recorded below.

### C8.2b.3 execution query remedies

17 October 2026, compared with SQL at `36b48f8`. Three query resources changed; API shapes, cursor keys, visibility, limits and dependencies are unchanged.

- Calculated sorts materialize only IDs, exact numeric keys and reusable counts. Duration is computed during selection; public execution metadata is fetched after paging.
- ID pages use fixed ascending/descending ranges with cached selection. Ordinary final logging enrichment no longer recompiles, and guards conversion of same-named nonsystem parameters. Non-ID selection and the filter-sensitive fence retain their existing recompilation.
- Isolated event aggregation uses `RECOMPILE, FORCE ORDER`. The measured join order avoids expanding public-view permission checks before joining selected IDs. Fully cached aggregation and blanket hash/loop hints were rejected: some worsened restricted-reader work dramatically.

**80 paired native cases / 160 diagnostic queries passed exact projected-row and cursor-key comparison:** 65 temporary-source cases (all sorts/directions, first/deep pages and selective filters), plus five sorts in each of three catalog visibility contexts. Actual plans are available for temporary sources and the administrator; readers retain IO/TIME only. All **254 page/count insert checks** match returned candidate cardinality and stay at or below 201. Event aggregation still reads its source once in the large fixture.

| Workload, 201-candidate limit | Before → after total logical reads | Before → after source logical reads |
| --- | ---: | ---: |
| 20,000 rows, ID | 834 → 1,068 | 765 → 765 |
| 20,000 rows, created time | 4,142 → 4,142 | 4,063 → 4,063 |
| 20,000 rows, duration | 12,766 → 5,193 | 4,229 → 4,688 |
| 20,000 rows, errors | 36,586 → 25,293 | 4,229 → 4,688 |
| Current catalog, administrator ID (16 rows) | 483 → 395 | 368 → 232 |
| Restricted reader, ID (2 rows) | 17,958 → 517 | 16,557 → 510 |
| Restricted reader, created time (2 rows) | 17,958 → 518 | 16,557 → 511 |
| Restricted reader, duration/errors (2 rows) | 18,042 / 18,041 → 767 | 16,633 → 752 |

Restricted ID-page source scans fall **3,436 → 57**; calculated-page scans fall **3,450 → 100**. Administrator ordinary logging-source reads fall **144 → 9**. No permission was broadened and application queries still use public views only.

The tradeoffs remain visible: explicit ID-page insertion adds 234 bounded temporary reads at 201 rows (59 at 51); calculated metadata rechecks add source lookups after paging. On the small administrator catalog calculated total reads rise 383–384 → 450, while the large-cohort temporary-work reduction is substantial. The candidate has no calculated-sort spill in these diagnostic plans; ordinary-sort spills remain, so this is not a general spill-elimination claim.

Warm temporary-source comparison used alternating variants, two excluded warmups per variant/case, 20 measured repetitions each, fixed 51-candidate limits and reused native connections. Source preparation and query-temporary reset are outside the timer; every sample checks identical projected values/bytes. Medians in ms, before → after: ID **131 → 137**, created time **247 → 265**, duration **648 → 273**, errors **1,259 → 622**. These are SQL-only measurements; ordinary fixture timing did not improve. Full-page/network p95 and production acceptance remain open.

The same alternating protocol on the actual catalog used **30 repetitions per variant/case** (720 samples, plus 160 fixture samples above). Median SQL-only milliseconds:

| Sort | Administrator, 16 rows | Normal reader, 16 rows | Restricted reader, 2 rows |
| --- | ---: | ---: | ---: |
| ID | 490 → 291 | 390 → 282 | 735 → 304 |
| Created time | 412 → 395 | 402 → 394 | 755 → 414 |
| Duration | 448 → 727 | 397 → 469 | 738 → 491 |
| Errors | 431 → 477 | 401 → 480 | 758 → 493 |

Small administrator/global-reader calculated pages pay for the extra metadata read and compilation; this is an observed tradeoff, not a universal speedup. Tail timings also remain variable. Retain the substantial large-cohort and restricted-reader work reduction without adding a second small-cohort implementation. A further 32 diagnostic samples of cached calculated-page logging showed unchanged reads and inconsistent timing/compilation benefit, so that candidate was not retained. All timings, including regressions, remain in the raw evidence; these limited SQL samples do not establish a full-page/network p95 target.

Reusable probes, rejected candidates, original SQL, raw plans/IO, warm samples and checks are ignored under `.local/sql-remedies-20261017/`. The checked-in [native regression suite](../tests/native/README.md) reproduces SQL correctness with temporary sources on an existing SQL Server connection; it does not substitute for public-view reader validation. No catalog writes, grants, package runs, cache flushes or TCP server were used.
