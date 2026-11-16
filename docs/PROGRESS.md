# Implementation progress

Updated 16 November 2026. Development base: `dev-next`. [Roadmap](roadmap.md) owns scope and priorities; [the plan](MODERNIZATION_PLAN.md) owns architecture. This file owns current status, the work queue and open acceptance gates. Completed work is kept as short receipts. The full implementation journals are in Git: through 15 November 2026 at `6180174` (`git show 6180174:docs/PROGRESS.md`), through 25 October at `864ec53`, and before the 17 October consolidation at `36b48f8`.

## Current status

| Area | Status |
| --- | --- |
| Backend foundation and read-only API | Implemented locally: 14 Stage C GET operations plus the G02 server-label GET (15 total), 12 execution sorts, an exact package filter and opt-in active-run estimates. Stage C remains open for reader and representative-environment acceptance. |
| Native overview and execution workflows | P4.1a–P4.7c complete locally, with the later UX review batches. This does not approve legacy retirement or a homepage switch. |
| Reviews | Backend, frontend and UX reviews are accepted ([accepted reviews](#accepted-reviews)). Most findings of the two full-project reviews of `72e673a` are fixed and committed; the open ones are in [their disposition table](#full-project-reviews). |
| Legacy replacement | G01 independent exact/LIKE history, G02 operational labels and G05 prefix-safe legacy links are complete locally; the task 3 scoped integration review is accepted. [Scope and limits](FRONTEND_PARITY.md#task-3-scoped-integration-review-27-october-2026). |
| Live updates | The P5.1 local change detector is committed (7 November) with a native integration run; the [P5.2 decision record](MODERNIZATION_PLAN.md#production-live-updates) fixes the stream design. No stream is implemented; a loopback-only prototype under the hosting hold is the user's decision. |
| Environment and hosting | Unavailable-environment acceptance stays parked under the 18 October instruction; hosting and production streams stay deferred under the 15 October instruction. Local checks do not close these gates. |

**Verification at `6180174`, 15 November 2026:** the production build passes; 531 Node tests pass; Python discovery runs 498 tests, 473 pass and 25 opt-in native SQL tests are skipped; the native SQL suites (25 tests) pass against the local SSISDB. Authored JS+CSS is 318,692 of 327,680 bytes and packaged gzip-9 JS+CSS 54,437 of 65,536 ([roadmap budgets](roadmap.md#acceptance-budgets)). This is local evidence, not reader, latency or production acceptance.

## Next actions

- [ ] **24. Office feedback, 16 November.** The user tested `/app/` in the office environment. Confirmed there: sensitive parameter values are redacted; the native popovers open one at a time and their keyboard shortcuts work; Copy works through the Clipboard API; the pinned `pyodbc` 5.3.0 works with ODBC Driver 17. The browser and its version were not recorded. The requested changes are grouped in five batches, simplest first. Codex implements each batch and Claude reviews it in the browser.

  | Batch | Requested changes | Status |
  | --- | --- | --- |
  | A — text and small styling | Theme switch denser, without its visible label. Remove the creation-window text to the right of the Overview filters. Error messages in a monospace font. History tab execution cell reads `Failed · current`. A time cell's hover shows only the exact timestamp, not the displayed time again. Copy uses only the Clipboard API; the selection fallback goes. The refresh status no longer says "auto refresh on", only when auto refresh is off, and sits right-aligned next to Refresh | Implemented A1-A7: compact theme, window in the count tip, monospace errors, History separator, exact timestamp hovers, Clipboard-only Copy and compact right-aligned refresh status. The earliest-error excerpt in the detail header is monospace too. Build, Node 547/547, frontend/asset Python 22/22. Claude reviewed it in the browser against the local SSISDB at 1440 and 390 px: no control moves between refresh states, and the hover titles, tip window, separator and fonts are as specified. The in-app browser denies clipboard writes, so only the failure path of Copy was seen there. Complete |
  | B — layout | Narrower Created/Started/Ended columns, the Overview first. The Executables header sticks like the Overview list header. A page change scrolls the table back to its first row. Range presets in two columns. The Default window entry (`HOUR_SPAN`) leaves the Created list | Implemented B1-B6: content-width Overview/History times, sticky toolbars/headers for shared section tables, page-only first-row reveal, two-column Created presets, named server defaults and the phone Reset/tip row. Claude's review added no-wrap durations, because "1 min 05 s" wrapped in the narrowed Overview and History columns. Build, Node 570/570, frontend/asset Python 23/23 and size budgets pass. Browser review against the local SSISDB, dark theme only: at 1440 px, Overview Created is 145 px and Started 69 px, with 49 px rows; after Next from the bottom of a 560 px viewport, the first row of page 2 sits under the sticky header and focus stays on Next; detail tables keep a sticky toolbar and header; at 390 px the tip shares the Reset row. The light theme was not checked. Complete |
  | C — tab return | Returning to the tab refreshes only when a scheduled refresh is due, not on every switch; Refresh stays immediate | Implemented C1-C2: visible return keeps `lastCompleted + delayMs` until due, including backoff; active work finishes without an extra resync and manual Refresh stays immediate. Build, Node 583/583 (18 refresh-loop cases), frontend/asset Python 23/23 and `git diff --check` pass; versus `92ffc8e`, authored JS -241 B and packaged JS -97 B (gzip-9 -50 B); Claude reviewed it on the local SSISDB Overview with dispatched visibility events, which do not count as VIS acceptance: five quick hide/return switches made no request; hidden for 40 s past the due time, the page made none while hidden and exactly one on return. Real VIS-01/VIS-02 remain NOT RUN. Complete |
  | D — Parameters | Scopes told apart by row tint and types by coloured labels; raw values monospace; scopes grouped instead of mixed (server order or a filter, to be decided from the SQL) | Planned; a SQL change needs native tests |
  | E — Overview paging time | With a custom range of about 10 months, the next Overview page of 50 rows takes about 1 s in the office. Measure first (statement, reads, compilation), then change | Planned; needs measurement at volume |

The 4 November queue, the UX review batches inserted into it and the fixes for the two full-project reviews are complete locally; their receipts follow. Open items wait for the user:

- **Decisions:** a loopback-only P5.2 stream prototype; the shared paging helper (D1/Q1: R-06, R-13, R-14); one estimate SQL shape or four (D2, R-15); the authored-size budget before P5.2 (D6/Q3); stabilising the local SQL Server for measurements (D7, R-05); keeping the retained-document checkpoint code (Q2, see CACHE-01 below); Fetch Metadata tightening for API routes (Q7, N-11); keeping full-project reviews independent of memory notes (Q9); what a NULL executable result means (UX review D5, 5 November). The two review reports hold the options: `.local/reports/reviews/20261109-full-review-claude-opus-5-5/decisions.md` and `.local/reports/reviews/20261110-full-review-claude-fable-5-2/decisions.md`.
- **Held by the user:** N-10 (status line as a live region) until a screen reader is available. The `pyodbc` update (R-23) awaits the user's word: the office run of 16 November used the pinned 5.3.0 with ODBC Driver 17.
- **Needs the office environment:** the rest of R-08 (permission-denied login, offline or restoring database) and the volume and reader checks listed under [remaining acceptance](#remaining-acceptance).

- [x] **22. Documentation compaction: complete locally, 15 November.** User decision D3 option A, with R-21 and R-22. Documents 535 KB → 410 KB (Progress 95 → 40 KB, API acceptance 124 → 60 KB). The full text stays at `6180174`.

  | Step | Scope | Status |
  | --- | --- | --- |
  | D3.1 | Progress receipts and current status; plan, review-process, roadmap and index drift (R-21) | Complete locally; Codex accepted in round 3 |
  | D3.2 | [API acceptance](API_ACCEPTANCE.md) recorded results reduced to dated receipts with their decisions, key figures, limits and evidence paths | Complete locally; Codex accepted in round 2 |
  | D3.3 | Survey the other documents for journals and stale statements; compact or correct them | Complete locally; Codex accepted in round 4. Frontend acceptance, the backend checklist, installation, the contract and the fixture guide are procedures or references and stay, with stale statements corrected: Started/Ended columns, ranges for the 15 October local executions, the closed G01/G02/G05 gaps in installation, and the validation interpreter path. The parity inventory's three dated receipts were compacted; review history was removed from the plan's P5.1 and P5.2 headings |

### Completed, 4–15 November 2026

Dates are commit dates; validation counts are those at the time. Where a review is named, a read-only Codex review accepted the change before commit. Rounds and findings are in the journal at `6180174` for tasks 2–14, and in `.local/reports/reviews/20261115-codex-receipts/` for tasks 15–21.

- [x] **1. Budget and queue** — `6611cb0`, 4 November. Authored ceiling raised from 280 to 320 KiB; packaged gzip stays 64 KiB per page; one shared bundle, because a split probe did not justify splitting. [Budget rule](roadmap.md#acceptance-budgets).
- [x] **2. Recorded observations** — `e79082b`, `a5a84cd`, 4 November. O-1 timeline refresh shift fixed (at most 2 px); FE-4 lazy disclosure population not adopted, per-character text scans replaced (200-row maximum-text validation 5–9× faster); P4.5 focus move attributed to a pointer click on `main`. Node 434, Python 427/413/14 skipped. Evidence: `.local/reports/frontend/20261104-observations/`. Codex review.
- [x] **2a. UX review batch A** — `035343b`, 5 November. Styling and copy (O1, O2, O8, O9, G5, G6, D6); no SQL or API change. Node 438. Evidence: `.local/reports/frontend/20261105-ux-review/ux-review-20261105/`.
- [x] **2b. UX review batch B** — 5–7 November: B1 failure path `21006f6`, B2 History `afe1f63`, B3 overview `76493e6`, B4 shell and density `4edfefc`, each with Codex review; integration pass `7e8a26f` (packaged build, local SSISDB, 1440/853/390 px, both themes, request counts per screen). Not done: History Folder/Project pickers and a larger default row count (B2); an ISO preview beside the date inputs and proportional duration bars (B4). Node 476. Evidence: `.local/reports/frontend/20261105-ux-review/ux-batch-b1-01/` to `ux-batch-b-integration-01/`.
- [x] **3. P5.1 change detection** — `ecc5324`, integration run `55a1908`, 7 November; P5.2 decision record `aec4339`, 8 November. A bounded seed and poll and one owned in-process detector, disabled by default; four Codex rounds for P5.1, three for P5.2. Poll work is bounded by the window and the tracked lists, not the catalog ([SQL work](API_ACCEPTANCE.md#p51b-change-detection-sql-work-7-november-2026)); design and documented limits in [the plan](MODERNIZATION_PLAN.md#production-live-updates). Reader identity and representative volume NOT RUN. Evidence: `.local/reports/backend/20261107-p51-change-detection/`.
- [x] **4. UX review batch C** — 8 November: C1 package filter API `d4ffa47`, C2 overview package filter `963a752`, C3 detail estimate `9090b0c`, C4 running-row estimates `bf7c772`, each with Codex review; C5 integration pass `72e673a`, a local check without a separate review. Active-run estimates are opt-in (`API_ACTIVE_ESTIMATES_ENABLED`) with a per-process cache, by the user's choice after measurement. SQL work: [C1](API_ACCEPTANCE.md#c1-package-filter-sql-work-8-november-2026), [C3](API_ACCEPTANCE.md#c3-detail-estimate-sql-work-8-november-2026), [C4](API_ACCEPTANCE.md#c4-list-page-estimate-sql-work-8-november-2026). One live fixture run confirmed detail and list estimates through the API; their rendering during a run is NOT RUN. Python 481/457/24 skipped, native 24, Node 487. Evidence: `.local/reports/frontend/20261108-c5-integration/`. `9b16c7c` closed the queue.
- [x] **5. Field-test range adjustments** — `063e4fb`, 11 November, from office testing. `HOUR_SPAN` defaults to 24 hours; a Last 180 days preset appears only when `API_MAX_RANGE_HOURS` is at least 4320; the Hour timeline is disabled when the range has more hours than `API_MAX_TIMELINE_BUCKETS`. Node 489. A 180-day range on a large catalog is NOT RUN.
- [x] **6. Review batch G, browser reader tolerance** — `2c6fe68`, 11 November (N-01, N-02). The readers accept a row whose status changed during the read and names matched under the catalog collation. Node 490. A live race is NOT RUN. Codex review.
- [x] **7. Review batch A, backend correctness** — `f56df01`, 12 November (R-01, part of R-07). Elapsed time on later pages follows the request clock; a page that repeats an execution ID fails safely. Python 482/458/24 skipped. A running execution on a later page is NOT RUN. Codex review.
- [x] **8. Review batch B, skip link and fragments** — `3771a1c`, 14 November (R-02). The skip link and fragment-only history entries no longer reload a screen. Node 494. Codex review.
- [x] **9. Review batch C, configuration and error mapping** — `3edda46`, 14 November (R-09, part of R-08). Startup validates `CONNECTION_STRING` and `DEBUG`; a missing driver or catalog object maps to `database_configuration`, which the browser does not retry; readiness answers 503 outside SSISDB. Python 485/461/24 skipped, Node 498. A permission-denied login, an offline or restoring database and the rendered message against a misconfigured server are NOT RUN. Codex review.
- [x] **10. Review batch D, cleanups and detector hardening** — `c0d3dc0`, 14 November (R-12, R-16, R-17, N-05, N-06, N-12). Unused code removed; the detector reseeds and backs off on malformed poll rows; seed and poll bindings have one owner; the WSGI module has a test. Python 490/466/24 skipped, native change suite 7, Node 491. Codex review.
- [x] **11. Review batch H, narrower recompilation** — `a44ef35`, 14 November (N-03, R-04). Four of ten `OPTION (RECOMPILE)` hints removed from the execution-list SQL. [Record](API_ACCEPTANCE.md#batch-h-execution-list-recompile-narrowing-14-november-2026), re-measured in 19. Codex review.
- [x] **12. Reversed timings keep their rows** — `34bfe8e`, 14 November (R-03, decision D4 option A). A row whose end precedes its start gets a NULL duration and sort key and a warning log instead of failing the page. [Record](API_ACCEPTANCE.md#reversed-duration-sort-key-14-november-2026). Python 495/471/24 skipped, Node 493. A browser check of such a row is NOT RUN (none on the local catalog). Codex review.
- [x] **13. OpenAPI examples through the browser readers** — `2581a9c`, 14 November (R-10). The new test found that OpenAPI allowed zero to seven fractional digits in output timestamps; it now requires seven, as the contract and server do. Node 508. Native API responses were not validated against the tightened schema. Codex review.
- [x] **14. Document drift and ignore rules** — `7caf427`, 14 November (N-08, R-18). Five statements corrected; `.gitignore` replaced by a short project file with the same ignored set. Codex review. `a740f17` recorded both reviews below.
- [x] **15. Composition root and detail screen** — `b717d50`, 14 November (R-19, part of R-11). `app.js` holds the start logic and `detail-screen.js` the detail assembly; six tests. Node 514. Codex review.
- [x] **16. `tzdata` 2026.6** — `7672278`, 14 November (part of R-23). Only Cuba's offsets differ; one timeline test moved to a date valid in both versions. [Installation](installation.md#configure) names the server's and the browser's zone sources. A clean offline install from the wheelhouse was not repeated. Evidence: `.local/reports/backend/20261114-tzdata/`. Codex review.
- [x] **17. Overview screen wiring tests** — `4deacd5`, 15 November (part of R-11). Eight tests on the two DOM doubles combined; 22 of 22 mutants of `overview-screen.js` fail them. Node 522. Wiring evidence only: the double proves no browser focus or layout, the filter controls keep their own document object and events do not bubble. Codex review.
- [x] **18. Calculated-sort logging lookup** — `3648ad4`, 15 November (rest of R-07). Two system `LOGGING_LEVEL` rows give a deterministic key and a safe 500 instead of an arbitrary pick. [Record](API_ACCEPTANCE.md#calculated-sort-logging-lookup-14-november-2026). Python 498/473/25 skipped, native 25. Codex review.
- [x] **19. Batch H and reversed-duration figures re-measured** — `edde28b`, 15 November. The first measurement script counted some pyodbc message lists twice; with a corrected collector every conclusion held and the quoted page counts and compile times were replaced. The re-measurement also showed the two kept page-selection hints cost more on a small catalog than they saved. Codex review.
- [x] **20. Page-selection `RECOMPILE` removed** — `6fd1b6f`, 15 November, the user's decision. [Record](API_ACCEPTANCE.md#page-selection-recompile-removal-15-november-2026): on the 19-execution catalog all 30 sorted cases were 64–239 ms faster; some unfiltered pages over 20,000 temporary executions were up to 243 ms slower. If an office catalog shows that, restoring the ordinary page's hint is a one-line change. Codex review.
- [x] **21. History screen wiring tests** — `6180174`, 15 November (rest of R-11). Nine tests; 52 of 52 mutants of `history-screen.js` fail them, against 12 of 43 before. Node 531. Wiring evidence only, not browser focus or layout; not asserted: an immediate refresh on returning to a hidden tab, and `preventDefault` on form submit. Codex review.
- [x] **23. Native popovers** — `abf99fa`, 15 November. The five Overview pickers and the shared History Custom picker use native auto popovers, and info tips manual popovers; Baseline 2025 APIs without fallbacks; legacy pages unchanged. Node 534, frontend/asset Python 22. Evidence: `.local/reports/frontend/20261115-native-popovers/round-002/`. Claude review, accepted in round 2 (contract task `20261115-native-popovers`). Open advisory F003 (P3): after a lone timeline click, Done returns focus to `<body>` instead of the Status trigger. The office browser confirmed one open picker at a time and the keyboard shortcuts (16 November). Screen reader NOT RUN.

### Previous queue

Completed in priority order, 26 October to 3 November.

- [x] **1. C8.2c resource and concurrency acceptance** — `d350af8`, independently reviewed 26 October. [Results and limits](API_ACCEPTANCE.md#c82c-local-resource-results-26-october-2026); HTTP disconnect leaves SQL running until its timeout. This does not close Stage C or approve production capacity.
- [x] **2. Legacy-replacement gaps** — `131fece`, 27 October. G01, G02 and G05 below; [replay](FRONTEND_PARITY.md#g01g02g05-local-integration-26-october-2026).
- [x] **3. Scoped integration review** — `8b51ee2`, independently accepted 27 October. Evidence: `.local/reports/backend/20261027-task3-review/`.
- [x] **4. Standalone History waits for a scope** — `37eae94`, 3 November. Unscoped `/app/history` makes no history request until Load history.

### Legacy-replacement submilestones

On 26 October the user chose full preservation of wildcard history filtering; exact-only replacement is not an accepted workflow change.

| Step | Delivered | Status |
| --- | --- | --- |
| G01 — independent history | `/app/history` with explicit exact/LIKE scope, bounded ID pages and per-package estimates; legacy conversion without a proxy execution | Complete locally |
| G02 — operational labels | Version and authorized SQL server label with independent safe failure | Complete locally |
| G05 — legacy prefix | Prefix-safe legacy links and assets; strict separator-selector aliases decoded once | Complete locally |
| Integration | Parity, contracts and affected BM/WF replay at 1280/768/375 px | Complete locally; accepted under task 3. Evidence: `.local/reports/backend/20261026-legacy-gaps/` |

Sort spills, compilation and the unexplained 11.85-second History sample remain disclosed in [API validation](API_ACCEPTANCE.md#task-3-scoped-follow-up-27-october-2026); R-05 has a candidate cause (plan eviction on this workstation), not proven.

### Task 3 review submilestones

| Step | Scope | Status |
| --- | --- | --- |
| R3.1 — bind and review | Commits `d350af8` and `131fece` with their evidence | Complete |
| R3.2 — reproduce and resolve | Findings, advisories and broad-pattern SQL measurements without changing catalog data, permissions or caches | Complete locally; Retry/terminal focus and legacy-label compatibility fixed |
| R3.3 — verify and close | Regression, native and browser checks, independent re-review, cleanup | Accepted with no required changes. Evidence: `.local/reports/backend/20261027-task3-review/` |

### C8.2c submilestones

| Step | Scope | Status |
| --- | --- | --- |
| C8.2c.1 — define the run | Workload and failure matrix, limits, ownership counts, cleanup | [Run protocol](API_ACCEPTANCE.md#c82c-resource-and-concurrency-protocol) |
| C8.2c.2 — repeated and concurrent replay | Fake-driver, in-process and HTTP replay with ownership counts | Complete locally |
| C8.2c.3 — timeout and cancellation | Driver/server completion and logical cleanup after disconnect, cancel and timeout | Complete for the local administrator; reader and representative-load cases open |
| C8.2c.4 — integration and review | Results, regression and cleanup; scoped independent review | Accepted |

## Baseline and backend foundation

| ID | Status | Delivered scope / remaining condition |
| --- | --- | --- |
| P0a | Complete locally | Workflow/field inventory and local replacement replay; G01/G02/G05 implemented with accepted task 3 review. Environment/cutover gates remain separate. |
| P0b | Awaiting integration | Real SQL 2022 fixtures and legacy Windows-reader HTTP pass; native cleanup-failure observation remains open. |
| B1–B4 | Complete locally | App factory/config isolation, bound query ownership/timeouts, strict legacy inputs/safe errors and legacy query budgets of 6/7/4/5/2. |
| B5a1/B5a2 | Complete locally | Pinned dependencies and clean Windows x64 CPython 3.14.8 environment; native imports and offline installation checked. |
| B5a3a/B5a3b1/B5a3b2 | Complete locally | Native baseline, controlled SSIS fixture deployment and actual Windows-reader legacy replay. |
| B5a/B5a3/B5a3b | Awaiting integration | OBS-02 native cleanup-failure assertion remains `NOT RUN`; successful cleanup and synthetic failures do not close it. |
| B5b/B5b1 | Complete locally | Correlated safe timing/error events, cleanup observation and explicit local exception propagation. |
| B5c | Deferred | Hosting/service/container, production identity/proxy/transport/logs and stream capacity. |

[Backend checklist](BACKEND_CHECKLIST.md): 25/30 full PASS. OBS-02 is partly unobserved; OBS-03's host portion and HOST-01/02/03 remain deferred. These are separate from Stage C acceptance.

## Stage C / read-only API (delivery phase 2)

| ID | Status | Delivered scope |
| --- | --- | --- |
| C1a | Complete locally | Contract, OpenAPI, policy and contract tests. |
| C1b | Complete locally | Native-verified exact datetimeoffset/100-ns timestamps, BIGINT strings and typed serialization. |
| C1c | Complete locally | Shared input/errors/capabilities, metadata and bounded health checks. |
| C2a | Complete locally | Creation-cohort execution pages with authenticated cursors and an upper-ID fence. |
| C2b | Complete locally | All 12 global sorts; ordinary pages selected before enrichment. |
| C3a | Complete locally | Visible folder/project navigation with exact names and IDs. |
| C3b | Complete locally | All-status summary over the selected creation cohort. |
| C3c | Complete locally | Selected-status timeline with IANA/DST buckets and zero filling. |
| C4a | Complete locally | Visible execution metadata and isolated conditional event counts. |
| C4b | Complete locally | Paged executable observations and separate result vocabulary. |
| C4c | Complete locally | Paged child starts, conservative pairing and unknown unidentified-start coverage. |
| C5 | Complete locally | Paged event categories, literal full-source search and bounded returned text. |
| C6 | Complete locally | Independent parameter/override pages and SQL/serializer redaction. |
| C7a | Complete locally | Exact-package history, status scope and bounded ID pages. |
| C7b | Complete locally | Separate estimates from up to five eligible prior visible successes. |
| C8 | In progress | Combined correctness passes; resource, reader and environment gates remain below. |

### Remaining acceptance

| ID / condition | Status | Evidence or next action |
| --- | --- | --- |
| C8.1 | Complete locally | Combined 14-operation contract/native replay under administrator and two impersonated SQL readers. This is not C8.3 sign-in/HTTP evidence. |
| C8.2a | Complete locally | Explicit SQL NULL binding removes measured type-discovery overhead, with typed result/plan comparisons. |
| C8.2b.1 | Complete locally | [Current-catalog baseline](API_ACCEPTANCE.md#c82b1-retained-baseline): 20 cases × 100 WSGI samples, 70 fresh-client requests and 25 SQL diagnostics. |
| C8.2b.2a | Complete locally | [Execution cardinality](API_ACCEPTANCE.md#c82b2a-retained-execution-cardinality-results): 20,000 matches, full/deep/NULL pages, all sorts/directions and existing-reader SQL IO. |
| C8.2b.2b / .2b.R1 | Complete locally; independently accepted 24 October | [Observation/text results](API_ACCEPTANCE.md#c82b2b-observation-and-text-results) and [child pairing](API_ACCEPTANCE.md#c82b2br1-child-pairing-results). Pairing source work stays bounded from 2,000 to 50,000 repeated starts; missing-end scans and heap-fixture candidate selection remain documented limits. |
| C8.2b.2c | Complete locally; independently accepted 24 October | [Summary/timeline/history results](API_ACCEPTANCE.md#c82b2c-aggregate-and-history-results): exact oracles at 2,000/20,000/100,000 executions; bounded prior-success materialization. |
| C8.2b.3 | Complete locally | [Query remedies](API_ACCEPTANCE.md#c82b3-execution-query-remedies): narrow calculated cohorts, cached ID selection/logging and measured event join order; small-catalog tradeoffs retained. |
| C8.2c | Complete locally; independently reviewed 26 October | [Resource/concurrency submilestones](#c82c-submilestones) and [26 October results](API_ACCEPTANCE.md#c82c-local-resource-results-26-october-2026). Four-client acceptance does not establish representative sustained capacity. |
| C8.3 | Planned; required identity/session unavailable | Actual Windows-reader API sign-in/HTTP, hidden/absent equivalence and network timings. Legacy reader replay or administrator impersonation does not substitute. |
| November SQL changes at volume | NOT RUN | 100,000 executions (judged beyond expected use by the user, 14 November) and an office catalog for batch H, the reversed-duration key, the logging lookup and the page-selection hints; also plan reuse across pooled connections over time. |
| OBS-02 | Partly unobserved | Native cleanup-failure observation; use the existing controlled procedure when the condition exists. |
| Reader SHOWPLAN | NOT RUN | Required existing permission is unavailable. Do not grant permissions merely to pass a check. |
| Real active / Scale Out | Incomplete | Observe representative live state/recording behavior; synthetic active responses and local static catalogs do not close this. |
| Transfer/render/network budgets | Open | The 50-row test-network p95 target is not passed. Keep SQL, WSGI, loopback/browser and network measurements distinct. |
| Hosting/streams | Deferred | Existing B5c/HOST gates; no deployment or production stream acceptance. |

The C8.2b.2 parent is complete locally; it does not close the remaining rows. Retain the measured extreme event response of 43,238,902 bytes at 200 rows and the roughly 0.7 s SQL cost of a 1,000-hour timeline over 100,000 executions. Row limits and improved query plans do not establish transfer/render or sustained-resource capacity.

### Review of Stage C — 17 October 2026

The reviewed SQL remedies preserve results and reduce measured work. [API validation](API_ACCEPTANCE.md#sql-remedies-replay-17-october-2026) owns plans, distributions, tradeoffs and selected evidence; the later cardinality/pairing/history records supersede their earlier pending status. No synthetic or impersonated-reader result establishes independent-reader HTTP or production acceptance.

## Phase 3 / first native screen preparation

| Task | Local result |
| --- | --- |
| D1a | Vite source/locked build and prefix-safe packaged assets; deployment requires prebuilt ignored output. |
| D1b | Database-free Flask shell with safe missing/invalid-build behavior. |
| D2a | Same-origin validated API client and metadata bootstrap/teardown. |
| D2b | Exact selection, URL restore, drafts and bounded catalog navigation. |
| D2c | Typed execution list and same-window all-status summary. |
| D2d | Global server order, bounded cursor pages and retained in-memory page paths. |
| D3a | Coalesced in-place manual refresh, safe stale-data handling and preserved view state. |
| D3b | One polling owner, backoff/pause/visibility rules and disposal; controlled lifecycle checks pass. |
| D3c.1 | Available in-app browser workflow, keyboard and responsive checks pass. |
| D3c.2/.3 / parent D3 | Open pending the actual browser conditions below. |

Original design and filter results: `.local/reports/frontend/20261018-stage-d-review/` and `20261022-filter-ux/`.

### Remaining browser acceptance

Unavailable-environment checks remain parked under the 18 October instruction. [Frontend acceptance](FRONTEND_ACCEPTANCE.md) owns the procedures; this table owns status.

| Check | Status | Required evidence |
| --- | --- | --- |
| Actual hidden-tab return | Deferred — NOT RUN | VIS-01–03: real hidden/visible events, no new hidden cycle, one resync, preserved pause/denial and no duplicate timer. Dispatched visibility events do not count. |
| Cached-document return | Deferred — NOT RUN | CACHE-01–02: prove a retained document returned, then observe metadata/page revalidation, pause/view restoration and one expired-cursor reset. Ordinary Back is insufficient. The shells are served `no-store`, and the in-app browser rebuilt the page on Back (Q2). |
| Corporate/cross-browser | Deferred — NOT RUN | BROWSER-01 in actual corporate Edge/Chrome; include Firefox/Safari when used, with keyboard/layout/failure/lifecycle evidence. Copy has no selection fallback since batch A of Next action 24. The user reported on 16 November that the office browser runs the native popovers and the Clipboard API path of Copy; browser, version and the other checks were not recorded. |
| Accessibility and zoom | NOT RUN | Real 150% system zoom, Windows high contrast, screen readers (also needed for N-10) and reduced motion. |
| A running execution in the browser | NOT RUN | The current-page change highlight (O10), live estimate rendering, a status change during a read (N-01) and elapsed time on a later page (R-01). The local fixture runs end within seconds. |
| Native calendar popup | NOT RUN | Date/time field entry and timezone conversion are observed; native popup interaction still needs its own browser check. |
| Complete enabled-resource/reader matrix | Incomplete | Accepted local SSISDB spot checks do not complete enabled event/value cases, real policy/visibility changes or the independent-reader matrix. On 16 November the office catalog showed sensitive parameter values redacted (user's report, identity not recorded). |

## Phase 4 / native execution workflows

P4.1a–P4.7c are complete locally. Current behavior belongs in [the plan](MODERNIZATION_PLAN.md#native-execution-detail-and-section-ownership), [usage](installation.md#run-locally), [API semantics](API_CONTRACT.md) and the [parity inventory](FRONTEND_PARITY.md); the dated receipts below keep evidence provenance. Later accepted UX changes supersede earlier presentation.

### P4.1a / native execution detail foundation — 18 October 2026

Validated ID/metadata/base-detail shell, explicit empty/denied/failure states and legacy access. Evidence: `.local/reports/frontend/20261018-p4-1a/`.

### P4.1b / detail refresh and overview return — 18 October 2026

Shared refresh ownership, ID replacement, late-result rejection and retained return. Evidence: `.local/reports/frontend/20261018-p4-1b/`. Actual hidden/cache behavior remains in the browser gate table.

### P4.1c / overview-to-native-detail integration — 18 October 2026

Overview links, native detail and validated page-one return at root and prefix. Evidence: `.local/reports/frontend/20261018-p4-1c/`. Simulated retention does not establish cached-document acceptance.

### P4.2a / executable observations — 22 October 2026

Lazy, independently paged executable observations with separate invocation, result and timing semantics. Evidence: `.local/reports/frontend/20261022-p4-2a/`; workload evidence belongs to C8.2b.2b.

### P4.2b / child observations — 23 October 2026

Lazy child observations with exact identity, independent paging, conservative recording state and unknown coverage. Evidence: `.local/reports/frontend/20261023-p4-2b/` and `20261024-package-calls/`. The original package-call native replay was unavailable (`503 / SQLSTATE 08001`).

### P4.3 — searchable events — 24 October 2026

Category and literal search, independent paging, truncation/coverage and shared cancellation. Evidence: `.local/reports/frontend/20261024-p4-3/`. The full enabled/reader/environment matrix remains open.

### P4.4a — parameters — 24 October 2026

Lazy parameters with type, flag, value, sensitive, policy, NULL and empty distinctions. Evidence: `.local/reports/frontend/20261024-p4-4a/`; real policy/reader coverage remains separate.

### P4.4b — property overrides — 24 October 2026

Independent override pages with exact paths, sensitivity, policy clearing and cursor resets. Evidence: `.local/reports/frontend/20261024-p4-4b/`; the real policy/reader matrix remains open.

### P4.5 — package history — 24 October 2026

Exact authorized package history, independent status/ID pages, actual versus estimated timing and execution navigation. Evidence: `.local/reports/frontend/20261024-p4-5/`. The unattributed focus move was later attributed to a pointer click inside `main` ([follow-up observations](#follow-up-observations)).

### P4.6a — overview timeline — 24 October 2026

Lazy creation-cohort timeline with calendar/DST, zero/maximum, keyboard and error/race checks. The 1,000-bucket fixture response is 163,264 bytes; 361 ms to idle locally is not render time or network p95. Evidence: `.local/reports/frontend/20261024-p4-6a/`.

### P4.6b — history visualization — 24 October 2026

Loaded-page actual/estimate charts add no requests or timers; all 200 loaded rows stay keyboard-selectable. Evidence: `.local/reports/frontend/20261024-p4-6b/`.

### P4.7 submilestones

#### P4.7a — workflow and bookmark inventory — 25 October 2026

`fb684ea`: eight legacy route families, fields, actions, intentional differences and BM/WF cases in [the inventory](FRONTEND_PARITY.md). It establishes the inventory, not runtime parity.

#### P4.7b — supported bookmark mapping — 25 October 2026

`1f32f4f`: bounded opt-in conversion, explicit unsupported choices and prefix-safe destinations. Evidence: `.local/reports/frontend/20261025-p47b/`; [mapping rules](FRONTEND_PARITY.md#p47b-translation-contract) are authoritative.

#### P4.7c — local workflow integration — 25 October 2026

`ef133e3`: SQL-blocked packaged WF-01–07 and bookmark round trips, request budgets, 21 page/viewport combinations and keyboard checks. P0a closes with G03 fixed and G01/G02/G05 retained. Evidence: `.local/reports/frontend/20261025-p47c/`; [local replay](FRONTEND_PARITY.md#p47c-local-integration). This is not native reader/workload or cutover acceptance.

## Accepted reviews

Acceptance applies to the named candidate and scope, not to every environment gate.

### Backend review fixes

The 20 October patch (`f7a9cb7`) addressed Host validation, guarded API logging conversion, cursor secrets and HTTP-status classification. The 23 October follow-up was accepted in round 003 on `5c6b024`.

| Follow-up batch | Commit | Accepted result |
| --- | --- | --- |
| 1 | `91dce8a` | Legacy system-only guarded logging conversion and safe unknown levels; zero-safe running-history estimates. |
| 2 | `58311d2` | Fetch Metadata isolation/response headers and loopback compose publication. |
| 3 | `5c6b024` | Listed-first event/logging reads, one created-date aggregation and removal of the external font stylesheet. |

Evidence: `.local/reports/backend/20261023-review-fixes-r001/` to `r003/`. Large real catalogs with reader joins, sustained concurrency, other browser engines and Docker/hosting remain outside that acceptance.

### Frontend reviews and UX

| Task / batch | Final status / commit | Accepted scope |
| --- | --- | --- |
| UX A | Round 002 accepted; `22036ab` | Display-zone formats, durations and concise copy. |
| UX B | Round 003 accepted; `e5f31d3` | Rolling presets, applied filters, linked summaries and server-sort controls. |
| UX C | Round 002 accepted; `986a0fb` | One active detail tab and failure-triage links. |
| UX D | Round 001 accepted; `ee9c7d2` | Stable detail tables, disclosures and compact Events. |
| UX E | Round 001 accepted; `1a1d4f9` | All-known-status history and readable history/timeline charts. |
| UX F1 | Round 001 accepted; `b7148e8` | Refresh/reload geometry and initial reservation; G supersedes feedback-slot presentation. |
| UX F2 | Round 002 accepted; `f972455` | Soft grey light/dark/System themes, pre-paint preference, wide layout and picker keys. Codex audited candidate-bound native evidence; reviewer native replay was not run. |
| UX G | Round 002 accepted; `2e43815` | Layout density, stable gutter, accessible tips and compact status. |
| UX H | Round 002 accepted; `0b3af7f` | Remount options, Retry, one-line timing cells and narrow-screen details. |
| Frontend security/performance batch 1 | Round 001 accepted; `65a43ef` | Strict native CSP, bounded max-limit catalog search and immutable hashed assets. Native CSP/theme/chart checks pass. |
| Frontend security/performance batch 2 | Round 001 accepted; `029201e` | Stop ended-execution polling; preserve manual/section actions; enforce measured size budgets. Native ended execution produced zero automatic reads over 95 s. Running/visibility simulation does not establish genuinely running or actual hidden-tab acceptance. |
| FE-6 section-table refactor | Round 002 accepted; `864ec53` | Shared table lifetime and generic section actions; normal formatting/140-character guard. 413 Node tests, build, 26 focused Python checks and scoped local SSISDB overview/detail evidence pass. |
| Task 3 frontend/API/SQL integration | Accepted 27 October; `d350af8`/`131fece` plus follow-up | History/cursor/estimates, label lifetime/compatibility, prefix/aliases and resource evidence; two reproduced focus issues resolved. Read-only reviewer ran 38 Node/54 Python checks and audited retained local native/browser evidence; reviewer live replay was not run. Receipt: `.local/reports/backend/20261027-task3-review/`. |
| UX review of 5 November, batches B1–B4 and C1–C4 | Codex accepted per batch; `21006f6` to `bf7c772` | See Next actions 2b and 4. Batch A and the B and C integration passes have no separate review receipt. |

Private receipts for the October rounds live in the sibling `collab-contract/runs/` checkout (`rounds/<round>/`); they are not installation prerequisites. Detailed refactor receipts: `.local/reports/frontend/20261025-fe-review/`.

### Follow-up observations

| Observation | Disposition |
| --- | --- |
| FE-4: full hidden event/value/path text is populated in closed disclosures | Measured 4 November: within noise, so no lazy population; per-character text scans replaced (5–9× faster isolated validation and preview). |
| Batch 2 R1-F001: focused Pause/Resume becomes natively disabled at execution end | Closed by task 3: Refresh takes the focus. Actual cached-document/live-execution acceptance remains separate. |
| Refactor O-1: timeline status shifts by about 254 px on refresh | Fixed 4 November for rolling-preset refreshes (at most 2 px); the exact 254 px case did not reproduce. |
| P4.5 focus observation | A pointer click inside the `tabindex="-1"` `main` region; app paths keep focus. No change. |

### Full-project reviews

Layered reviews under [the review process](PROJECT_REVIEW.md), both of `72e673a`; nothing changed in the repository between them. Neither found a P1 or P2.

| Date | Model | P3 | P4 | Tags | Refuted | Report |
| --- | --- | ---: | ---: | --- | --- | --- |
| 9 November 2026 | Claude Opus 5.5 | 6 | 18 | 20 NEW, 2 KNOWN, 1 REGRESSION, 1 PREVIOUSLY-DECLINED | 2 of 33 suspicions | `.local/reports/reviews/20261109-full-review-claude-opus-5-5/` |
| 10 November 2026 | Claude Fable 5.2 | 4 | 8 | 10 NEW, 2 KNOWN | 8 of 53 observations | `.local/reports/reviews/20261110-full-review-claude-fable-5-2/` |

The second review missed 12 of the first review's 24 findings and added 10 of its own, two of them P3 behaviour bugs at the API/browser boundary. Four of its items had been seen in a memory note opened before the process was read; they are counted as KNOWN.

Disposition as of 16 November (R = 9 November, N = 10 November). Each fix was reviewed by Codex before commit; see Next actions 6 to 22.

| Findings | Disposition |
| --- | --- |
| N-01, N-02 | Fixed, `2c6fe68` |
| R-01 | Fixed, `f56df01` |
| R-07 | Fixed, `f56df01` (a repeated execution ID fails safely) and `3648ad4` (the calculated-sort logging lookup) |
| R-02 | Fixed, `3771a1c` |
| R-09 | Fixed, `3edda46` |
| R-08 | Partly fixed, `3edda46`: a missing driver or object (IM002, IM003, 42S02) is a configuration error. Open: permission errors are not distinguished (42000 is still retried), and a permission-denied login was not run |
| R-12, R-16, R-17, N-05, N-06, N-12 | Fixed, `c0d3dc0` |
| R-04, N-03 | Fixed, `a44ef35` (four hints) and `6fd1b6f` (the two page-selection hints, the user's decision): the six hints the review proposed are removed; the four event-aggregation hints remain |
| R-03, N-04 | Fixed, `34bfe8e` (decision D4, option A) |
| R-10 | Fixed, `2581a9c`; it also tightened the OpenAPI output timestamp to seven fractional digits |
| R-18, N-08 | Fixed, `7caf427` |
| R-19 | Fixed, `b717d50` |
| R-11 | Fixed, `b717d50`, `4deacd5` and `6180174` (composition root and detail, overview and History screens) |
| R-23 | Partly fixed, `7672278`: `tzdata` 2026.6 and the two time-zone sources documented. Open: the `pyodbc` update, awaiting the user's word; the pinned 5.3.0 works in the office with ODBC Driver 17 (16 November) |
| R-21, R-22 | Fixed with Next action 22 (decision D3, option A, 15 November) |
| N-10 | Deferred on the user's instruction: the fix needs a screen reader to verify |
| R-06, R-13 | Open: shared paging helper and the estimate import cycle, await the user's decision (D1) |
| R-14 | Open: with the paging helper (D1) or at cutover |
| R-15 | Open: four estimate SQL implementations (D2); the review recommends keeping them for now |
| N-11 | Open: Fetch Metadata tightening for API routes (Q7) |
| R-05 | Open: plan eviction on the local instance, an environment question first (D7) |
| R-20, N-07, N-09 | No dedicated task: fold into the next change of the affected tests or stylesheet |
| R-24 | Previously declined (5 November UX review O8); no action |

## Evidence and documentation maintenance

Documentation was consolidated on 25 October (journals replaced by status and evidence summaries) and again on 15 November (Next action 22): completed tasks became receipts. Full earlier text is in Git: `6180174:docs/PROGRESS.md` holds every journal through 15 November 2026, with the review rounds of tasks 2–14 (those of 15–21 are in `.local/reports/reviews/20261115-codex-receipts/`); `864ec53` holds the record through 25 October; `36b48f8` holds the logs from before the 17 October consolidation. Private evidence stays in the ignored reports and sibling review records; none was moved or deleted.

While a task is open its entry may hold submilestones and open checks. When it completes, reduce it to a receipt: commit, outcome in one or two sentences, final validation counts, evidence path, the review, and anything still NOT RUN that no gate table holds. Measurements belong in [API](API_ACCEPTANCE.md) or [frontend](FRONTEND_ACCEPTANCE.md) acceptance and behaviour in the contract, plan or installation guide; link them instead of copying. Record candidate/commit, native versus synthetic conditions, measurement limits and resource cleanup. `Complete locally`, `Accepted`, `Deferred` and `NOT RUN` stay distinct; a written procedure or simulated environment is not a pass.
