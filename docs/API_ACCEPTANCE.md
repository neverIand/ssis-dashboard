# API validation

This document owns correctness coverage, workload protocols and dated results. [The contract](API_CONTRACT.md) defines behavior; [progress](PROGRESS.md#remaining-acceptance) owns completion status and open gates. Stage C acceptance remains incomplete.

- [Operation matrix](#operation-matrix) and [shared boundary checks](#shared-boundary-checks)
- [Workload protocol](#workload-protocol): cases, sampling, SQL diagnostics and evidence
- [Review replay](#review-replay-17-october-2026) and [post-remedy replay](#sql-remedies-replay-17-october-2026)
- [Milestone evidence](#retained-evidence), [current-catalog measurements](#c82b1-retained-baseline), [20,000-execution results](#c82b2a-retained-execution-cardinality-results) and [SQL remedies](#c82b3-execution-query-remedies)
- [G01 wildcard history and G02 labels](#g01g02-local-api-results-26-october-2026)

## Operation matrix

Every row requires no-store JSON, a server-generated request ID and the documented success/problem schema. [Shared acceptance tests](../tests/test_api_acceptance.py) check this inventory against the OpenAPI 200 responses and exercise shared validation, methods, failure mapping and capability guards on the production routes. Resource-specific tests remain responsible for full ordering, precision, cursor, redaction and synthetic edge cases.

| Operation | Accepted behavior and intended legacy difference | Combined native check | Local result |
| --- | --- | --- | --- |
| `GET /api/v1/meta` | Public limits/vocabularies/effective capabilities; no connection or server identity. Browser identity headers do not change SQL scope or capabilities. | Effective flags and all twelve execution sorts; zero queries. | PASS: WSGI/SQL |
| `GET /api/v1/server` | Explicit operational server label under the configured SQL identity, with no login/service/connection secrets; five-second maximum driver limits. | Same server label as legacy, safe isolated failure, one query. | PASS: local native HTTP/browser, schema and controlled failure; separate from original fourteen-operation Stage C evidence. |
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
| `GET /api/v1/history` | Exact names by default or explicit LIKE folder/project/package, no overview dates, bounded ID pages and separate estimates. Latest five prior visible successes of each row's exact package exclude self/future runs; actual ends are retained. | Exact and mixed-package traversal versus independent identity/status/estimate selection; common fields match detail/list. | PASS: WSGI/native SQL; LIKE growth/plan limits below. |

## G01/G02 local API results: 26 October 2026

Task 2 added explicit SQL LIKE selectors to history and one separately scoped server-label GET. Exact history, cursor binding and the fourteen-operation evidence are unchanged; the new operation is outside the original Stage C replay. Three opt-in native history tests pass: exact pages in both directions, sampling edges, and mixed-package LIKE and bracket patterns against an independent per-package estimate oracle. In native HTTP and browser replay the label matches legacy; metadata stays zero-query, the label is one scalar query with five-second limits, and its failures stay isolated without retry or polling. All of this ran as the configured local administrator, not an independent reader.

History pages over 2,000, 20,000 and 100,000 connection-local executions (200 package identities) select 201 IDs before enrichment and read the historical source once across page scopes. That removed the prototype's per-package rescans (2,000-row descending page: 2,592,402 to 2,402 source rows read). Five uninstrumented samples per case:

| Source rows / page | Source rows read | Logical reads / scans | Median ms (range) |
| --- | ---: | ---: | ---: |
| 2,000 / descending first | 2,402 | 1,315 / 412 | 105 (84–260) |
| 20,000 / descending first | 20,402 | 1,731 / 412 | 251 (159–586) |
| 100,000 / descending first | 100,402 | 3,806 / 412 | 731 (665–11,850) |
| 100,000 / ascending first | 100,402 | 3,398 / 412 | 328 (290–392) |

Some 20,000/100,000 descending plans spill a sort and report memory-grant warnings. The cause of the 11.85-second sample is not established. The first-page fence reads 1–3 source rows; a 200-row response is about 115 KB. Growth stays linear in visible history. Evidence: `.local/reports/backend/20261026-legacy-gaps/`. Reader, representative-workload, browser-lifecycle and hosting gates remain open.

### Task 3 scoped follow-up: 27 October 2026

The independent review kept the algorithm and its reduction in repeated reads. Thirty samples of the 100,000-row descending first page gave a median of 570 ms (451–620); the 11.85-second sample did not recur, and its cause is still unknown (the 9 November review, R-05, suggests plan eviction on this workstation; not proven). The sort still spills: 73,632 actual against 838 estimated rows, 486 pages through tempdb. No hint, statistics or catalog change was made to hide it. The server label now follows legacy's `@@SERVERNAME` and SQL Azure expression; renamed-host and SQL Azure conditions are NOT RUN. Evidence: `.local/reports/backend/20261027-task3-review/`. [Progress](PROGRESS.md#task-3-review-submilestones) owns the verdict.

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

### C8.2b.2b observation and text protocol

Use connection-local temporary sources for dense executable/event/value pages, repeated child identities and maximum valid Unicode fields. The retained source sizes are 2,000 and 20,000 observations/starts/value rows, with 250 executable definitions, paired/missing/ambiguous child events and separate maximum-path observations. Full-message search tokens occur beyond the 16,384-character display prefix. Include supplementary characters at UTF-16 clipping boundaries, nullable timings/results, unknown codes, sensitive values, policy-redacted overrides, NULL and empty text.

Compare complete DTOs with independently ordered source projections and Python pairing/redaction controls. Cover both observation orders/directions, 50/200 rows, a direct deep entry, NULL-time continuation, actual server-issued next cursors and truly empty sources. Each prepared WSGI query owns and closes a separate native connection; acquisition/fixture population precede the handler timer. These single-case handler observations establish bytes and correctness, not WSGI p95. The visibility query uses the common execution/logging sources; fence/page queries use the full family fixture.

Run three actual-plan/IO/TIME diagnostics for each selected page shape at both source sizes. Inspect candidate, metadata and pairing materializations, source rows read, scans, regular/LOB reads, spill warnings and per-execution compile messages. Diagnostic batches change only NOCOUNT; a sampler-owned prepared session retains sources between the three repeats, and query-owned temporary pages are reset outside statistics collection. Last-plan compile metadata is not recurring compilation cost. Temporary sources/indexes are not SSISDB public-view security or physical-plan replicas.

Keep warm latency separate: two untimed warmups followed by 100 fixed round-robin samples per selected case, through unmodified checked-in SQL with source-name substitution. Time execute/fetch/native result collection/cursor close; exclude acquisition, fixture/reset, hashing, schema checks, API serialization and transport. Preserve every sample and report per-case median, nearest-rank p95 and maximum. Existing normal/restricted reader sessions supply separate read-only public-view SQL IO and independent ordered IDs; administrator-session impersonation does not pass independent Windows sign-in/HTTP. Missing reader SHOWPLAN stays NOT RUN; no permission changes, package runs, cache flushes or server/service changes are part of this protocol.

### C8.2b.2b.R1 child-pairing protocol

Reuse the retained C8.2b.2b children fixture unchanged (four repeated identities, missing/consecutive/time-reversed ends, an unidentified post, wide events and the maximal-path execution) at 2,000 and 20,000 starts, and add **50,000** starts as the larger growth point; its generated IDs stay disjoint. Run the base SQL from a hashed copy of the pre-change tree and the candidate SQL from the working tree through the same harness and application code. Correctness repeats the complete independent DTO and Python pairing comparison for all eight child cases plus four actual-next continuations at every size. Plans run three actual-plan/IO/TIME diagnostics per page shape and size for both SQL trees. Split event-source rows read into selection/enrichment (`#child_page`, `@child_starts`) and pairing. Pairing bounds are expected to stay constant with repeated starts, except where proving a missing end must read every later event. Warm samples follow the C8.2b.2b warm procedure.

A native unittest (`tests.native.test_child_queries`) compares every cursor page of both orders/directions with an independent Python pairing over a fixture with neighbors beyond the search windows, scattered time orders, trailing-space/NULL-type identities, an unidentified post and start, ends above the fence and same-key events of another execution. Deliberately wrong SQL variants must fail it. On the real catalog, compare complete children DTOs from both SQL trees for every visible execution, both orders/directions and cursor chains at limits 2 and 200, and record existing-reader SQL IO.

### C8.2b.2c aggregate and history protocol

Use one connection-local synthetic catalog per size: **2,000, 20,000 and 100,000** executions over 1,000 UTC hours from 2026-09-26. One exact target package receives most rows, beside another package and folders; all statuses, NULL starts, running rows, zero, invalid (end before start), five-day and minute-tied end times are present. Run the base SQL from a hashed copy of the pre-change tree and the candidate SQL from the working tree, through the WSGI API with the same application code. The harness is `.local/backend-validation/tools/probe-aggregate-growth.py`.

- **History:** pages in both directions at 50/200 rows, a server-issued next cursor and a direct deep cursor. Every row's estimate must equal an independent Python oracle: the five latest visible successes of the exact package ending by the row's start, excluding the row itself, ordered by end time then ID.
- **Summaries:** broad, exact-folder selective and `*` pattern cohorts against Python status counts.
- **Timelines:** **1,000 hour buckets** in Europe/London and America/New_York (fall back) and Pacific/Auckland (spring forward), a selective status/folder hour timeline, and day buckets with 23- and 25-hour days. Every bucket count must equal Python bisection over the response bounds, and the bounds must cover the window contiguously.

Plans run three actual-plan/IO/TIME diagnostics per resource, case and size. Record source rows read, scans, logical reads, the rows materialized as prior successes, spills and compilation. Warm samples use 30 rounds after two warmups on one prepared session, with query-owned temporary tables reset between batches. Cohort scans that follow from the catalog having no creation-time or package index are reported as inherent, not hidden. A remedy may change only how much prior-success history is materialized, never which successes are sampled. A native unittest compares every history page of several status scopes and both directions with an independent estimate oracle, including ties on the sampling floor, a zero-duration self-success and fewer than six earlier successes. On the real catalog, compare base and candidate history, summary and timeline DTOs.

### C8.2c resource and concurrency protocol

Use the existing Python environment/configuration and at most **four concurrent clients**. The configured local catalog is read-only; do not grant permissions, start packages, change shared caches or deploy a service. Keep these observations separate:

| Layer | Bounded run | Required observations |
| --- | --- | --- |
| Fake driver / WSGI | Twelve four-request waves alternating mixed success/execute-timeout/fetch-failure/cancellation with successful retries. | Unique request/query correlation, exact per-request result, both close attempts, cursor-before-connection order, zero final logical owners. |
| Native in-process WSGI | Ten round-robin repetitions of the twenty current-catalog cases, four workers. | Stable typed data, schemas, query/row caps, payload bytes, request/query/connection/cursor active/high-water/final counts. |
| Native loopback HTTP | Repeat the same bounded workload with four independent clients. | Independent HTTP request IDs, response sizes, native owner cleanup and a released task-owned listener. This is not test-network or independent-reader evidence. |
| Native failure/recovery | Readiness waits longer than its one-second query cap; a deliberate SQL error; then normal readiness/liveness. | Safe 504/500, driver outcome, closed logical resources and successful recovery. Concurrent health remains database-free. |
| Native cancellation/disconnect | Cancel a driver cursor while a five-second local `WAITFOR` is observed; disconnect one HTTP client during a separate wait. | Observe the worker and server request before/after, distinguish explicit driver cancellation from browser/HTTP disconnect, and wait for cleanup before stopping the server. |
| Frontend owner/browser | Repeated rapid execution/tab replacement, continuation-page refresh, delayed replies, retry and disposal; a 200-row maximum-text Events fixture. | No stale result/denial crosses generations, one owner per screen, bounded active requests, no timers/requests after disposal, measured payload/DOM cost with the fixture boundary stated. |

Each query owns one connection and cursor; serial queries within one request must not overlap. With four native clients the application high-water ceiling is four connections/cursors. Baseline/final application owners and active requests must be zero. Diagnostic monitor connections/cursors are counted separately; retained pooled physical sessions are not leaked logical owners. Use finite HTTP waits (at most 15 seconds), SQL login/query limits (five/three seconds, readiness one second) and a five-second cancellation wait with an eight-second observation deadline. Preserve every failure, including pilot errors, outside acceptance counts.

Record revision/source hashes, interpreter/driver/catalog scope, timestamps, exact workload/sample counts, payload distributions and limits in ignored dated evidence. Register task-owned process identities/listener and stop them through their own lifecycle; verify thread/process exit and port release before removing `.active`. Missing native permissions, actual reader identity, representative sustained load, actual hidden/cache/corporate browsers, OBS-02 and hosting remain explicit separate gates. A browser abort alone cannot pass SQL cancellation.

## Recorded results

Each record keeps its date, candidate, method, decision-relevant figures, limits and evidence path. The full text of every record up to 15 November 2026, with all intermediate tables, is at `6180174:docs/API_ACCEPTANCE.md`. Timings are local observations, not p95 targets or capacity claims, unless a record says otherwise.

### Parameter scope filter: 17 November 2026

Office feedback F5 (Progress Next action 26). `scope=project|package|system` binds `@object_type`, which filters only the bounded key selection of `api-values-parameters-page.sql`; the ID fence, enrichment and masking are unchanged. The method and catalog are as in the 16 November record below: every execution paged to the end at limit 5 under the administrator, `dashboard_reader` and `dashboard_limited`. Unfiltered pages read exactly what they read before (first walk 1,982 pages for the administrator at limit 5; 2,610 for `dashboard_limited`), with medians of 12–14 ms (administrator) and 24–32 ms (`dashboard_limited`) in both versions over two alternating rounds. A filtered walk reads at most what an unfiltered page reads: at most 36 pages per request for the administrator, and 330–407 against 473 for `dashboard_limited`. Medians over three rounds per scope were 12–18 ms (administrator) and 19–43 ms (`dashboard_limited`), with 15–20 requests each. The native value test also walks each scope alone at limit 2 over interleaved rows and past the fence. Evidence: `.local/reports/backend/20261117-parameter-scope-filter/`. Not checked: plans and compile time, many parameters per execution, an office catalog.

### Parameter scope order: 16 November 2026

Office feedback batch D (Progress Next action 24). `api-values-parameters-page.sql` selects the bounded key page by `object_type, execution_parameter_id` with a two-part seek instead of by ID; the ID fence, the key selection before value conversion and the sensitive masking are unchanged. Local catalog: 16 executions with parameters, 282 parameter rows, at most 18 per execution, already grouped by scope in ID order. Each execution was paged to the end at limits 5 and 50 under the administrator, `dashboard_reader` and `dashboard_limited` (`EXECUTE AS USER`). The table shows two alternating before/after rounds.

| Context, limit | Logical reads, first walk of all executions: before → after | Median ms per page, round 1 / round 2: before → after |
| --- | ---: | --- |
| Administrator, 5 | 1,976 → 1,982 | 13.9 / 10.9 → 10.1 / 14.8 |
| Administrator, 50 | 1,001 → 1,003 | 13.9 / 10.6 → 9.7 / 15.9 |
| `dashboard_reader`, 5 | 1,976 → 1,982 | 13.3 / 10.3 → 9.2 / 15.3 |
| `dashboard_limited`, 5 | 2,610 → 2,610 | 25.8 / 25.6 → 23.4 / 17.6 |

Reads differ by at most 6 pages over 58 requests, and the timings overlap between versions. The native test `test_value_queries` inserts parameter rows with alternating scopes inside a rolled-back savepoint, then pages at limits 2 and 3 across the scope boundary and past the fence; it passed with the other 25 native tests. Identity values it allocates are not rolled back. Evidence: `.local/reports/backend/20261116-parameter-order/`. Not checked: plans and compile time, a catalog whose ID order interleaves scopes, executions with hundreds of parameters, an office catalog.

### Page-selection RECOMPILE removal: 15 November 2026

The user chose to remove `OPTION (RECOMPILE)` from the page-selection statement of `api-executions-ordered-page.sql` and `api-executions-sort.sql`, which batch H had kept. Four hints remain in the execution list, all `RECOMPILE, FORCE ORDER` on event aggregation. With and without the two hints alternated in one run: 36 real-catalog cases (19 executions, three reader contexts) and 112 temporary cases (2,000 and 20,000 executions). Returned IDs, work-table reads and source scan counts were equal in all 148; source reads were equal in 102 (10 temporary cases read 1 page more, 36 read 8–36 fewer).

| Median ms, with hints → without | Ordinary sort | Calculated sort |
| --- | ---: | ---: |
| Real, administrator | 462 → 349 | 433 → 234 |
| Real, `dashboard_reader` | 480 → 335 | 390 → 252 |
| Real, `dashboard_limited` | 455 → 352 | 423 → 251 |
| 2,000 temporary | 69 → 62 | 106 → 84 |
| 20,000 temporary | 100 → 91 | 157 → 171 |

On the real catalog all 30 sorted cases were faster (64–166 ms ordinary, 98–239 ms calculated) and compile CPU per request fell from 199–343 ms to 125–265 ms. Of the 112 temporary cases 39 were faster and 16 slower by more than 10 % plus 5 ms, 13 of them at 20,000 executions and 7 of those unfiltered; the largest was the unfiltered `package_name` second page, 203 → 446 ms. The explanation supported by the batch H plans, single observations with no other cause isolated, is that a cached plan sorts on all 12 (ordinary) or 5 (calculated) `CASE` keys instead of 3; plans were not captured again. The default `execution_id` list is not affected. A reuse check (fence and three calculated sorts, four selections in both orders at 20,000) returned the same IDs and reads in all 64 runs. Evidence: `.local/reports/backend/20261115-select-hints/`. Not checked: plans or operator rows read for this change (readers lack `SHOWPLAN`); reuse for the ordinary sorts, across a change of sort on one cached batch and around the logging-level index; 100,000 executions; an office catalog; pooled connections over time. If a large catalog shows the slower pages, restoring the ordinary page's hint is a one-line change.

### Calculated-sort logging lookup: 14 November 2026

`api-executions-sort.sql` read the system `LOGGING_LEVEL` value through `UPDATE … JOIN`, which takes an arbitrary one of two matching rows. Both lookups now join a grouped subquery returning `MAX` of the value and `COUNT_BIG(*)` per execution, the batch returns the count as `logging_rows`, and the API rejects a count other than 0 or 1 as detail and History do. When sorting by logging level the cohort first gets a unique clustered index on `execution_id`. Before (`7672278`) and after alternated over 51 cases: the real catalog in three contexts, two selections and three sorts; 20,000 temporary rows with six selections, three sorts, two pages. Ordered IDs were the same in all 51 for every shape. Totals are over the 11 temporary logging-level cases:

| Shape | Source logical reads | Worktable and temporary-table reads | Sum of medians | Decision |
| --- | --- | --- | --- | --- |
| Grouped subquery, with the index | Equal in all 51, scans too | 69,275 → 9,674 | 2,370 → 2,316 ms | Adopted |
| The same without the index | Equal in all 51 | 69,275 → 69,403 | 2,421 → 2,882 ms | Rejected |
| Group after joining the temporary table again | Within 27 pages | 69,275 → 200,279 | 2,821 → 2,949 ms | Rejected |
| `CROSS APPLY` per row | 28,434 → 299,201 | 69,275 → 69,403 | 2,724 → 2,940 ms | Rejected |

Per case, the adopted shape read less in eight cases (unfiltered 20,432 → 607) and more in three small ones (the index on a small cohort, at most 937 → 3,093); medians moved between −79 and +61 ms without a pattern. The cohort lookup statement at 20,000 rows took 274 ms before (sort, merge join, 1.7 MB grant), 580 ms without the index (hash join) and 194 ms plus 36 ms for the index after (merge join, no grant). A fresh compile of the batch took 308–551 ms before and 310–484 ms after; on a warm connection compile time did not visibly grow, which does not prove the index adds no recompilation. On the real catalog source reads and scans were equal in all 18 cases, while temporary-table reads of the logging-level sort rose by 3–23 pages per case (the index), an accepted cost; actual plans, readable only as administrator, read 320 rows before and 301 or 320 after. A native test adds a second system row inside a savepoint and gets one row with a count of two and the larger value for all four sorts. Evidence: `.local/reports/backend/20261114-logging-rows/` (figures from the corrected message collector; first runs in `old-collector/`). Not checked: 100,000 executions, an office catalog, plans under reader visibility, a real duplicate row.

### Reversed-duration sort key: 14 November 2026

The duration sort key is NULL when the end precedes the start, matching the NULL `duration_seconds` the API now reports; the negative key used to fail cursor encoding. Before (`a44ef35`) and after alternated, duration sort in both directions:

| Source | Cases | Same IDs | Reads and scans |
| --- | ---: | ---: | --- |
| Real catalog, three contexts (none reversed) | 6 | 6 | Equal |
| 2,000 and 20,000 temporary, none reversed | 12 | 12 | Equal |
| 2,000 and 20,000 temporary, 1 in 500 reversed | 12 | 10 | Equal in 11; one read 2 pages fewer of 2,546 |

The two differing cases are the ascending unfiltered pages, where reversed rows now sort with the NULLs instead of first. Real-catalog timings were 461–514 ms after and 471–513 ms before. The native fixture has two reversed rows, on which the old SQL fails with `Invalid database sort key`. Evidence: `.local/reports/backend/20261114-reversed-duration/recount/`. Not checked: 100,000 executions and an office catalog.

### Batch H execution-list RECOMPILE narrowing: 14 November 2026

The 10 November review (N-03) proposed removing six of the ten `OPTION (RECOMPILE)` hints in the execution list. This batch removed four; the other two followed on 15 November (above). It supersedes the C8.2b.3 note that the fence retains its recompilation.

| Statement | Hint | Result |
| --- | --- | --- |
| `api-executions-fence.sql`, upper ID | `RECOMPILE` | Removed |
| `api-executions-sort.sql`, cohort materialization | `RECOMPILE` | Removed |
| `api-executions-sort.sql`, logging level for the cohort and for the page | `RECOMPILE` (2) | Removed |
| `api-executions-ordered-page.sql` and `api-executions-sort.sql`, page selection | `RECOMPILE` (2) | Kept here; removed on 15 November |
| Event aggregation in all three page files | `RECOMPILE, FORCE ORDER` (4) | Kept, not retested |

Committed SQL (`c0d3dc0`) and candidate alternated: 36 real-catalog cases (19 executions; administrator, `dashboard_reader`, `dashboard_limited`; all statuses and status 7; fence, two ordinary and three calculated sorts) and 112 temporary cases (2,000 and 20,000 executions, six selections, two pages). IDs were identical in all 148, work-table reads and source scans equal; source reads were equal in 141 (four fences 2 → 3 pages, three logging-level sorts 24–27 fewer).

| Median ms, before → after | Fence | Ordinary sort | Calculated sort |
| --- | ---: | ---: | ---: |
| Real, administrator | 115 → 3 | 498 → 498 | 578 → 466 |
| Real, `dashboard_reader` | 117 → 10 | 482 → 477 | 555 → 419 |
| Real, `dashboard_limited` | 87 → 4 | 439 → 444 | 529 → 426 |
| 2,000 temporary | 6 → 1 | 82 → 79 | 142 → 113 |
| 20,000 temporary | 9 → 3 | 115 → 118 | 237 → 246 |

Compile CPU per batch from `STATISTICS TIME` (administrator and `dashboard_limited`): fence 47–63 ms → 0; calculated sorts 19–156 ms less; ordinary sort unchanged. No real case and 6 of 112 temporary cases were slower by more than 10 % plus 5 ms (19–57 ms, equal reads). A first candidate also removed the two page-selection hints; in single actual plans at 20,000 the selection statement then sorted on 12 (ordinary) or 5 (calculated) `CASE` keys instead of 3 and took 287–364 ms instead of 70–77 ms (ordinary) and 149 instead of 69 ms (calculated); no other cause was isolated, and the hints were kept here. That candidate was also faster on the real catalog in 35 of 36 cases, which led to the 15 November comparison. A reuse check (fence and three calculated sorts, four selections in both orders at 20,000) kept IDs and reads. Evidence: `.local/reports/backend/20261114-batch-h-recompile/recount/` (corrected collector, both SQL versions pinned; the first run, which counted some messages twice, is in the parent folder). Not checked: reuse on real views with selective filters, pooled connections over time, 100,000 executions, an office catalog.

### C4 list-page estimate SQL work: 8 November 2026

UX item O11 adds `estimate` to `/executions` rows. Active estimates are opt-in (`API_ACTIVE_ESTIMATES_ENABLED`) and cached per process by execution and start time, so a list page reads only its uncached active rows, in one `api-executions-estimates.sql` call after the page is selected; the [contract](API_CONTRACT.md) owns the cache rules. The batch reads the target IDs through the public view into a `SELECT INTO` temporary table (keeping the catalog collation) and estimates all their identities in one read of the catalog. Fixture as in C1/C3, newest 200 executions active (110 identities); one actual-plan diagnostic and 10 warm samples per case:

| Executions | Targets | Source rows read / logical reads | Warm median ms | Spills |
| --- | --- | --- | --- | --- |
| 2,000 | 1 / 50 / 200 | 2,002–2,201 / 28–426 | 26–68 | 0 |
| 20,000 | 1 / 50 / 200 | 20,002–20,201 / 242–640 | 52–139 | 1 sort (50, 200) |
| 100,000 | 1 / 50 / 200 | 100,002–100,201 / 1,198–1,795 | 216–624 | 1 sort (50, 200) |

The read covers every visible execution once at any target count, because no index covers names or end times. At 100,000 rows the ranking statement dominates (hash join of about 95,000 successes to the page's identities, then a window sort whose grant was estimated for 3,150 rows and spilled once). Every estimate matched the Python oracle; no `RECOMPILE` was added. The cache makes this acceptable: each running execution is read once per cache lifetime, not on every 30-second refresh. On the real views (18 executions) the read took a median of 32 ms; through Flask the finished list makes no estimate query, and a forced-active page makes one, matching History, then none on the next request. Evidence: `.local/reports/backend/20261108-c4-list-estimates/`. Reader identity and representative volume NOT RUN.

### C3 detail estimate SQL work: 8 November 2026

UX item D3 adds `estimate` to `GET /executions/{id}`. `api-execution-estimate.sql` runs only while the execution has started and not ended; it averages the exact identity's five latest visible successes that ended by the target's start, as History does. Connection-local sources as in C1; one diagnostic and 10 warm samples per case:

| Executions | Source rows read / logical reads | Warm median ms | First compile ms |
| --- | --- | --- | --- |
| 2,000 | 2,001 / 31 | 0.8–1.5 | 29–40 |
| 20,000 | 20,001 / 246 | 7.8–16.4 | 198–241 |
| 100,000 | 100,001 / 1,203 | 51–69 | 389–469 |

The TOP (5) reads every visible execution once whatever it finds, because no index covers names or end times; it is the detail page's only catalog-size read. No spill, no `RECOMPILE`. Since C4 it is cached with the list estimates. On the real views every estimate equals a Python oracle (12 with samples). Evidence: `.local/reports/backend/20261108-c3-detail-estimate/`. Reader identity and representative volume NOT RUN.

### C1 package filter SQL work: 8 November 2026

UX item O3 adds an exact `package` parameter to `/executions`, `/metrics/summary` and `/metrics/timeline`: each of the six cohort batches gains `@package nvarchar(260)` and `(@package IS NULL OR e.package_name = @package)`, compared under the catalog collation. Connection-local sources clustered on ID, with no name or creation-time index; 15 days, 50 packages (one on every second row, `Rare.dtsx` on 0.1 %):

| Selection | Fence rows read | ID page rows read (returned) | Summary and timeline |
| --- | --- | --- | --- |
| None | 2 | 51 | every row |
| Common package (50 %) | 3 | 101 | every row |
| Rare package (0.1 %) | 994 | 1,007 (2) / 19,007 (20) / 50,001 (51) at 2,000 / 20,000 / 100,000 | every row |
| Absent package | every row (no page query) | — | every row |
| Rare package, narrow window, 100,000 | 994 | 99,007 (10) | every row |

The filter cannot seek, so a selective or absent package reads in descending ID order until the page fills, past the window if needed: the bound is the catalog, the same as summary and timeline already have. Ordered and calculated-sort pages read every row with or without the filter. Plans kept their shape; no `RECOMPILE` was added. On the real views list, summary and timeline agreed for every package; a changed package invalidates a cursor and a 261-unit name returns 400. Evidence: `.local/reports/backend/20261108-c1-package-filter/`. Reader identity and representative volume NOT RUN.

### P5.1b change-detection SQL work: 7 November 2026

The detector anchors to operation IDs: `catalog.operations` gives the mark and each poll's window of at most 201 new IDs, and executions are looked up per listed ID. Seeds are bounded by the mark they take and read committed IDs before active executions. Connection-local sources at 2,000 / 20,000 / 100,000 executions, every third operation ID a deployment, the newest 256 active and 256 ID gaps near the top; inputs asserted before measuring; one actual-plan diagnostic and 30 warm samples (round 4, after three reviews):

| Case | Execution rows read / logical reads at 2,000 · 20,000 · 100,000 | Median ms at 100,000 |
| --- | --- | --- |
| Seed | 2,000 / 22 · 20,000 / 199 · 100,000 / 986 | 47 |
| Seed with 256 carried gaps | as above, plus 256 keyed lookups on operations | 54 |
| Poll, nothing new, nothing tracked | 0 at every size | 7 |
| Poll, 50 tracked | 50 / 100 · 50 / 100 · 50 / 150 | 9 |
| Poll, 512 tracked | 256 / 983 · 256 / 983 · 256 / 1,454 | 21 |
| Poll, full 201-ID window | 201 / 580 · 201 / 580 · 201 / 852 | 18 |
| Poll after 10,000 deployments above the last execution | operations 201 / 2, executions 50 / 753 | 10 |

No poll scans: the work is one keyed lookup per window or tracked ID. A plain join was cheaper on small catalogs (22 reads for 512 tracked IDs) but grew with the catalog, so the per-ID form was kept for a background poll. The seed reads every execution up to the mark once (no status index) and runs only at start, after a resync and while the state is incomplete. On the real views polls used only seeks; two concurrent-writer native tests pass, and a fixture run was reported within about a second of each change. Evidence: `.local/reports/backend/20261107-p51-change-detection/`. Reader-identity plans, representative volume and concurrent load NOT RUN.

### C8.2c local resource results: 26 October 2026

Application baseline `864ec53`, run revision `7617c84`, no source change; local administrator, sixteen executions, catalog fingerprint unchanged. Passed a scoped independent review on 26 October.

| Check | Observed result |
| --- | --- |
| Fake-driver concurrent recovery | Twelve four-request waves, 48 request IDs mixing success, timeouts, fetch failures and cancellation with retries; every cursor and connection closed, high-water 4/4, final 0/0. |
| Native WSGI and loopback HTTP | 200 schema-validated responses in each layer (twenty cases × ten, four workers), plus seven HTTP failure/recovery responses; 407 completed responses of 408 request lifetimes (one deliberate disconnect). |
| Native query ownership | 746 queries, connections and cursors opened and closed; high-water 4/4/4, final 0/0/0. |
| Timeout, error, recovery | A wait past readiness's one-second cap returns a safe 504, a deliberate SQL error a safe 500; readiness and liveness recover. |
| Driver cancellation | `cursor.cancel()` ends the server's `WAITFOR` with `HY008` and closes both owners. The application does not wire browser abort to it. |
| HTTP disconnect | SQL keeps running after the client disconnects until the query timeout ends it; then everything closes. |
| Frontend owners and packaged browser | In controlled owner tests, rapid replacement, continuation refresh, delayed replies, retry and disposal publish only the latest generation and add nothing after disposal; the packaged browser ran the same paths against explicitly synthetic responses. |
| Cleanup | Server thread, preview process and port released. |

The maximum-text Events fixture returns about 45 MB per 200-row page, 6,516 DOM elements and 21.6 million text units; switching tabs clears the text. Regression at the time: Node 415, Python 414 run / 401 pass / 13 native skipped. Evidence: `.local/backend-validation/runs/c82c-20261026-native/` and `.local/reports/backend/20261026-c82c/`. Independent reader HTTP, sustained representative load, reader SHOWPLAN, OBS-02, actual browser lifecycle, network p95 and hosting remain open.

### Review replay: 17 October 2026

Revision `9bd7a9c` (baseline `36b48f8`): the full suite (341 tests) and the native combined replay (1,249 assertions, 118 schema responses, 171 queries over all 14 operations in administrator, normal and restricted contexts) pass, with 82 successes, 12 capability denials, 3 cursor policy failures, 20 hidden/absent results and one deliberate timeout; readiness recovered. Eight native logging-conversion cases pass, and 51 retained page plans keep ordinary pages at 51/201 candidates. Evidence: `.local/backend-validation/runs/c8-acceptance-20261017T010821473592Z/` and `.local/reports/reviews/20261017-stage-c/`. In-process WSGI and SQL impersonation only.

### SQL remedies replay: 17 October 2026

After C8.2b.3, 341 database-free tests and the three native SQL tests pass, and the combined replay again passes 1,249 assertions / 118 responses / 171 queries with the same status split. Evidence: `.local/backend-validation/runs/c8-acceptance-20261017T103153811074Z/` and `.local/reports/backend/20261017-sql-remedies/`.

### Retained evidence

Dated milestone results, not reruns. Raw records stay under `.local/backend-validation/`.

| Milestone | Evidence retained / design consequence |
| --- | --- |
| C1a | OpenAPI 3.1.1 / JSON Schema 2020-12, 14 operations, schemas, examples and invalid-instance checks |
| C1b | Native exact datetimeoffset conversion, including adjacent 100-ns instants and extreme offsets |
| C1c | Native readiness timeout/recovery and missing-driver handling |
| C2/C3 performance review | Event work 32,112 → 2,007 rows read; ordinary 20,000-row pages materialize at most 201 candidates |
| C3b/C3c | Independent summary and IANA/DST timeline comparisons; grouped output bounds do not bound cohort scans |
| C4a | One conditional event aggregation replaces repeated category queries |
| C4b/C4c | Native observation paging, repeated/parallel/ambiguous child fixtures; metadata selected after bounded candidates |
| C5 | Unicode search, NULL IDs, fixed SQL fragments and safe text prefixes; real Scale Out separate |
| C6 | Section IDs, canaries, SQL plus serializer redaction and typed display values |
| C7a/C7b | Exact identities, both directions, status scope, guarded logging conversion; prior-success oracle and exact estimates |
| C8.1 | 16 October combined replay: 1,249 assertions / 118 responses / 171 queries |
| C8.2a | Explicit NULL binding: 300 identical typed-result comparisons; query-only medians such as 3,967 → 523 ms (execution page), not an HTTP speedup claim |

### C8.2b.1 retained baseline

16 October 2026, revision `9bd7a9c`, CPython 3.14.8, pyodbc 5.3.0, ODBC Driver 17.10, SQL Server 16.0; configured administrator; 16 executions, 2,009 events, 242 parameters. After forty warmups, 2,000 schema-validated responses (100 per case, twenty cases, all fourteen operations) passed with stable data and closed resources. Handler milliseconds, median / p95:

| Case | Median / p95 ms | Case | Median / p95 ms |
| --- | --- | --- | --- |
| meta | 0.5 / 1.2 | detail | 20 / 638 |
| ready | 4 / 77 | executables | 41 / 371 |
| executions (four sorts) | 719–762 / 1,064–1,092 | children | 150 / 919 |
| folders / projects | 19 / 874, 12 / 851 | events first / next | 259 / 570, 254 / 605 |
| summary / timeline | 4 / 134, 21 / 231 | parameters / overrides | 50 / 395, 48 / 395 |
| history | 77 / 291 | empty executions | 126 / 240 |

The one-second full-page target is not passed: four execution p95s exceed it with only sixteen rows, almost all of it in SQL execute (683–699 ms median) rather than connection acquisition (1–4 ms). Plan diagnostics showed recurring compilation of the fence and page statements (hundreds of milliseconds per diagnostic), ordinary pages reading every parameter row for logging enrichment, and event pages reading 4,018 message rows for 50 returned; C8.2b.3 acted on these. Seventy fresh-client first requests (five for each of the 14 operations) passed; the five for ID executions took 717–909 ms. Evidence: `.local/backend-validation/runs/c82b1-*`.

### C8.2b.2a retained execution-cardinality results

17 October 2026, revision `9bd7a9c`: 20,000 matching temporary executions with 99,998 events and 38,182 parameters. 153 schema responses (all twelve sorts, both directions, first, deep and NULL-block pages) and 1,700 native SQL samples pass with oracle-equal DTOs. Native SQL p95: ordinary sorts 303–584 ms; calculated sorts 4,716–5,905 ms (maximum 10,815 ms). Bodies are about 104 KB at 50 rows and 410 KB at 200. Pages materialize at most 51/201 candidates; calculated sorts carry the whole cohort, and their temporary work (12,774 and 36,595 logical reads for duration and errors at 200 rows, against 4,142 for created time) must stay visible in comparisons. Several diagnostics spilled sorts. Through public views, a restricted reader seeing 2 rows read 16,557 pages with 3,436 scans against 368 pages and 21 scans for the 16-row administrator scope; both existing readers lack SHOWPLAN. C8.2b.3 addressed this. Evidence: `.local/backend-validation/runs/c82b2a-*`.

### C8.2b.3 execution query remedies

17 October 2026, compared with SQL at `36b48f8`; API shapes, cursor keys, visibility and limits unchanged.

- Calculated sorts materialize only IDs, exact numeric keys and reusable counts; public metadata is fetched after paging.
- ID pages use fixed ascending/descending ranges with cached selection; ordinary logging enrichment no longer recompiles and guards same-named non-system parameters.
- Isolated event aggregation uses `RECOMPILE, FORCE ORDER`, avoiding public-view permission expansion before the selected IDs. A fully cached aggregation and blanket hash or loop hints were measured and rejected; some made restricted-reader work much worse.

Eighty paired native cases (65 temporary-source, 15 real-catalog in three visibility contexts) matched rows and cursor keys exactly, and 254 page/count insert checks stayed at or below 201 rows. Actual plans cover the temporary sources and the administrator only; the readers have IO and TIME.

| Workload, 201 candidates | Total logical reads, before → after | Source logical reads |
| --- | ---: | ---: |
| 20,000 rows, duration | 12,766 → 5,193 | 4,229 → 4,688 |
| 20,000 rows, errors | 36,586 → 25,293 | 4,229 → 4,688 |
| Current catalog, administrator ID (16 rows) | 483 → 395 | 368 → 232 |
| Restricted reader, ID (2 rows) | 17,958 → 517 | 16,557 → 510 |
| Restricted reader, duration/errors (2 rows) | 18,042 / 18,041 → 767 | 16,633 → 752 |

Warm SQL medians on the temporary source: duration 648 → 273 ms, errors 1,259 → 622 ms; ID and created time did not improve (131 → 137 ms, 247 → 265 ms), and the explicit ID-page insert adds 234 bounded temporary reads at 201 rows (total 834 → 1,068), an accepted cost. On the real catalog the ID page and restricted reader improved (ID 490 → 291 ms administrator, 735 → 304 ms restricted), while small calculated pages became slower for the administrator (duration 448 → 727 ms) because of the extra metadata read and compilation; the large-cohort and reader reductions were kept over a second small-cohort implementation. Evidence: `.local/reports/backend/20261017-sql-remedies/`.

### C8.2b.2b observation and text results

18 October 2026, baseline `ac9663b`, no source change. 67 native WSGI responses passed complete DTO comparison across executables, children, events, parameters and overrides, including deep and NULL-time continuations, maximal paths, ambiguous child ends, full-source Unicode search and redaction (redacted values are NULL before the driver boundary). With maximal text a 200-row page can reach 43,238,902 bytes (events), 28.8 MB (executables) or 15.7 MB (children); the row cap does not bound transfer size.

Warm native SQL at 20,000 sources, median / p95 ms: executables first 200 422 / 596, children first 200 1,391 / 1,754, events first 50 12 / 83, events full-source search with maximal text 1,215 / 2,723, parameters 51 / 92. Children cost the same at 50 and 200 rows because pairing read the key's whole history: from 2,000 to 20,000 starts, event rows read grew from 20,648 to 121,810 for the same 201 candidates. That was fixed in C8.2b.2b.R1. The two existing readers were checked by session impersonation through public views (IO only, no SHOWPLAN) on their small visible pages; that is not independent sign-in or a populated reader workload. Evidence: `.local/reports/backend/20261018-c82b2b/` and the hash-checked archive `.local/backend-validation/archive/c82b2b-20261018.zip`.

### C8.2b.2b.R1 child-pairing results

24 October 2026, committed as `1699821` after Codex accepted it with native verification. Only the pairing in `api-children-page.sql` changed: each start reads its adjacent keyed start or post, with a bounded window at the edges of the page and one shared doubling walk for keys still unsettled. DTOs are identical for all 12 cases at 2,000, 20,000 and 50,000 starts and for 128 real-catalog cursor chains; six wrong SQL variants fail the new native test.

| Page, first 200 | Pairing rows read, base 2k / 20k / 50k | Candidate | Warm median ms at 50k, base → candidate |
| --- | ---: | ---: | ---: |
| ID ascending | 6,884 / 60,705 / 150,408 | 2,788 at every size | 3,803 → 210 |
| ID descending | 6,884 / 60,705 / 150,408 | 3,156 / 43,166 / 3,156 | 3,921 → 323 |
| Maximal path | 6,882 / 60,703 / 150,406 | 930 at every size | 926 → 572 |

The base samples at 50,000 overlapped other local probe work and are indicative only. Pairing work no longer depends on how often a key repeats. The exception is a start with no post, where proving no later end exists reads the execution's remaining events once (20,004 at 20,000 starts). Base plans spilled; the candidate's did not. Selection still scans the temporary heap at every size, which SSISDB's indexes may not; on the 16-execution catalog the busiest page reads 993 pages instead of 351, a fixed overhead. The selection plan on a representative catalog under reader visibility remains to be checked (reader SHOWPLAN NOT RUN). Evidence: `.local/reports/backend/20261024-c82b2b-r1/`.

### C8.2b.2c aggregate and history results

24 October 2026, committed as `1699821` after Codex accepted it with native verification. Only `api-history-page.sql` changed: before materializing prior successes it reads the end time of the sixth latest success ending by the page's earliest start, and materializes only successes ending at or after that floor. Every estimate equals the Python oracle at 2,000, 20,000 and 100,000 executions in all 14 cases; summaries and all 1,000 hour buckets in three time zones match; 44 real-catalog history chains are identical.

| History page at 100,000 | Source rows read, base → candidate | Prior successes materialized | Warm median ms |
| --- | ---: | ---: | ---: |
| Descending 200 | 104,202 → 204,202 | 62,674 → 2,509 | 365 → 252 |
| Descending 50 | 101,052 → 201,052 | 62,674 → 632 | 330 → 191 |
| Ascending 200 | 104,205 → 204,205 | 2,494 → 2,494 | 65 → 66 |

Materialization no longer grows with package history; the cost is a second pass over the cohort, so source rows read roughly double. Summaries and timelines read the cohort once (inherent without a creation-time index); a 1,000-hour timeline over 100,000 executions costs about 0.7 s of SQL, linear in the cohort, and stays an input to the render and network budget. Evidence: `.local/reports/backend/20261024-c82b2c/`. Reader SHOWPLAN, independent reader HTTP, sustained resources and real active or Scale Out data keep their gates.
