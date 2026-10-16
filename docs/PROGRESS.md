# Implementation progress

Updated: 16 October 2026. Development base: `dev-next`.

The [roadmap](roadmap.md) defines scope; the [modernization plan](MODERNIZATION_PLAN.md) defines the design and delivery phases. This tracked document records smaller implementation milestones, their evidence, and the next bounded task. Update it with every code task. A completed submilestone does not mean its whole parent phase is complete.

## Task sizing and status

Prefer one coherent implementation boundary per task, with concrete exit checks and a reviewable commit. Split a milestone further when it combines unrelated behaviour, requires unavailable integration evidence, or grows beyond a focused review. Record the split here before extending its scope.

Statuses: **Planned**, **In progress**, **Complete**, **Awaiting integration**, or **Deferred**. Deferred records work explicitly put on hold by the user. Complete means its stated local exit checks passed; SQL Server, driver, proxy, and deployment claims require their own recorded integration evidence.

Current next task: **C3a, bounded navigation resources**, in the [Stage C breakdown](#stage-c--read-only-api-delivery-phase-2). C1a/C1b/C1c/C2a/C2b are complete locally with native evidence; four GET operations and all 12 execution sorts are implemented. All 176 database-free tests pass. Independent reader sign-in/HTTP and larger-workload performance acceptance remain C8 checks; native cleanup-failure observation, B5c and production hosting retain their gates.

## Baseline and backend foundation

These milestones implement roadmap item 1 and delivery phases 0–1. Phases 0 and 1 remain incomplete until all their required checks, including real SSISDB validation, pass.

| ID | Parent | Status | Scope and exit condition |
| --- | --- | --- | --- |
| P0a | Phase 0: workflow baseline | In progress | Add synthetic workflow fixtures as each backend slice needs them; maintain a field/workflow parity checklist and distinguish known bugs from intended behaviour. B1 establishes route/template coverage, not complete query parity. |
| P0b | Phase 0: real-data baseline | In progress | The 15 October SQL 2022 baseline now includes actual reader sign-in/HTTP and all designed active/child/override/special-text/history fixtures. C1b resolves typed datetimeoffset conversion on the recorded native baseline; retain the unobserved native cleanup-failure assertion and deferred hosting gates. |
| B1 | Phase 1: startup/configuration | Complete | Independent application factory, deterministic configuration loading, per-app monitoring configuration, explicit entry points, debug-off defaults, and database-free legacy page tests. Existing URLs and template endpoint names are preserved; the evidence and integration limits are recorded below. |
| B2 | Phase 1: database query boundary | Complete | Package-relative SQL loading and a standalone parameterized query operation own each connection/cursor. Positive login/query timeouts are validated and applied; fake-ODBC tests cover acquisition, execution/fetch/mapping, cleanup, and non-project working directories. Legacy shapes and checked-in SQL are preserved; native integration remains P0b/B5a work. |
| B3 | Phase 1: inputs and errors | Complete | Validate event/status/detail inputs and positive BIGINT execution IDs before queries; use fixed SQL resource maps; return safe HTML errors with correct HTTP statuses and database-independent routing errors. Treat absent/not-visible execution records alike. Synthetic HTTP/ODBC failure checks pass; API problem JSON and live permission/driver behaviour remain separate work. |
| B4 | Phases 0–1: legacy query usage | Complete | Query only data consumed by each legacy screen and its shared navigation. Separate aggregate and execution event-KPI operations; keep the legacy SQL `-1` contract behind the aggregate adapter and reject invalid execution selectors. Per-route query counts, exact resource/parameter binding, populated rendering, and error short-circuit tests pass. Cohort/pagination/typed JSON and measured SSISDB performance remain separate work. |
| B5a | Phase 1: runtime/dependency baseline | Awaiting integration | B5a1/B5a2, B5a3a and the local reader/fixture replay have evidence. C1b proves opt-in native datetimeoffset conversion; native cleanup-failure observation remains open and the parent gate stays open. |
| B5b | Phase 1: operational timing | Complete | Structured request/query/error events use server request IDs and safe fields. Synthetic stage/cleanup/cancellation, log-sink, repeated-context, and concurrent-request checks pass, plus a native missing-driver negative probe. The tracked manual checklist covers the user's deferred real-data and hosting checks. |
| B5b1 | B5b: review follow-up | Complete | Safe exception type and bounded application locations are retained; explicit local debug/test propagation preserves the original error, Flask exception signal and database cleanup. Seven added regressions and the full 101-test suite pass on Linux x64/CPython 3.12.14; Windows/native integration remains deferred. |
| B5c | Phase 1: hosting baseline | Deferred | On hold at the user's request, 15 October 2026. Resume deployment/server/service/container, production proxy/authentication/transport/logging and related host checks only when reprioritized. Production stream/proxy capacity validation is also deferred; local database/application work continues independently. |

### Runtime milestone decomposition

B5a combines dependency selection, interpreter changes, and native/database compatibility. Keep those as separate reviewable tasks; do not claim runtime completion from a dependency-install check alone.

| ID | Status | Scope and exit condition |
| --- | --- | --- |
| B5a1 | Complete | Published runtime versions were reviewed; the normal requirements command applies exact constraints for the complete eight-package graph. Online resolution, clean offline installation from another working directory, dependency consistency, idempotent resolution, app entry points, and all 77 database-free tests passed on Windows x64/CPython 3.11.4. Python 3.14/native checks remain B5a2/B5a3. |
| B5a2 | Complete | The pinned graph installs on standard CPython 3.14.8/Windows x64 using cp314 wheels. Native modules load, all 77 database-free tests and entry points pass, and repeat installation proposes no changes. Other platform/free-threaded/native-DB claims remain separate checks. |
| B5a3 | Awaiting integration | Windows/native/catalog/HTTP, actual reader identities and designed fixture executions now have evidence. C1b resolves typed datetimeoffset conversion; native cleanup-failure observation stays open, with no broader platform/host claim. |
| B5a3a | Complete | Validate all checks supported by the existing local test setup: fresh Windows/CPython 3.14 replay, real Driver 17/catalog reads, legacy workflow/SQL parity, native and real HTTP timeouts, safe events, timings/plans, resource and owned-process cleanup. Record partial cases explicitly rather than closing B5a3/P0b. |
| B5a3b | Awaiting integration | B5a3b2 completes intended reader replay and all designed fixtures. C1b resolves typed datetimeoffset compatibility on the recorded baseline; OBS-02 retains native cleanup-failure observation where reproducible. Hosting remains B5c. |
| B5a3b1 | Complete | Inspect the user-created reader mappings/visibility and prepare the dedicated two-package fixture design, exact build/deployment guide and reusable snippets. C# method compiles against installed SQL 2022 APIs; both SQL drafts pass PARSEONLY without execution. This is preparation, not built/deployed fixture evidence. |
| B5a3b2 | Complete | User deployed the two-package fixture; six history seeds, controlled values/events/failure, completed/active repeated/parallel children, optional second-folder scope and additive grants all verified. Both actual Windows reader accounts pass SQL/HTTP. The 84-request/628-assertion run closes nine checklist cases; native/hosting follow-ups remain separate. |

## Later phase boundaries

Do not expand a backend foundation task into these phases. Stage C is decomposed below; decompose subsequent phases when implementation approaches.

| Parent phase | Intended slices | Status |
| --- | --- | --- |
| 2: API / Stage C | C1–C8 below: contract/types/HTTP boundary, bounded executions, metadata/metrics, inspection, events, values, history, and local acceptance | In progress; C1a/C1b/C1c/C2a/C2b complete locally, C3a next |
| 3: first native screen | Shell/build choice, URL filters/list/cards, data-only updates and preserved state | Planned |
| 4: feature parity | Details/children, searchable events, values, history/charts, legacy URL mapping | Planned |
| 5: live updates | Detector prototype/capacity, stream contract, snapshot/resume/resync, bounded subscriptions, browser recovery, production proxy validation | Planned |
| 6: cutover | Prebuilt assets, legacy removal, deployment/CI documentation, load validation, rollback rehearsal | Planned |

## Stage C / read-only API (delivery phase 2)

Planned on 15 October 2026. Stage B is sufficiently validated to begin local API work: 25 of 30 backend checklist cases pass, including the deployed fixtures and both actual Windows reader identities. This is a stage transition, not closure of B5a3/P0b or a claim of production readiness. C1a/C1b/C1c/C2a/C2b are **Complete** for their stated scopes; subsequent C tasks are **Planned**. Four of 14 operations are implemented: `/api/v1/meta`, `/healthz`, `/readyz`, `/api/v1/executions`.

### Backend carry-over and scope

| Item | Treatment during Stage C |
| --- | --- |
| Raw datetimeoffset / ODBC type -155 | C1b complete: an opt-in connection-local converter preserves all seven digits through native SQL, strict serializers and JSON. Native evidence is recorded below and in the backend checklist; the bare unconverted driver path remains unsupported. |
| OBS-02 native cleanup-failure observation | Retain the explicit NOT RUN assertion. Existing synthetic cleanup coverage and successful native cleanup do not establish this specific observation. Investigate when reproducible; unrelated API work can proceed. |
| Measured legacy KPI/compile cost | Address the execution-specific event-count query in C4a and measure the list/calculated-sort paths in C2. Compare equivalent workloads; do not transfer legacy timings into API performance claims. |
| B5c, OBS-03 host portion, HOST-01/02/03 | Remain deferred. No service/container rollout, production proxy/authentication/HTTPS/logging or production stream-capacity work is required to start Stage C. |

Keep Flask/pyodbc, parameterized read-only catalog queries and the legacy routes. Use functions grouped around operations and a small API blueprint, explicit serializers and checked-in SQL; no ORM is planned. The one added runtime dependency is first-party `tzdata`, supplying the IANA database required on Windows. Contract-validation tools are separate development dependencies. Define local endpoint capabilities and redaction now even while production identity/proxy integration is deferred. SQL row visibility continues to follow the configured database identity.

### Task breakdown

The numbered groups are planning boundaries. Each lettered row is one focused task with its own implementation record and validation; do not combine an entire group into a large change by default. Extend `docs/openapi.yaml` with each implemented resource, and label unimplemented resources as planned.

| ID | Scope / deliverable | Concrete exit checks |
| --- | --- | --- |
| C1a | **Complete.** [Contract and local access policy](API_CONTRACT.md), with [OpenAPI schemas/examples](openapi.yaml). Specify concrete DTO fields/examples, common errors, exact-name versus explicit pattern mode, created-time cohort, effective time bounds, statuses, sort allowlists, paging/cursor rules, and event/value capabilities. Record intended differences from legacy behavior. | The draft covers 14 planned GET operations, 59 concrete schemas and 15 synthetic response examples. Structural/schema/reference/example validation and invalid-instance checks pass; no endpoint or native conversion is claimed. See the C1a work record below. |
| C1b | **Complete.** Typed SQL/JSON boundary. Resolve the actual Driver 17 datetimeoffset failure using a tested connection-local converter or an explicit offset-preserving SQL representation. Serialize BIGINT/LSN as decimal strings, UTC offset timestamps, nulls, numeric seconds/counts, booleans and unknown codes. | Fake-boundary tests include IDs above JavaScript's safe integer limit, fractions, non-UTC offsets, NULL start/end and unknown status/logging codes. A separate native SQL-to-serializer-to-JSON probe proves the selected conversion on the recorded Windows/Python/driver baseline before endpoint work. Legacy formatted shapes still pass their regressions; native gaps remain NOT RUN if access is unavailable. |
| C1c | **Complete.** Versioned API HTTP boundary and `/meta`; local `/healthz` and bounded `/readyz` outside the versioned API. Register the blueprint, shared validation/problem responses and local capability checks; preserve request IDs, safe diagnostics and protocol headers. Keep browser/proxy identity headers untrusted. | API 400/403/404/405/500/503/504 paths produce safe `application/problem+json`, including unknown API paths and routing failures; applicable authentication failures have a defined 401 contract. Legacy errors remain HTML. Invalid inputs and denied capabilities short-circuit before SQL. `/meta` exposes only documented non-secret fields; liveness performs no DB query and readiness uses a short bounded dependency check without diagnostics leakage. |
| C2a | **Complete locally; native evidence recorded below.** First execution page: `GET /api/v1/executions`, initially ordered by execution ID. Apply exact catalog names, optional deliberate pattern mode, `[from,to)` on `created_time`, status and bounded limit. Select/page candidates before retrieving event counts/logging data for those IDs. | Independent SQL comparisons include created/pending/running rows, both time boundaries, special/long names, empty visibility and NULLs. Default 50/max 200, stable ID order, `has_more`, filter/bounds-bound cursors and an upper-ID paging fence pass tests. Malformed or mismatched cursors fail safely; a cursor never grants visibility. Measure query plans/timings and retain actual row identity for links. |
| C2b | **Complete locally; native evidence recorded below.** Required global execution sorts. Implement the contract's allowlisted numeric/date/name/status sorts, with ID tie-breakers and explicit NULL ordering. Treat calculated duration/error/warning sorts as separate measured query shapes. | Ordering covers the entire matching cohort, not just the current page. Ties, both directions, multi-page traversal, changed sort/filter inputs and mutable membership have defined behavior. No untrusted SQL fragments. Record plans and cost for calculated sorts; define invalidation/refetch rather than claiming a snapshot during status changes or retention. |
| C3a | Navigation resources: bounded `/folders` and `/projects?folder=...`, with unique field aliases and unambiguous identity. | Actual normal/restricted reader results match SQL visibility; names including literal wildcard characters remain exact in exact mode. Multi-page navigation and empty collections work, and no server/connection secrets are returned. |
| C3b | `/metrics/summary` using the same folder/project/created-time range as the execution list. | Summary includes all statuses even when the table selects one status; this intentional distinction is documented. Effective bounds can be reused across requests. Independent SQL counts cover pending/no-start and empty cohorts. |
| C3c | `/metrics/timeline` with bounded zero-filled buckets and the configured display timezone. | The timeline applies the selected status within the same effective cohort. Boundary, empty-range and Europe/London DST tests pass; bucket count/range caps hold. Native comparisons distinguish bucket timezone from UTC wire timestamps and do not use a timezone-less SQL date as a substitute. |
| C4a | `/executions/{id}` identity, status, actual timings and execution-specific event counts. Replace repeated KPI scans with a measured conditional aggregation for the API path. | Visible IDs, unknown codes, running NULLs and IDs outside the overview range work. Missing and not-visible IDs have indistinguishable safe 404 behavior before follow-up queries. KPI counts match all five documented event categories; old pages retain their adapter. |
| C4b | Bounded `/executions/{id}/executables`, with typed statistics and executable-result codes kept distinct from execution status. | Stable paging/order, incomplete executable rows and insufficient logging are represented explicitly. Permission/missing-execution short circuits, real fixture comparison and SQL/result typing pass. |
| C4c | Bounded `/executions/{id}/children`, preserving invocation/path identity and observed timings. | Reuse the repeated/parallel/active fixture oracle; test loops, missing end events and low logging. Pairing must distinguish occurrences and execution paths, not package names alone. Missing observations are labelled unavailable/incomplete rather than invented child execution IDs or completion times. |
| C5 | Paged/searchable `/executions/{id}/events`. Preserve all five categories, expose event IDs, and search across the execution's matching events with bound inputs. | Stable time/ID ordering, duplicate timestamps, category/search combinations, ties across page boundaries, caps and cursor fences pass. Search is not limited to the visible page. Sensitive free text follows the capability policy, messages remain JSON text, and responses use `Cache-Control: no-store`; logs/errors contain no message or search-value leakage. |
| C6 | `/executions/{id}/values` with SQL type metadata, explicit redacted markers and separate parameter/override policy. | Serializer redacts sensitive parameters even if a faulty fake row supplies a value. Unapproved override values are hidden by default; denied capabilities fail before the sensitive query. Controlled Int32/Boolean/string/NULL values, flags, safe display strings, actual reader visibility and no-store/canary checks pass. |
| C7a | Exact folder/project/package `/history`, explicit status scope and bounded count; typed actual timings with no forecast substituted into actual fields. | Default last 50 running/succeeded rows and optional other outcomes match the documented query. Same package names across folders/projects stay isolated; use synthetic coverage where the existing live fixture lacks a case and record any native gap. Labels/limits agree and current legacy history remains available. |
| C7b | Basic history estimates from the most recent five completed successful runs preceding the execution being estimated. Return method/sample count and separate estimated duration/end fields. | Exclude the current execution and future samples; test fewer than five samples, no history, zero/null durations and running rows. Independent calculations match the selected cutoff/order; actual end times remain NULL until observed. No model dependency or prediction-accuracy claim. |
| C8 | API-wide local acceptance and handoff. Consolidate contract examples, intentional legacy differences, native replay and measured query/resource behavior. | Full existing regressions plus contract tests pass. Actual normal/restricted identities and independent SQL verify implemented resources, safe failures/timeouts, redaction, bounded rows/payloads and no accumulating active work/resources. Record representative cold/warm timings/plans; claim p95 targets only with a defined workload and enough samples. Keep unavailable checks NOT RUN and stop/audit task-owned helpers. Hosting/stream checks remain deferred, not passed. |

After C8: code review: performance and correctness

### Order and stage gates

Start with **C1a → C1b → C1c → C2a**. This puts the contract and known native conversion problem ahead of dependent endpoints. Follow with C2b and C3a/C3b, then C3c and C4a; C4b/C4c/C5/C6 build on the visible-execution and capability boundary. Implement C7a before C7b, and finish with C8. Keep each task reviewable and update its evidence/status here before expanding scope.

The first native overview can start in delivery phase 3 after **C1 + C2a + C3a + C3b** pass their local checks. It can link to legacy details initially and expose only implemented sorts until C2b passes. This overlap is an early usable milestone, not full API completion. The new frontend shell/build, screen parity, SSE/detector/recovery and production hosting stay in their own phases.

Stage C is complete only after all C1–C8 rows have their stated contract and local SQL/HTTP evidence, the API works without the replacement UI, read-only/access/redaction behavior is checked, and remaining production gates are explicitly carried forward. Preserve the two open native backend follow-ups until their own evidence closes them; do not relabel the five existing incomplete checklist cases merely because API work starts.

Planning validation: roadmap/plan/progress alignment, task dependencies, local Markdown links/anchors and whitespace are checked for this documentation change. No endpoints, SQL, packages, permissions, runtime dependencies or servers are changed; no application-test replay is needed for the task breakdown.

## C1a / API contract and local access policy

Completed 15 October 2026 on `dev-next`. This is the documented implementation contract, not an API implementation or database replay.

- Added `docs/openapi.yaml` (OpenAPI 3.1.1), with 14 planned GET operations, their delivery milestones, 59 concrete schemas, shared headers/problem responses and 15 synthetic response examples. Excluded the phase 5 stream schema. IDs above JavaScript's safe integer range, NULL actual end times, sensitive/policy redaction and incomplete child observations are represented explicitly.
- Added `docs/API_CONTRACT.md` for semantic validation and local policy: exact names versus explicit escaped patterns, created-time `[from,to)` cohorts, all-status summaries versus selected-status list/timeline, DST-aware buckets, bounded cursor sessions/global sorts, recorded-count meaning, capped text projections, separately paged values sections and estimates using only prior completed successful runs. Property overrides use the public view's real `property_id` and sensitive flag, avoiding path-sized cursor keys.
- Specified proposed capability settings with events/values/override display disabled by default, always-enforced sensitive redaction, SQL-identity visibility, safe absent/hidden 404 behavior, no-store responses and no trusted browser identity headers. These settings were design targets at C1a; C1c subsequently implements validation/shared guards, while endpoint-specific values/events behavior remains C5/C6 work. Local mode has no new login flow; shared authentication/transport/host logging remain deferred.
- Kept the roadmap/modernization plan and README links aligned. Initial reusable authoring/check helpers, packages and outputs remain ignored under `.local/contract-tools/`. The review follow-up below promotes durable checks and development pins into the repository and adds the required timezone-data runtime dependency.

Validation: OpenAPI 3.1 structural validation passes with `openapi-spec-validator 0.9.0`; all 59 JSON Schemas, 399 internal references, 14 unique planned GET operations and 15 response examples pass. Twenty-three invalid-instance probes are rejected (including numeric/invalid/overflow IDs, bad timestamps/offsets/status selections, contradictory capabilities, plaintext sensitive values, inconsistent cursor metadata, incomplete children with an end time, fabricated actual duration and count overflow); pending, unknown-code, maximum-ID, input-offset and continuation examples pass. Local links/anchors, ignore boundaries and whitespace are checked separately. This proves document consistency, not parser/serializer/query/authentication behavior; no application tests, SQL/HTTP replay, fixture executions, permissions or servers are changed/run.

C1b and C1c subsequently completed the typed/native and common HTTP boundaries as recorded below. All existing incomplete backend/hosting checklist cases retain their results.

### C1a review follow-up

Addressed Astra's review on 15 October 2026 before starting C1b:

- Added first-party `tzdata==2026.5` to the runtime pins and a loadable `DISPLAY_TIMEZONE` check at application construction, defaulting to `Europe/London`. Invalid configuration or missing data fails before SQL access. The setting prepares API time operations; legacy SQL formatting is unchanged.
- Widened execution-status and summary-status output codes to the signed SQL INT range. Known input selectors remain 1–9; tests cover unknown output codes outside SMALLINT and both INT bounds.
- Promoted OpenAPI/schema/reference/example and invalid-instance checks to tracked `tests/test_api_contract.py`. Added separate `requirements-dev.txt`/`constraints-dev.txt`; the normal test command no longer depends on ignored helper scripts or installed package targets. Added startup/fallback/DST tests in `tests/test_timezones.py` and updated installation instructions.

Validation: created a fresh standard CPython 3.14.8 Windows x64 environment at ignored `.local/contract-review-venv314` and installed `requirements-dev.txt` using binary wheels only. All 29 runtime/development distributions installed, and `pip check` passed. The normal `python -m unittest discover -s tests -q` command passed **114 tests** (101 existing + 9 contract + 4 timezone), including WSGI/legacy-launcher construction, all 59 schemas/399 references/14 operations/15 response examples, 28 invalid-instance cases and unknown status codes across both SQL INT boundaries. London spring-forward and repeated autumn-hour checks pass with `PYTHONTZPATH` empty, proving the packaged fallback rather than relying on a system IANA database. All 35 local planning links/anchors, 16 Stage C task IDs and whitespace checks pass. No DB/server process was started. No API endpoint or native timestamp conversion is claimed; the backend/native/hosting gates above retain their recorded status.

## C1b / exact typed SQL-to-JSON boundary

Completed 15 October 2026 on `dev-next`. No API endpoint, SQL resource or legacy route was changed.

- Added `dashboard/timestamps.py`: one immutable UTC tick value retains SQL's 100-nanosecond precision, including the seventh fractional digit that Python datetime cannot hold. Strict offset-aware parsing, native Driver 17 struct decoding, UTC output and explicit `CONVERT(datetimeoffset(7), ?)` string binding share that exact representation. Offset/day/year rollovers and both local/UTC range limits are checked without float timestamps. This is a small precision boundary, not a domain class hierarchy.
- Added explicit `dashboard/serialization.py` primitives for positive BIGINT IDs, nullable/nonnegative LSNs, exact counts, Boolean flags, finite numeric seconds, nullable UTC timestamps, actual versus fixed-as-of elapsed time, and separate status/logging/result/object-type vocabularies with numeric unknown fallback. No generic `default=str` or implicit Flask date conversion is used. Resource DTO assembly remains with the corresponding endpoint tasks.
- `execute_query(..., typed_timestamps=True)` registers the native -155 converter on each owned logical connection before creating a cursor. Its default preserves legacy ODBC/formatted result shapes. Invalid options fail before connection acquisition; converter-setup failure closes the connection and reports only its safe stage. No runtime dependency was added.
- Added six timestamp tests, seven serializer/schema/strict-JSON tests and three query-boundary tests. The full **130-test** database-free suite passes on the pinned standard CPython 3.14.8 Windows x64 environment, including all previous legacy, cleanup, observability and entry-point tests. `pip check`, 90 local Markdown links/anchors across the six changed docs, 16 Stage C task IDs and whitespace checks pass.

Native proof: **26 assertions / 15 application queries / 3 current catalog rows PASS**, using pyodbc 5.3.0, Driver 17.10.0006 and SQL Server 2022 (16.00.1000), under the existing configured validation SQL identity. Twelve controlled SELECTs cover original-offset and canonical parameter binding, seven digits, adjacent 100-nanosecond values, +05:45/-00:30 offsets, +/-14-hour date/year rollovers, IDs above JavaScript's exact range, maximum BIGINT LSN, NULLs, counts, Decimal/Boolean and unknown codes. Real raw catalog timestamps match independent SQL UTC text projections. The next unconverted logical connection still reproduces -155, proving converter isolation; legacy formatted text stays unchanged. All query cleanup reports succeed, including the expected raw-driver failure. This is conversion evidence, not reader/HTTP endpoint or performance acceptance.

Private evidence: `.local/backend-validation/runs/c1b-20261015T202103Z/result.private.json`; reusable read-only probe: `.local/backend-validation/tools/probe-typed-data.py`. The probe replaces only SQL-resource loading with controlled SELECT text; the application uses real pyodbc connections/conversion/fetch/cleanup. The restricted-shell attempt failed during Windows credential/encryption setup before any query; the approved native probe ran successfully outside that restriction. No server, package execution or catalog write was needed.

C1c subsequently implements the API HTTP namespace, metadata, health and safe JSON errors as recorded below. B5a3/P0b remain open for OBS-02 and deferred host gates; the separately tracked typed datetimeoffset limitation is resolved only for this tested converter/baseline. Broader platforms/drivers and resource-specific reader/SQL/HTTP checks keep their own gates.

## C1c / API HTTP boundary, metadata and health

Completed 15 October 2026 on `dev-next`. Implemented **3 of 14** GET operations: `/api/v1/meta`, `/healthz` and `/readyz`. The other 11 resources remain planned in OpenAPI; no placeholder catalog endpoints were added.

- Added one API blueprint and application-level routing/error integration so matched and unmatched `/api/v1` failures use fixed safe RFC 9457 problems. Server-generated request IDs and no-store cover API/health successes/errors/HEAD/OPTIONS; 405 preserves `Allow`, and a future real 401 challenge is retained. Legacy HTML/error/debug behavior and routes retain their contracts. JSON encoding rejects nonfinite values and does not stringify unsupported types.
- Added shared strict, single-pass UTF-8/percent query parsing and declared query-key allowlists; supplied malformed/unknown/duplicate/empty values, NUL and GET/HEAD bodies fail before SQL. Shared integer, positive BIGINT ID, UTF-16 name-width, status-set and exact timestamp helpers are available for resource tasks. Accepted query keys and capability metadata are attached to views so automatic OPTIONS receives the same guard as GET/HEAD.
- Added startup-validated Boolean API policy flags and positive range/bucket/readiness limits. Metadata exposes only versions, timezone, vocabularies, policy and non-secret wire limits. Its execution-sort list is empty until C2a. API flags apply to the API during coexistence; legacy pages keep their existing SQL-identity access. No browser/proxy identity header grants access or changes the SQL identity. Events/values resource/redaction implementations remain C5/C6.
- Liveness and metadata use zero SQL. Readiness uses one checked-in zero-row `catalog.executions` read in SSISDB, independent of visible row count, with positive per-driver login/query caps of at most two seconds and no increase to a lower global timeout. It retains safe query timing/cleanup. This does not promise a two-second HTTP deadline or workflow readiness.
- Moved the shared legacy application version to `dashboard/version.py`; the rendered value is unchanged. No dependency or hosting/process change was introduced.

Validation: **148 tests PASS** (130 previous + 18 C1c) on standard CPython 3.14.8/Windows x64, with `pip check` clean. Actual metadata/liveness/readiness responses match OpenAPI. Tests cover safe 400/401/403/404/405/500/503/504 responses and canary-free logs, driver/permission/conversion/cleanup failures, exact namespace/trailing/double-slash routing, HEAD/OPTIONS, no SQL before validation/denial, forged identity headers, per-app config, exact/Unicode names, UTF-16 limits and seven-digit input timestamps. The 401/capability/input fixtures exist only in tests; they are not extra production endpoints. Dependency consistency, 92 local Markdown links/anchors, 16 Stage C task IDs and whitespace checks pass.

Native proof: **42 assertions / 9 schema-validated responses / 4 native query attempts PASS** through Flask's WSGI test client and the existing configured validation SQL identity. The real readiness query succeeds, a controlled five-second WAITFOR hits the one-second driver query timeout and produces safe 504, the next readiness request recovers, and a native missing-driver path produces safe 503/IM002 without its credential canary. Metadata/liveness/invalid/missing/method requests are proven database-free; all observed query cleanup reports succeed. No TCP server or catalog mutation was required. This does not replay actual reader HTTP, network/proxy/access logs or shared hosting.

Private evidence: `.local/backend-validation/runs/c1c-20261015T203747Z/result.private.json`; reusable probe: `.local/backend-validation/tools/probe-api-http.py`. Production hosting, the remaining five incomplete backend checklist cases and resource-specific normal/restricted-reader SQL/HTTP comparisons retain their gates.

C2a/C2b subsequently implement the execution list and all 12 global sorts as recorded below. Remaining resources retain their own gates.

## C2a / bounded execution list and ID cursors

Completed locally 16 October 2026 on `dev-next`. Implemented `GET /api/v1/executions`, bringing Stage C to **4 of 14** GET operations; 10 remain planned. At C2a completion, OpenAPI and `/meta` expose only `execution_id`; other sorts return 400. C2b subsequently implements them as recorded below.

- Added exact folder/project equality and separate deliberate glob selectors without legacy sentinels or trimming. The glob language accepts only `*`, escaped literal asterisk and escaped backslash; SQL wildcard/escape characters are escaped and bound in 1024-unit parameters. Names retain SQL UTF-16 widths, including 128-unit folder/project and 260-unit package names. Name matching follows catalog collation.
- Resolve `[from,to)` on `created_time`, canonical UTC bounds and a default elapsed-hour window once per paging chain. Validate positive capped spans with full 100-nanosecond precision. Fixed legacy `AS_OF_DATE` is resolved at startup in `DISPLAY_TIMEZONE` only for a unique valid instant; ambiguous/nonexistent DST times require an explicit offset. Historical `to` does not freeze current status/counts. Actual duration and fixed-as-of elapsed time retain their separate NULL/clamp rules.
- New checked-in SQL captures a scoped visible upper ID, then materializes at most `limit + 1` candidates (maximum 201) before count/logging lookups for those IDs. Default 50/max 200 are independent of legacy `EXECUTION_COUNT`; no exact-total query is added. Both ID directions use bound keyset predicates and fixed SQL expressions. Native typed timestamps, string BIGINT/LSN identities, unknown-code fallback, recorded counts, NULL timings and real row names pass through the explicit execution DTO. Legacy SQL/views remain available.
- Added versioned HMAC cursors using a random server-owned process key, keyed digests for canonical filters and the configured SQL/policy scope, the initial upper ID/last ID and fixed first-page `as_of`. Tokens are bounded to 8192 characters and expire after 1800 seconds without sliding. Continuations repeat selectors and explicit returned bounds; malformed/tampered/wrong-resource/scope/restart/expiry/mismatch cases fail with safe cursor problems before SQL. Every valid page rereads catalog visibility; inserts above the fence are excluded, while retention/revoked visibility can produce a successful empty terminal page. This is live browsing, not a snapshot or authorization token.
- Added 20 focused execution/configuration tests. The full **168-test** database-free suite passes, including all previous legacy/error/cleanup/contract regressions, HEAD/OPTIONS, bound ODBC types and resource closure, exact range limits/DST, both directions and page limits, cursor chains/expiry/scope changes, canary-free application logs, large IDs, seven digits and safe bad-row/timeout failures. `pip check`, 49 local document links/anchors, 16 Stage C task IDs, ignore boundaries and whitespace checks pass. No dependency or server was added.

Native current-catalog proof: **1461 assertions / 88 schema-validated responses / 100 observed application queries PASS** against 16 real executions, with independent SQL comparisons of identities, status, counts, logging and UTC timestamps. Ascending/descending traversal, exact names, status selection, empty scope and both 100-nanosecond cohort boundaries pass. Existing normal/restricted readers are replayed through administrator-session `EXECUTE AS LOGIN`; their visible sets are 16 and 2 executions and match independent catalog reads. This is real catalog/permission evidence through the Flask WSGI test client, **not independent Windows reader sign-in or TCP HTTP acceptance**. All observed query cleanup succeeds.

Native edge-case proof: **1158 assertions / 31 schema-validated responses / 58 application queries PASS** using connection-local SQL table variables, with 256 initial rows and 254 in the selected cohort. Default 50/max 200 and a 201-row sentinel result, both directions, created/pending/running/unknown states, exact lower/upper bounds, Unicode/apostrophe/literal wildcard/backslash names, 128-unit names, a 260-unit package, missing logging/environment/actual times, separate system logging metadata, recorded counts, exact UTC/duration values and an insertion above the original fence all pass. These are controlled native SQL fixtures, not extra persistent SSIS executions. No grants, package runs, catalog writes or TCP server were needed.

Plans/timings: six actual plan resultsets cover the fence, bounded candidate insert and selected-ID count/logging result in both directions. On this small 16-row catalog, the measured fence queries take 311–595 ms and page queries 2927–3190 ms including connection acquisition/cleanup. A separate equivalent-workload comparison returns identical typed rows: the retained APPLY query takes 2506–2566 ms and a set-based variant 2449–2516 ms over two interleaved samples each. Both plans still perform the same repeated catalog event/logging scans, so the alternate query provides no demonstrated timing/scan benefit and was not adopted. The candidate/count boundary is verified; physical catalog-view IO is not restricted to only matching event rows. Larger workloads, representative cold/warm distributions, independent reader sign-in/HTTP and p95 acceptance remain C8 checks; no performance target is claimed here.

Private evidence: `.local/backend-validation/runs/c2a-20261015T205707Z/result.private.json`, `.local/backend-validation/runs/c2a-20261015T210048Z/fixtures.private.json` and `.local/backend-validation/runs/c2a-20261015T210252Z/comparison.private.json`, with SQL plans. Reusable probes are `tools/probe-execution-pages.py`, `tools/probe-execution-fixtures.py` and `tools/measure-execution-query.py` under the ignored backend-validation directory. The earlier failed fixture-probe expectation remains private and was corrected to follow the catalog's Unicode collation; no application collation was changed.

C2b subsequently adds the remaining global sorts with complete-cohort ordering, NULL handling, ties and measured calculated-sort queries. C3a/C3b navigation/summary follows; the first native screen and full Stage C acceptance keep their separate gates. OBS-02 and deferred host/stream checks remain unchanged.

## C2b / remaining global execution sorts

Completed locally 16 October 2026 on `dev-next`. All 12 execution sorts are implemented and advertised consistently by OpenAPI and `/meta`: execution ID, creation/start/end time, project/package/environment, numeric status/logging, actual duration and recorded warning/error counts. The API still implements four of 14 GET operations; navigation is next.

The three focused slices are complete: C2b.1 typed seek state, C2b.2 global SQL order/calculated keys, and C2b.3 local/native comparisons and measured plans.

- Added [sort-key operations](../dashboard/execution_order.py) that retain exact UTC timestamps, decimal-string numeric keys, public catalog name keys and explicit per-component NULL flags. Cursor format v2 binds those keys plus the last execution ID under the existing HMAC/filter/SQL-policy scope, fixed `as_of`, upper-ID fence and non-sliding TTL. Old/malformed/wrong-sort/type/NULL/range/scope state fails safely before SQL. Name keys retain SQL UTF-16 widths and are compared by SQL under catalog collation; no last-row lookup is needed after retention.
- Retained C2a's ID query unchanged. The new [global-sort SQL](../dashboard/query/api-executions-sort.sql) materializes matching metadata under the same filters/time bounds/ID ceiling and uses only fixed CASE expressions and typed binds. Logging, duration and count branches compute their required keys across the cohort before paging; base/date/name/status sorts retrieve counts/logging only for the bounded candidates. Counts/logging already used for ordering are reused in output. Every response fetches at most 201 candidates and returns at most 200 rows; there is no exact-total query or Python page sorting. SQL work for global orders still scales with the matching cohort.
- NULLs are last in both directions; environment compares folder then name with NULLs last for each component. The ID tie-breaker follows the requested direction. Actual duration has a NULL key without both timestamps; UTC whole seconds plus fractional ticks preserve 100-nanosecond order across long runs without a whole-duration nanosecond overflow. Floating-point JSON seconds are never a seek key. See the [SQL function's range/precision contract](https://learn.microsoft.com/en-us/sql/t-sql/functions/datediff-big-transact-sql).
- Added eight focused [sorting tests](../tests/test_execution_sorting.py), covering all 24 sort/direction combinations across pages, ties/NULL groups, raw keys beyond JavaScript/JSON precision, compound/wide Unicode names, malformed authenticated state, sort/direction binding, upper inserts, retention and live count changes. All **176 database-free tests PASS** (168 previous + 8), including legacy/HTTP/type/cleanup/contract regressions. Dependency checks, 52 local document links/anchors, 16 Stage C task IDs, ignore boundaries and whitespace checks pass; no dependency or server was added.

Native fixture proof: **179 schema-validated responses / 213 observed application queries PASS**, covering 254 selected rows and all 12 sorts in both directions against independent SQL ordering. Ties cross 37-row pages; 200-row response limits and 201-candidate results remain bounded. Case, accent, trailing-space and Unicode name equivalence follows the database collation; composite/partial-NULL environments, signed unknown status/logging codes, active/missing actual times, recorded counts, offsets and long durations order correctly. A new execution above the original fence stays out until refresh. These are SQL table-variable fixtures, not added SSIS executions.

Native integration and precision proof: **19 responses / 25 queries** verify exact folder/project, deliberate pattern and status filters with global metric ordering. A controlled warning-count change can repeat a previously seen row in an existing chain; a fresh chain returns the new static order. This validates the documented live behavior rather than promising a snapshot. Another **8 responses / 12 queries** put adjacent 100-nanosecond timestamps and 8999-year durations differing by one tick across limit-1 page boundaries in both directions; the raw timestamp/BIGINT cursor values survive real ODBC binding and SQL comparison.

Native current-catalog proof: **88 responses / 120 queries PASS** for the 16-row selected catalog cohort and every sort/direction. Independent SQL agrees on order, identities, counts, logging and UTC timestamps. Administrator-session `EXECUTE AS LOGIN` compares environment/duration/count/logging paths for the existing normal and restricted readers (16 and 2 visible executions). This is catalog visibility and WSGI request evidence, not independent Windows-account sign-in or TCP HTTP acceptance. All observed query cleanup succeeds; no grants, package runs or persistent catalog changes were needed.

Plans/timings: **35 actual plan resultsets** cover seven representative branches: ID, start time, environment, logging, duration, warnings and errors. Captured requests have 16 candidates; the controlled fixture separately proves a 201-candidate ceiling. In the same local run, the ID query takes **5417 ms**; start/environment/logging/duration/warning/error queries take **6083 / 4587 / 4624 / 4188 / 5360 / 5782 ms** respectively, including connection acquisition/cleanup. Fence queries take **230–764 ms**. These are one sample per shape on a small catalog, not cold/warm distributions, a speedup claim or p95 acceptance. Matching-cohort materialization, catalog-view IO/compile cost and representative larger workloads remain part of C8's performance work; no hard IO limit is claimed from the response cap.

Private evidence, under `.local/backend-validation/runs/`: `c2b-20261016T004142360018Z/fixtures.private.json`, `c2b-20261016T004450706334Z/integration.private.json`, `c2b-20261016T005031306078Z/precision.private.json`, `c2b-20261016T004144079947Z/catalog.private.json` and `c2b-20261016T004828121859Z/plans.private.json`, with SQL plans. Reusable read-only probe: `.local/backend-validation/tools/probe-execution-sorts.py` (`fixtures`, `integration`, `precision`, `catalog`, `plans`). Independent reader sign-in/HTTP and larger-workload acceptance remain C8 checks. OBS-02 and deferred host/stream gates keep their recorded status.

Next: **C3a** implements bounded visible folders/projects with exact folder identity and authenticated navigation pages. C3b summary follows. Preserve the recorded performance/correctness review after C8.

## B1 work record

Scope: startup/configuration and legacy presentation registration. Database execution/cleanup, SQL fixes, API resources, production hosting, and streaming are separate milestones above.

Completed locally on 12 October 2026:

- Added `create_app`, moved legacy view/template registration out of global app decorators, and retained all eight URL patterns and endpoint names. Importing the package no longer constructs an application or loads a user configuration file.
- Isolated defaults and mapping overrides between app instances. Monitoring reads configuration from the active Flask app context. Configuration file precedence is explicit; optional root configuration works outside the project directory and loading does not mutate environment variables.
- Removed the unused `distutils` import, defaulted debug to off, and updated the Flask CLI, Visual Studio launcher, and explicit `dashboard.wsgi:app` entry point. The IIS handler now names that entry point; its old interpreter path is still a B5c deployment task.
- Added populated synthetic presentation fixtures and standard-library regression tests. Updated local development instructions and linked this progress log from the roadmap, plan, and README.

Validation environment: Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**. Runtime packages were installed from the existing local wheelhouse; no additional application or test dependency was introduced.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -v` | Passed: 19 tests | Configuration defaults/precedence/failure/isolation, nested app contexts, import/entry-point behaviour, populated legacy templates, links, context helpers, escaping, and static assets; database connections rejected by test guards |
| `python -m flask --app dashboard:create_app routes` | Passed | All eight legacy endpoints plus static serving registered without a database connection |
| `python -m flask --app dashboard/__init__.py routes` | Passed | Legacy Flask app-path discovery still finds the factory |
| `python -m pip check` | Passed | The installed local runtime dependency graph is consistent |

The B1 tests validate application construction and server-rendered HTML, not browser JavaScript or real SQL results. No real SSISDB connection, Windows/SQL authentication, Python 3.14, container, IIS host, production server, or stream integration was validated. At B1 completion, the remaining database/filter/error/runtime work was assigned to B2–B5c and the API phase; later milestone records below track that work separately.

## Workflow baseline coverage

This checklist is the initial P0a coverage. Complete SQL field/semantic parity and real-data evidence remain work for P0a/P0b and the relevant implementation milestones.

| Workflow | Current local evidence | Remaining evidence/work |
| --- | --- | --- |
| Overview, folder/project/status navigation, metrics/timeline | Populated synthetic overview renders; original navigation URLs and filters work; B4 records six required query calls and bound status/name/window/count arguments | Real query results/cohort semantics and timings; aggregate event-KPI adapter is tested locally but not displayed on the overview |
| Execution details, executables, child packages | Synthetic executable and child sections render with status helpers | SQL field parity and repeated/parallel/incomplete child observations |
| Event messages | Synthetic event row renders for all five categories and HTML-like text stays escaped; unsupported categories fail before queries | Real category/filter semantics, bounded querying/search, and event volumes |
| Parameters and property overrides | Both synthetic sections render, including parameter flags | Real typed/sensitive values and endpoint access/redaction rules |
| Duration history | Populated synthetic history/table/chart data renders | History scope/limit/estimate fixes and actual SSISDB results |
| Refresh and browser state | Legacy templates are retained | Legacy full-page refresh remains; in-place updates and stream recovery belong to phases 3–5 |
| Missing pages and DB failures | B2 verifies resource cleanup; B3 covers database-independent routing/static/method errors, missing-execution short circuit, safe HTML/status mapping, and an ODBC timeout through cleanup to HTTP | Actual row visibility, driver/server error states, cleanup, and timeout enforcement need integration evidence; API problem JSON and access controls are later work |

## B2 work record

Scope: SQL resource loading, parameter binding, connection/cursor ownership, and driver-level timeout settings. Preserve checked-in SQL and legacy row shapes. Input/HTTP error policy, query reshaping, and the default KPI execution-filter fix remain B3/B4/API work.

Completed locally on 12 October 2026:

- Added `dashboard/db.py` with package-relative UTF-8/BOM-aware SQL resource loading, flat `.sql` resource-name validation, and a query operation that accepts explicit settings without requiring a Flask context. SQL/parameter preparation happens before connection acquisition.
- Each operation owns a new logical connection and cursor, applies the query timeout before creating the cursor, binds parameters, and attempts cursor/connection closes on success, failure, or cancellation. A failing cursor close still attempts connection closing. Cleanup errors retain the original operation error; if the operation otherwise succeeds, a close failure propagates instead of reporting success.
- Added positive, configurable driver-level login/query timeouts: `DB_LOGIN_TIMEOUT_SECONDS=10` and `DB_QUERY_TIMEOUT_SECONDS=30`. App construction and query execution reject unbounded/invalid settings without echoing their values. The legacy monitor passes the active app's connection/timeouts to the boundary.
- Preserved pyodbc transaction defaults, parameter order, SQL resources, and legacy single/list/empty result shapes. Returned values are not formatted or converted into JSON. The `0`/`-1` KPI mismatch and HTTP/error policy remain scheduled work.
- Added 23 standard-library database-boundary tests and documented the settings and integration limits. No dependency was added. Test-created temporary directories were cleaned after verification.

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 42 tests total (19 B1 + 23 B2) | Fake ODBC covers connect/timeout-setting/cursor/execute/fetch/mapping failures, query/cleanup cancellation, both close failures, primary-error preservation, timeout ordering/validation, distinct resources per call, parameter binding, typed/empty results, Unicode SQL, and execution outside the project directory; the legacy page suite also passes |
| `python -m flask --app dashboard:create_app routes` | Passed | Existing application endpoints register without SQL Server |
| `git diff --check` and SQL-resource diff | Passed | No whitespace errors and no checked-in SQL changes |

These checks validate resource ownership and settings wiring using fake ODBC objects. They do not prove native-driver timeout enforcement, physical connection release/pool behaviour, transaction behaviour against SSISDB, real row conversion, or query performance. Login/query settings are not an end-to-end HTTP deadline. Record those integration results under P0b/B5a before making production claims; the parent backend phase remains incomplete.

## B3 work record

Scope: validation and HTTP failures for the retained legacy UI. Query/cohort reshaping, aggregate KPI correction, API representations, authentication/capability enforcement, and comprehensive timing remain separate milestones.

Completed locally on 12 October 2026:

- Added database-independent validation for case-sensitive execution statuses, the five legacy event categories, the two internal detail categories, and positive SQL Server `BIGINT` execution IDs. Views validate user selectors before constructing the monitor or running a query. Monitor status/event/detail operations also reject unsupported selectors before the query boundary; event/detail SQL names now come from explicit resource maps.
- Replaced the database-dependent 404 template/handler with a standalone HTML error page. Unknown routes and missing static files return 404 without querying the catalog. Unsupported methods retain 405 and its `Allow` header; HEAD errors retain status/headers without a response body.
- Detail, event, and value routes first fetch the requested execution record. An empty visible result returns 404 and runs no subsequent queries. Present records retain legacy rendering and links. No catalog row-visibility inference or browser authorization challenge was added.
- Added safe 400/404/500/503/504 handling. Timeout SQLSTATEs map to 504; selected database connection/login/driver states map to 503; other driver errors remain 500, including SQL programming errors. Responses never echo input/driver diagnostics, SQL, connection strings, or tracebacks. Database/unexpected-error logs contain only safe status/SQLSTATE fields and a server-generated request ID; request/query timing remains B5b work.
- Every response carries `X-Request-ID`; error pages show the same ID and disable caching. Client-supplied IDs are not trusted. Added 22 standard-library regression tests, updated development instructions and the legacy Visual Studio file manifest, and introduced no dependency.

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 64 tests total (42 previous + 22 B3) | Invalid status/event/ID routes reject before monitor creation; fixed resource selection and parameter binding; all supported statuses/categories render; largest BIGINT accepted; missing executions skip subsequent queries; routing/static/405/HEAD errors; safe driver/unexpected failures and logs; unique server request IDs; timeout cleanup before HTTP response and empty fake-ODBC row through 404 |
| `python -m flask --app dashboard:create_app routes` | Passed | All eight legacy endpoints plus static serving retained |
| `git diff --check` and SQL-resource diff | Passed | No whitespace errors and no checked-in SQL changes |

These checks use synthetic monitoring/ODBC objects and do not prove actual SSISDB row visibility, endpoint permissions, deployed driver SQLSTATEs, native timeout enforcement, or production logging/hosting behaviour. Legacy HTML errors are implemented; API problem JSON and access checks remain phase 2, and stream failures remain phase 5. History filter semantics and the aggregate execution sentinel are unchanged and remain assigned work. The parent backend phase remains incomplete.

## B4 work record

Scope: legacy screen query selection and explicit event-KPI operations. Keep the checked-in SQL, time/cohort/name/status semantics, row shapes, and frontend templates intact. API query redesign and native performance measurement remain separate work.

Completed locally on 12 October 2026:

- Removed overview calls for execution info, event KPIs, executables, and children; removed execution-detail calls for engine status cards, the daily chart, and the execution list; removed event/history calls whose results their templates do not consume. Retained folder/project queries where the shared navigation uses them. Values still require both detail queries and event KPI cards.
- Replaced the ambiguous `get_package_kpi()` operation with `get_aggregate_event_kpi()` and `get_execution_event_kpi(execution_id)`. Aggregation binds `-1` only inside the legacy SQL adapter and retains folder/project/start-time filtering across statuses. Execution KPIs require an explicit positive BIGINT ID and bind neutral name patterns, independent of the monitor's selected execution or screen filters. Removed the helper that silently converted an unset execution selection to `0`; other execution resource operations now validate their selected ID before querying.
- Overview status cards continue to use `engine-kpi.sql`; there is no new overview event-KPI card or aggregate query. The aggregate adapter's `0`/`-1` correction is covered as a backend operation. Existing SQL branch semantics, including lower-only aggregate time bounds and execution-specific queries outside the dashboard time window, were not redesigned.
- Added 13 standard-library regressions that render the actual views and monitor over a recorded synthetic query boundary, verify exact resources/parameters/result modes for all eight routes and five event categories, retain visible content/navigation, and check missing/invalid request short circuits. Separate selector checks cover wildcard/Unicode/bound values, the full BIGINT range, aggregate defaults, conflicting screen state, and invalid execution selection. No dependency was added.
- Decomposed the upcoming B5a runtime work into dependency constraints, Python 3.14 validation, and native driver/catalog integration before expanding its implementation scope.

Successful legacy page query calls per request, verified with synthetic boundary traces:

| Screen | Before B4 | After B4 | Preserved data |
| --- | --- | --- | --- |
| Overview and folder/project/status variants | 10 | 6 | Navigation, status cards, daily chart, execution table |
| Execution details | 10 | 7 | Navigation, package information, event KPIs, executables, children |
| Events (all five categories) | 5 | 4 | Package information, event KPIs, escaped messages |
| Values/overrides | 5 | 5 | Package information, event KPIs, both value sections and flags |
| Package history | 5 | 2 | Server header, history table, duration chart |

Validation environment remains Windows, Python **3.11.4**, Flask **3.1.2**, pyodbc **5.3.0**.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 77 tests total (64 previous + 13 B4) | Per-screen query contracts, retained populated rendering, explicit aggregate/execution selection, invalid IDs rejected before query calls, and existing configuration/database/error regressions |
| `git diff --check` and SQL/template diff | Passed | No whitespace errors and no checked-in SQL or frontend-template changes |

The counts describe logical query calls for successful requests; failures may stop earlier. Synthetic traces do not measure SSISDB latency, execution plans, event volumes, native connection pooling, actual row visibility, or aggregate results against SQL Server. SQL cohort fixes and history scope/estimates remain phase 2 work, and real performance evidence remains P0b/B5a3. The parent backend phase remains incomplete.

## B5a1 work record

Scope: reviewed package versions, automatic runtime constraints, clean installation, and development runtime policy. Interpreter upgrades, native ODBC/SSISDB compatibility, production servers, and container modernization remain separate tasks.

Completed locally on 12 October 2026:

- Added `constraints.txt` and included it from `requirements.txt`, so the existing install command applies exact pins without another flag. Flask and pyodbc remain the only direct dependencies; the complete required graph has eight distributions. Optional extras and third-party test tools were not added.
- Reviewed the publishers' metadata/release notes and validated stable updates from Flask 3.1.2 to 3.1.3, Werkzeug 3.1.5 to 3.1.9, MarkupSafe 3.0.3 to 3.0.4, and Click 8.3.1 to 8.5.0. The new Click graph does not require Colorama; it is absent from the clean runtime. Other runtime pins remain the tested versions below. Extended the existing invalid-path regression to cover an overlong decimal execution segment with Python's normal integer-conversion limit; the updated converter returns a database-free 404.
- Created an independent environment under `.local/venv-b5a1`, resolved/downloaded binary wheels from public PyPI into ignored `wheelhouse/`, then installed offline using the tracked requirements. Installation from `.local/` with an absolute requirements path resolved the included constraints correctly. Verified that every installed runtime distribution matched its pin, and repeat resolution proposed no changes. Retained the ignored environment, reports, wheels, and reusable inspection scripts for follow-up checks.
- Documented the current validated Windows x64/CPython 3.11 baseline and the still-pending standard CPython 3.14 target. Documented clean/offline installation, version-review checks, installer/runtime separation, and the limits of version-only constraints. Updated README guidance, the Visual Studio manifest, and Docker's input-copy instruction so both requirements and constraints are present before its install step. The legacy Docker/IIS/Visual Studio interpreter settings remain unsupported hosting work; no container was built.

Pinned runtime distributions:

| Distribution | Version | Role |
| --- | --- | --- |
| Flask | 3.1.3 | Direct |
| pyodbc | 5.3.0 | Direct |
| blinker | 1.9.0 | Required transitive |
| click | 8.5.0 | Required transitive |
| itsdangerous | 2.2.0 | Required transitive |
| Jinja2 | 3.1.6 | Required transitive |
| MarkupSafe | 3.0.4 | Required transitive |
| Werkzeug | 3.1.9 | Required transitive |

Validation environment: Windows x64, **CPython 3.11.4**, **pip 23.1.2**, using `.local/venv-b5a1`. The bundled installer/bootstrap packages are not application pins.

| Check | Result | Evidence |
| --- | --- | --- |
| Online binary-wheel resolution via `pip download -r requirements.txt` | Passed | All eight required distributions resolved to the reviewed pins using public PyPI |
| Clean offline install using `--no-index --only-binary=:all: --find-links wheelhouse` | Passed | Installed from the declared requirements outside the project directory; complete installed runtime graph matches `constraints.txt` |
| Repeat offline install resolution with `--dry-run` | Passed | Installer report contains no proposed package changes |
| `python -m pip check` | Passed | No broken runtime requirements |
| `python -m unittest discover -s tests -q` | Passed: 77 tests | The existing factory/configuration, entry-point, populated template, query/resource, input/error, and per-screen query-contract suite passes with the new dependency snapshot; no live DB connection |
| Flask version/route CLI checks | Passed | Flask 3.1.3/Werkzeug 3.1.9; all eight legacy endpoints plus static serving registered |
| Ignore/status/diff checks | Passed | Environment, wheelhouse, inspection scripts, and install reports remain ignored; no SQL, frontend-template, or application-code changes |

The existing environment's pip 26 download was unresponsive and was interrupted. The fresh environment's bundled pip 23.1.2 completed online resolution/offline checks; its optional update check was disabled for bounded validation commands. The root cause of the older command's delay was not established. All task-owned CLI sessions were closed and no workspace Python process remained after checks.

This snapshot fixes package versions, not wheel hashes, Python patch versions, operating-system libraries, or deployed ODBC drivers. Python 3.14, non-Windows/native integration, actual authentication/row conversion/timeout behaviour, production hosting, and container builds remain unverified. The parent backend/runtime phase remains incomplete.

## B5a2 work record

Scope: standard CPython 3.14 compatibility using the same pinned dependency graph. Real SSISDB/driver behaviour, free-threaded Python, other platforms, and production hosting remain separate checks.

Completed locally on 12 October 2026:

- Downloaded the official standard x64 CPython 3.14.8 NuGet runtime into `.local/`, following the Python project's CI-runtime documentation. Verified a 64-bit `cp314-win_amd64` build with the GIL enabled, plus bundled `venv`/`ensurepip`. Created a new `.local/venv-b5a2` without changing the system Python, PATH, or launcher registrations. The archive, runtime, wheels, reports, and reusable preparation script remain ignored.
- Resolved the same eight runtime pins on the actual 3.14 interpreter. Downloaded `pyodbc-5.3.0-cp314-cp314-win_amd64.whl` and `markupsafe-3.0.4-cp314-cp314-win_amd64.whl`; installed offline from the requirements file while outside the project directory. No source compilation or additional runtime dependency was needed.
- Verified the complete installed graph, native pyodbc and MarkupSafe extension loading, dependency consistency, and repeat installation with no proposed changes. All 77 tests pass, including factory/configuration/import/entry-point subprocess tests, populated legacy pages, fake-ODBC cleanup, safe failures, and per-screen query contracts.
- Verified Flask version discovery and both `dashboard:create_app` and `dashboard.wsgi:app` route discovery. Updated the development guidance to prefer standard CPython 3.14, select the interpreter explicitly, and create a new environment when changing Python minor versions. No application-code, SQL, frontend-template, or dependency-pin change was necessary.

Validation environment: Windows x64, **CPython 3.14.8**, **pip 26.2.1**, Flask **3.1.3**, pyodbc **5.3.0**, using `.local/venv-b5a2`. Runtime source: [official NuGet package](https://www.nuget.org/packages/python/3.14.8); package choice follows [Python's Windows CI documentation](https://docs.python.org/3.14/using/windows.html#the-nuget-org-packages).

| Check | Result | Evidence |
| --- | --- | --- |
| Runtime/ABI/build probe | Passed | CPython 3.14.8, 64 bits, `cp314-win_amd64`, GIL enabled |
| Binary-wheel resolution and clean offline install | Passed | Exact eight-package graph; matching cp314 native wheels; included constraints also resolve outside the project directory |
| Native imports and `python -m pip check` | Passed | pyodbc/MarkupSafe `.pyd` modules load; no broken requirements |
| Repeat install `--dry-run` | Passed | Installer report proposes no changes |
| `python -m unittest discover -s tests -q` | Passed: 77 tests | Same database-free suite on the new interpreter; test-created subprocesses use its executable |
| Flask CLI and factory/WSGI route discovery | Passed | All eight legacy routes plus static serving register through both entry points |
| Ignore/diff checks | Passed | Local runtime/environment/wheels/scripts/reports are ignored; runtime pins and application/SQL/templates remain unchanged |

Native extensions load with this Windows/interpreter ABI; this does not validate a deployed SQL Server driver or real catalog. No SSISDB connection, authentication, actual row conversion, native timeout enforcement, permission visibility, production server, or other OS/architecture/free-threaded Python was validated. At the user's request, B5a3/P0b are deferred to consolidated manual checks after the B milestones; prepare a tracked checklist during B5b rather than waiting for a database configuration now.

## B5b work record

Scope: focused application request/query timing and safe error events, plus the requested consolidated manual checks. Native SSISDB tests remain deferred until the user finishes the B implementation checks; production hosting and stream instrumentation remain separate work.

Completed locally on 12 October 2026:

- Added JSON application events for query completion, request completion, database errors and unexpected request errors. They share the server-generated request ID. Fixed endpoint/resource labels, status/outcome, durations, row counts, query counts and validated SQLSTATEs are recorded; raw input/URLs/headers, SQL/parameters, configuration, credentials, row values and exception text/tracebacks are excluded.
- Added an optional completion observer to the standalone DB operation without introducing a Flask dependency there. Query timing spans acquisition, timeout setup, cursor creation, execution, fetch, mapping and resource cleanup. Success/empty/failure/cancellation and cleanup failures remain distinct; observers run after cleanup, preserve active query/cleanup errors, and do not change outcomes on ordinary observer errors.
- Moved request-ID hooks into the timing boundary, reset counters at each request, and guard duplicate teardown observations. HTTP failures and dispatch cancellation produce safe summaries; manually pushed contexts do not create phantom requests. Tests cover retained and concurrent contexts. Request duration stops at response preparation, not body/network/stream completion.
- Added a validated `LOG_LEVEL` setting, default INFO, for the process-wide application logger. Logging sinks are best effort; a failed sink cannot replace a safe HTTP error. Added 17 standard-library regressions and updated the existing query-contract assertion for the optional observer.
- Prepared [the tracked manual backend checklist](BACKEND_CHECKLIST.md): environment/configuration, driver/authentication/visibility/types, every legacy workflow and query counts, bad input/missing rows, native timeouts and recovery, log correlation/redaction, cold/warm measurements, pooling/cleanup, and pending hosting checks. Each case has steps, expected evidence, and a NOT RUN result field. Known legacy cohort/history/access limitations and separate API/stream gates are explicit.

Validation environment: Windows x64, standard **CPython 3.14.8**, **pip 26.2.1**, the same eight pinned runtime distributions, using `.local/venv-b5a2`.

| Check | Result | Evidence |
| --- | --- | --- |
| `python -m unittest discover -s tests -q` | Passed: 94 tests (77 previous + 17 B5b) | Safe JSON fields and IDs, deterministic durations/sums, query failure stages, empty/multi-row shapes, both cleanup attempts, primary-error preservation, cancellation, observer/sink errors, retained/concurrent request isolation, no phantom/double summaries, and all earlier regressions |
| Native Windows driver-manager negative probe | Passed | A confirmed unregistered driver returns IM002/503 before any server connection; three correlated query/error/request events, no credential canary, one failed acquisition. This is not SSISDB/SQL-driver integration evidence. |
| Factory/WSGI registration and diff/ignore checks | Passed | Application endpoints remain registered; no SQL/template/dependency-pin changes; probes/test reports and local runtime remain ignored |

Timing/log transport is best effort and does not impose a total HTTP deadline. SQL preparation is outside query timing; request timing excludes network/body transfer and future stream lifetime. Application-event sanitization does not configure external server/proxy/access/startup logs. Native authentication, data correctness, row visibility, driver timeout enforcement, actual pooling/cleanup, representative performance and chosen-host behaviour remain manual gates in the checklist; none is marked complete here.

## B5b1 review follow-up

Scope: address the review finding that unexpected failures retained only a generic request-error event, with no actionable exception/location information or explicit local propagation path. This is a focused correction to B5b; hosting/API/SQL work remains separate.

Completed locally on 13 October 2026:

- Database and unexpected-error events include a sanitized exception type and the most recent eight Python application frames, each with module, function and line number. Application locations are derived from package-contained source paths, with bounded identifier labels. No exception arguments/text/notes/chains, source lines, locals, absolute paths or formatted traceback are logged.
- Explicit Flask `PROPAGATE_EXCEPTIONS=True` with debug or testing enabled re-raises the original error after the safe event. Flask's exception signal and debugger/test propagation work normally. Expected validation/HTTP errors remain responses, and the propagation flag alone does not expose these errors when debug/testing are off.
- Seven focused regression tests cover actionable/redacted and bounded locations (including forged external metadata), debug/test opt-in and original exception identity/signals, production-safe responses, database cleanup before propagation, expected HTTP errors and one correlated aborted-request summary. Existing driver-state tests also require useful application error locations.
- Updated installation guidance and the deferred manual checklist. No runtime dependencies, SQL, page templates or hosting commands changed.

Validation environment: Linux x64, **CPython 3.12.14**, the same eight pinned runtime packages, and a locally extracted Ubuntu unixODBC driver-manager library to load the native pyodbc wheel. No SQL Server driver or catalog connection was used.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused error suite | Passed: 29 tests | Safe exception/location fields, redaction, bounded frames/external exclusion, debug/test/production modes, original error/signals, cleanup before propagation and unchanged HTTP mappings |
| Full database-free suite | Passed: 101 tests (94 previous + 7 follow-up) | All legacy routes, queries, resource ownership, validation, timing and request isolation regressions pass |
| Dependency consistency, route discovery and `git diff --check` | Passed | Eight-package graph is consistent; all eight legacy endpoints and static serving register; no whitespace errors |

Windows/CPython 3.14 replay and real SSISDB/hosting checks remain open; this follow-up does not change their status.

## Local validation preparation

Prepared against merged `dev-next` commit `45bfb3c`:

- Added the [local SSISDB validation guide](BACKEND_CHECKLIST.md) with Windows setup/configuration commands, required catalog fixtures, a bounded native connection/timeout probe, browser walkthroughs, SQL/visibility comparisons, failure/recovery procedures, log correlation, timing and resource checks.
- Marked all 30 checklist cases by execution ownership: 6 database-free, 10 automatable after catalog setup, 11 requiring both automation and setup/visual/local access, and 3 awaiting hosting. These are feasibility labels; a complete native integration runner is not implemented. Remote chat access does not imply access to the user's localhost or Windows identity.
- Kept all integration results NOT RUN. This documentation preparation does not change B5a3/P0b, the Windows replay requirement, or B5c. No application, SQL, template or dependency changes.
- Verified all case labels, unchanged result statuses, local Markdown links/anchors, Python snippet syntax and whitespace. On the existing Linux/Python 3.12 environment, replayed route discovery from two working directories, invalid-timeout rejection and the helper's missing-driver failure path without leaking dummy credentials. PowerShell execution, successful SQL connections and native SQL timeouts still require the Windows/SSISDB setup; the 101-test application suite was not rerun for this documentation-only change.

At this preparation stage, the next active validation was **B5a3b/P0b**, the missing local reader identities and representative fixtures; B5a3b2 below records their later completion. B5c and related hosting work remain deferred at the user's request; their eventual delivery gates do not block local API work.

## B5a3a / local real-data validation

Completed on 15 October 2026 against `dev-next` at `37bc7ac00015906bbdd16f55e74daa48333b4962`. The user installed the local SQL Server/test databases and sample SSIS job, then requested every currently checkable checklist item. The user explicitly deferred separate monitoring/restricted identities.

- Reused four existing completed catalog executions (two succeeded, two failed), their events/parameters and two successful history rows. No jobs/packages were started or redeployed, database objects/permissions changed, or application/SQL/dependency files edited. Environment-specific helpers/configs/results remain in ignored `.local/backend-validation/`.
- Created a fresh standard CPython 3.14.8/x64 environment from the pinned wheelhouse. All eight runtime pins, native imports, dependency consistency, factory/CLI routes and **101 database-free tests** pass on Windows. The previous B5b1 Windows replay gap is closed for this commit/runtime.
- Connected through native x64 ODBC Driver 17.10.0006 to SQL Server 2022 Developer 16.0.1000.6/SSISDB schema 7 using the current Windows administrator identity. Absolute private config/settings and real startup agree across working directories. Seven invalid configuration launches reject safely.
- Ran **105 scripted HTTP requests** plus a browser review. Recorded expected page query counts, absent/invalid request short circuits, 29 independent SQL dataset comparisons plus card/aggregate KPI parity, actual plans for 17 resources, native scalar types and actual sensitive catalog NULLs. Existing formatted timestamp workflows pass; an additional raw datetimeoffset probe fails with unsupported ODBC SQL type -155 and remains an explicit future typed-data limitation.
- Verified missing-driver, dummy denied-login (`28000`/503) and unused loopback (`08001`/503) failures, safe events/HTML/headers and fresh valid recovery. The direct five-second delay was cancelled with `HYT00` at **1.014 seconds**. A separate real details request timed out in unchanged KPI SQL at the one-second driver setting and produced **504/HYT00**, about **1.285 seconds** client time, followed by normal recovery.
- Correlated request/query/error events and canary redaction; confirmed actual overlapping server query events and independent counts. DMV sampling observed native cancellation and 129 workload samples settling to zero active requests/transactions with two stable idle pooled sessions. All **12** task-owned loopback servers and the browser tab closed; final process/listener ownership audit is clear. An unrelated application reusing an old PID was preserved; SQL Server/Agent stayed running.
- Updated all 30 checklist results and added the [sanitized report](BACKEND_CHECKLIST.md#recorded-baseline-15-october-2026). **16 cases PASS completely, 10 retain NOT RUN for specific remaining assertions after passing subchecks, and 4 are not run.** No exercised legacy application defect remains from the reviewed results. Initial local-helper quote/line-ending and driver-state assumptions were corrected against preserved evidence; the raw reports remain private and intact.

Warm application medians were approximately **448 ms overview, 1,735 ms details, 1,360 ms events, 1,406 ms values and 10 ms history**. `package-kpi.sql` dominated details/events/values; a captured aggregate plan showed 2,412 ms compile and 98 ms execution time. These are small-catalog baseline samples, not p95/production guarantees. Keep KPI compilation cost as a measured SQL/API follow-up. Legacy NULL display, history heading/status/scope/estimate and wildcard/cohort semantics remain documented baseline behavior.

**Still open:** intended monitoring/restricted identity and hidden-row behavior; populated active/incomplete/children/override/special-text/duplicate-memory-warning and six-run history cases; native cleanup-failure observation; chosen-host/service/proxy/authentication/transport/access-log checks. Development access logs contain request URLs, so application redaction does not close B5c. B5a3/P0b and phases 0–1 remain incomplete; future API authorization and streaming are separate roadmap work.

## Local setup and hosting priority update

On 15 October 2026, the user put hosting and related work on hold and requested the remaining prerequisites and login permission/creation instructions.

- Marked B5c deferred and kept HOST-01/02/03 plus the production host portion of OBS-03 NOT RUN. Production proxy/transport/service/container/logging and production stream-capacity checks remain future work; local permission/application checks continue.
- Added [the concrete setup guide](SSIS_FIXTURE_PROJECT_GUIDE.md): two reader identities, a dedicated harmless fixture project, sufficient history, a bounded running case, repeated/parallel children, controlled values/property overrides and special text. No new business database or SQL Agent job is required.
- Live read-only metadata inspection confirms Windows-only authentication and the installed `ssis_logreader` role. Current view definitions confirm catalog-wide log visibility for that role and the separate need for folder READ. The normal reader uses that role in the dedicated lab; the limited reader gets selected folder/project/operation READ only.
- Prepared ignored `.local/backend-validation/tools/setup-readers.sql` with input checks, database-user mapping, CONNECT/catalog grants and private visibility-pair output. It is a draft for the user to execute through a Windows-authenticated administrator; accounts, permissions, authentication mode and fixtures were not changed by this preparation. Windows-backed server logins preserve the current authentication mode; SQL password logins require the separately explained mixed-mode/restart step.
- Setup guidance was checked against current Microsoft documentation and the actual catalog metadata; operation visibility requires explicit operation READ. The draft grant script passed SQL Server PARSEONLY without executing its statements; local links, checklist counts and whitespace were checked. Account creation, new-account sign-in, effective visibility and fixture behavior remain unvalidated until setup/run. No application change or new runtime dependency was introduced.

Follow-up: the user's CREATE LOGIN screenshot reports SQL error 15401 for both Windows reader names. Read-only inspection confirmed the computer prefix matches and both local accounts return UserNotFound. Expanded the guide with the missing Windows-account creation step and prepared ignored `create-reader-windows-users.ps1` with secure password prompts and standard Users membership. Its PowerShell syntax was parsed without running account mutations; actual account creation/login/grant validation remains pending the user's setup. Hosting remains deferred.

## B5a3b1 / reader inspection and fixture design

On 15 October 2026, the user confirmed creating the logins and running `setup-readers.sql`, then requested a project design and step-by-step creation guide. This task prepared the remaining fixture; B5a3b2 records its later build/deployment and completed live validation below.

- A read-only administrator audit found both mapped database users and enabled Windows-backed logins. Session impersonation returned sysadmin/db_owner/ssis_admin zero for both, ssis_logreader one only for the normal reader, four visible existing executions for that reader and one for the limited reader. The administrator identity was restored. No grants or packages were changed. Independent reader sign-in and HTTP behavior were NOT RUN at this preparation stage.
- Added [the complete SSIS fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md): `Probe.dtsx` provides bounded waits, typed/sensitive parameters, harmless special text and labeled category/failure events; `Parent.dtsx` calls it twice sequentially through one loop task and twice in parallel. No database/file/network connections or additional runtime dependencies are required.
- The guide contains exact designer settings, copyable C#, build/deploy steps, a six-run history script, controlled execution matrix, Description override and additive fixture grants. The existing initial account script must not be rerun to recreate users. Only the fixture build/deployment and actual reader-authenticated sessions require the user's current manual setup; subsequent local SQL and HTTP checks can be coordinated by the assistant.
- Visual Studio 2022 Community is installed; designer-extension/VSTA usability is not confirmed. Compiled the guide's method with .NET Framework against the installed SQL 2022 ManagedDTS/ScriptTask APIs. Both extracted SQL drafts passed native PARSEONLY; neither was executed. Reusable snippets, compiler wrapper, audit and evidence stay in ignored `.local/backend-validation/`.
- Checked guide/snippet consistency, local Markdown links/anchors, unchanged checklist case counts, ignore boundaries and whitespace. No application/SQL resource/template/dependency changes; the application test suite was not repeated for this documentation-only preparation. Designer/VSTA compilation, `.ispac` build/deployment, fixture execution and new reader HTTP checks were NOT RUN at this stage; B5a3b2 below records the later deployed fixture and reader replay. Hosting remains deferred.

## Validation documentation and local artifact consolidation

On 15 October 2026, while the user builds the test project, consolidated five validation documents into two: [the checklist/runbook/results](BACKEND_CHECKLIST.md) and [the SSIS fixture/reader guide](SSIS_FIXTURE_PROJECT_GUIDE.md). Removed the separate procedure, account-setup and dated-report documents after retaining their unique guidance/findings and private original snapshots. Updated README/roadmap/plan/progress links. The fixture build steps, method and execution/grant snippets retain their existing paths and contents.

Organized ignored `.local/backend-validation/` into current `tools/`, unchanged `fixture-tools/`, the existing `dashboard.cfg`, and dated `runs/` evidence, with one local README. Inventoried 368 files before moving 361 of them; all relocation hashes passed and seven protected config/fixture files stayed in place. Original run artifacts and one-off runners are frozen together for provenance; current helpers have updated paths. A private relocation manifest and before-doc snapshots support recovery.

Validation: all 30 case definitions/results preserved, local links/anchors and helper syntax/path calculations checked, original evidence/protected-file hashes verified and ignore/diff checks passed. No SQL/package execution, grants, server/service changes or application-test replay occurred. No validation process owned the moved evidence; the user's Visual Studio/project work was left alone. B5a3/P0b remain open and hosting remains deferred.

## B5a3b2 / completed fixture and actual-reader validation

Completed 15 October 2026 after the user deployed the project and requested guide steps 7–10. Inspected/exported the actual catalog project: both entry-point packages, expected parameters, no connection managers, bounded C# delay and correct parent loop/parallel structure.

- Ran six history seeds with delays of two through seven seconds; controlled typed/sensitive values, special text, warning categories and Description override; the expected intentional failure; completed repeated/parallel children; and two bounded 60-second cases. All 12 fixture executions are terminal: 11 succeeded, one intentionally failed with the expected OnError. The long root/parent completed naturally in about 65 seconds.
- Added the four selected fixture READ grants, preserving existing grants and roles. For the optional scope test, deployed the identical exported .ispac to DashboardValidationOther, added normal-reader folder navigation READ and ran Probe once. No existing different project was overwritten; the primary deployment is unchanged. Primary/secondary/all-folder histories contain 8/1/9 rows.
- Both actual Windows reader accounts completed native SQL and 15 real HTTP requests each through the user-run secure helper. Correct login/database identities and non-admin roles were verified; only the normal reader has ssis_logreader. Hidden versus absent details/events/values return identical safe 404 bodies after request-ID normalization, one successful zero-row query and no follow-up work. Passwords were not saved.
- Across actual/impersonated reader, active and completion/scope probes: **84 HTTP requests, 628 passing assertions and nine passing independent native checks**. Verified native Int32/Boolean types and override flags, sensitive NULL/redaction, path-specific child pairing and maximum overlap of two, missing end events while active, six-row history averages, legacy estimate/status behavior and SQL parity.
- Updated the existing checklist/fixture guide; **25 cases now PASS**. OBS-02 retains unobserved native cleanup failure; OBS-03 and HOST-01/02/03 retain deferred production work. The additional raw datetimeoffset -155 limitation remains open for typed-data work. B5a3/P0b remain open; B5a3b2's fixture scope is complete.
- All six owned HTTP servers/threads stopped; final process/listener audit is clear and both SQL services remain running. No source SQL/application/template/dependency changes or new runtime dependencies; the earlier 101-test Windows evidence is retained without repeating it. Reusable helpers and all raw evidence are ignored under .local/backend-validation; the current run is selected by runs/fixture-current.private.json.
