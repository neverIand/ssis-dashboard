# Stage C API workload protocol

Updated: 16 October 2026. C8.2b.1 is complete locally; C8.2b.2/.3 remain open. [Progress](PROGRESS.md#c82b--workload-decomposition) records the submilestones; [acceptance](API_ACCEPTANCE.md) records remaining gates. The [roadmap](roadmap.md) governs scope and the [modernization plan](MODERNIZATION_PLAN.md) proposes a 50-row execution-page p95 below one second on the test network. This protocol defines measurements, not an accepted production workload.

## Current-catalog baseline

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

## Sampling and timing

- **Warm client / observed SQL cache:** one application process; each query still owns/closes its own connection and cursor. Run two untimed requests per case, then 100 serial round-robin rounds over the fixed case order. Record every observation, including failures/outliers. Report median, nearest-rank p95 (`sorted[ceil(0.95*n)-1]`) and maximum separately per case; do not pool unlike cases or extrapolate production throughput from serial latency. SQL data/plan caches retain their observed state, with recompiling statements identified separately.
- **Fresh client / observed SQL cache:** five new interpreter processes per unique operation, each making that operation's first request. Record client setup separately from the first handler duration and overall child-process wall time. Client setup includes Python/sampler imports, configuration, application construction and instrumentation; it is not production-server startup. Schema-tool imports and validation happen in the parent after the measured response. Only representative default cases enter this set. Report all five observations and range/median, without a cold p95. No OS/data/plan-cache coldness is implied.
- **Driver phases:** time connection acquisition, timeout/converter setup, cursor acquisition, execute, fetch and each close using a private proxy around the same native driver calls. Preserve arguments and connection ownership. Correlate with safe `query_completed` reports. Mapping/application/serialization/logging time remains a labeled residual; instrumentation/schema-validation overhead is not silently counted as database execution.
- **Request boundary:** measure `test_client.get` through response completion; parse/validate response JSON afterward. This includes WSGI/application serialization but excludes real TCP, proxy, browser and host scheduling costs. The network p95 target remains open until independent HTTP evidence exists.
- **Result/size checks:** validate the success schema, no-store/request ID, row/bucket limit, query budget and clean query outcomes. Compare data fingerprints across repeated requests, excluding only time-varying `elapsed_seconds`/`remaining_seconds`; their schema/type checks still apply. Preserve per-case response bytes and record catalog identity/status/time/count fingerprints before/after. Treat changed source data as drift, not a performance regression. Sensitive source values never enter an independent control or tracked output.

## SQL diagnostics

Use separate untimed native calls with the same captured SQL resource/parameters and explicit NULL binding. Capture actual plans, selected/materialized rows, persistent-source scans/actual rows read, regular and LOB logical reads, spills/warnings and `STATISTICS TIME`. The retained diagnostic pass changes only [`NOCOUNT` to OFF](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-nocount-transact-sql?view=sql-server-ver17) to expose intermediate statement boundaries. Timed requests use the unmodified SQL resources. Diagnostic execute/fetch boundaries and cache entries can differ; their wall times are not workload latency samples.

Run repeated identical batches for compilation diagnostics. Record actual parse/compile CPU/elapsed messages for each execution, using [SQL Server's statement timing](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-statistics-time-transact-sql?view=sql-server-ver17). Keep individual messages; their aggregate is a diagnostic message sum, not an assumed non-overlapping wall-clock partition. When a batch emits no compile message, record that absence rather than zero; inspect plan cache flags alongside it. An actual plan's `CompileTime` is its last compilation metadata and cannot be added as recurring cost on every cached execution. Record recompiling statements and [cache reuse](https://learn.microsoft.com/en-us/sql/relational-databases/query-processing-architecture-guide?view=sql-server-ver17#execution-plan-caching-and-reuse) evidence explicitly. Do not add/remove `RECOMPILE` based solely on one small-catalog handler time.

Current configured-identity plans do not prove reader plan behavior. C8.2b.2 may measure public-view IO under existing reader impersonation where allowed; missing SHOWPLAN stays `NOT RUN`. Actual Windows-reader sign-in/TCP HTTP remains C8.3.

## Evidence and exit criteria

Keep reusable native samplers, exact private manifests, raw bodies/selectors/plans/logs and machine/account details under ignored `.local/backend-validation/`. Persist sample progress so an interrupted run does not discard completed observations. The sanitized summary must reconcile sample counts, schema/status failures, query budgets, phases, payload ranges, source drift and cleanup outcomes.

C8.2b.1 exits with reproducible current-catalog/fresh-client results and measured source/compilation findings, including any failures. C8.2b stays open until its larger workloads, reader-scope costs, targeted fixes and budget accounting pass. C8.2c, real active/Scale Out workloads, reader SHOWPLAN, C8.3, native cleanup-failure observation and deferred hosting/stream gates retain their own evidence requirements.

## C8.2b.1 retained baseline

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

### Compilation and source work

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

### Evidence and remaining work

Retained private directories under `.local/backend-validation/runs/` are `c82b1-20261016T184442343257Z` (manifest, source fingerprints, forty warmups, 2,000 JSONL samples, phase summaries and offline checked summary), `c82b1-fresh-20261016T185355895427Z` (seventy first-request records) and `c82b1-plans-20261016T190056664708Z` (29 × 3 plan/IO/time records). Reusable ignored tools are `probe-api-workload.py` and `summarize-api-workload.py`; the warm sampler source/hash is saved with its run. Exploratory pilot and incomplete diagnostic attempts are excluded. No runtime code, SQL resource, dependency, permissions or shared cache was changed.

C8.2b.2 still needs defined larger cohorts, full 50/max-200 pages, deep/filtered branches, wide text, repeated child keys, 1,000 buckets, history growth and existing reader SQL scope/IO. C8.2b.3 must compare focused remedies for recurring compilation, logging enrichment and other measured costs before closing budgets. Repeated/concurrent resource acceptance, reader SHOWPLAN, actual Windows-reader HTTP, real Scale Out/active data, native cleanup failure and deferred hosting/stream remain open independently.
