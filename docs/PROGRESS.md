# Implementation progress

Updated 27 October 2026. Development base: `dev-next`; task 3 review base: `131fece`, including task 1 at `d350af8`. [Roadmap](roadmap.md) owns scope and priorities; [the plan](MODERNIZATION_PLAN.md) owns architecture. This file owns current status, the work queue and open acceptance gates.

## Current status

| Area | Status |
| --- | --- |
| Backend foundation and read-only API | Implemented locally: 14 Stage C GET operations plus the separate G02 server-label GET (15 total), and 12 execution sorts. Stage C remains open for reader and representative-environment acceptance. |
| Native overview and execution workflows | P4.1a–P4.7c complete locally, including sections, charts, supported bookmark mapping and packaged workflow replay. This does not approve legacy retirement or a homepage switch. |
| Security/performance review | Backend fixes, frontend batches 1/2 and the section-table refactor have passed independent review and are committed. See [accepted reviews](#accepted-reviews). |
| UX and themes | Batches A–H, including F2 light/dark/System themes, are accepted. Earlier “review pending” statements are superseded by the receipt table below. |
| Legacy replacement | G01 independent exact/LIKE history, G02 operational labels and G05 prefix-safe legacy links/selector aliases are complete locally; task 3 scoped integration review is accepted. [Scope and limits](FRONTEND_PARITY.md#task-3-scoped-integration-review-27-october-2026). |
| Environment and hosting | Unavailable-environment acceptance remains parked under the 18 October instruction. Hosting/production streams remain deferred under the 15 October instruction. Local checks do not close these gates. |

**Verification completed 27 October, task 3 candidate over `131fece`:** 430 Node tests pass; Python discovery runs 427 tests, with 413 passing and 14 opt-in native SQL tests skipped. Task 2's three native history/oracle passes remain separately preserved. The production build, corrected packaged-browser keyboard replay and local native legacy/server-label comparison pass. Authored JS+CSS is 286,678 bytes (42 below the enforced ceiling); packaged JS+CSS is 164,065 bytes, 49,600 gzip-9 bytes. [Roadmap budgets](roadmap.md#acceptance-budgets) own the ceilings. [SQL follow-up](API_ACCEPTANCE.md#task-3-scoped-follow-up-27-october-2026) retains sort spills; 30 descending samples did not repeat the original 11.85-second outlier, whose cause remains unresolved. This is not stable latency or reader acceptance. Task 1's [C8.2c receipt](API_ACCEPTANCE.md#c82c-local-resource-results-26-october-2026) remains separate.

## Next actions

The following three tasks were completed in priority order, one at a time. C8.2c and the scoped task 3 integration review are independently accepted; all three are complete locally. Parked work and unavailable-environment acceptance retain their existing holds.

- [x] **1. C8.2c — resource and concurrency acceptance: complete locally, independently reviewed 26 October.** Local repeated/concurrent, failure/retry, rapid replacement, maximum-text and actual driver timeout/cancellation/disconnect checks pass. Logical owners return to zero and task-owned servers/processes/tabs have exited. See [results and limits](API_ACCEPTANCE.md#c82c-local-resource-results-26-october-2026). Missing reader/representative-environment cases retain `NOT RUN`; HTTP disconnect was observed to leave SQL running until its timeout. This does not close Stage C or approve production capacity.
- [x] **2. Resolve the recorded legacy-replacement gaps: complete locally, 27 October.** G01 preserves full wildcard history through a standalone entry/bookmarks, with exact mode, bounded pages and per-package estimates; G02 restores version/server labels independently; G05 fixes authored legacy prefix links/assets and adds strict separator-selector aliases with single decoding. [Affected BM/WF replay](FRONTEND_PARITY.md#g01g02g05-local-integration-26-october-2026), regression, native SQL, growth diagnostics and cleanup are recorded. The scoped independent integration review is accepted under task 3.
- [x] **3. Review new changes and their integration boundaries: complete locally, independently accepted 27 October.** A read-only reviewer audited commits `d350af8`/`131fece`, all 402 preserved task 2 artifacts and the source-bound fixes. Standalone History Retry now restores visible focus; terminal Pause hands focus to Refresh; server labels preserve legacy naming. Matching regression, native label/SQL and packaged-browser evidence pass. Evidence: `.local/reports/backend/20261027-task3-review/`. Reader, actual lifecycle, corporate-browser, representative-workload and hosting checks keep their existing holds.

### Legacy-replacement submilestones

Task 2 proceeds through these bounded changes. On 26 October the user explicitly selected full preservation of wildcard history filtering; exact-only replacement is not an accepted workflow change.

| Step | Deliverable / exit evidence | Status |
| --- | --- | --- |
| G01 — independent history | Database-free `/app/history`; explicit exact/LIKE scope, bounded global ID pages and per-package estimates; legacy conversion without a proxy execution, preserving legacy 2/7 semantics. | Complete locally: scope/return/race/failure tests, native exact/mixed-package oracle, 2k/20k/100k page/fence plans and WSGI size checks; packaged navigation/page/refresh/recovery/return pass. |
| G02 — operational labels | Version and authorized SQL server label with explicit API/security scope; independent safe failure, no identity/connection secrets in metadata. | Complete locally: native/legacy label comparison, current operation schema/shared boundaries and synthetic failure/deadline/disposal checks. |
| G05 — legacy prefix | Prefix-safe legacy links/assets and explicit handling of path-separator selector names. | Complete locally: strict query aliases retain literal selectors/LIKE/status behavior, decode once, and preserve root/prefix navigation and unsupported fallback. |
| Integration | Reconcile parity/usage/contracts/status and affected BM/WF evidence. Keep homepage/legacy coverage and parked gates explicit. | Complete locally: build/regression/docs and 1280/768/375 px replay; shared-header overflow fixed. Evidence and source hashes: `.local/reports/backend/20261026-legacy-gaps/`. Scoped review accepted under task 3; original evidence is unchanged. |

Task 3 independently accepted G01's SQL/frontend/cursor boundaries, G02 identity-label scope and independent lifetime, and G05 single-decoding/alias compatibility. The measured reduction in repeated SQL reads is retained; sort spills, compilation and the unexplained slow sample remain disclosed in [API validation](API_ACCEPTANCE.md#task-3-scoped-follow-up-27-october-2026). Reader SHOWPLAN/HTTP, representative catalog/workload, actual hidden/cache/corporate-browser and hosting checks retain their existing holds.

### Task 3 review submilestones

| Step | Scope / concrete exit | Status |
| --- | --- | --- |
| R3.1 — bind and review | Review commits `d350af8` and `131fece`, their preserved evidence and changed frontend/API/SQL boundaries. Reopen accepted earlier work only for a reproduced regression or changed assumption. | Complete: user-authorized read-only reviewer verified commit/tree/source binding and all 402 task 2 artifact hashes; 38 focused Node and 54 Python tests pass independently. |
| R3.2 — reproduce and resolve | Reproduce actionable findings and relevant advisories; measure broad-pattern SQL spills/compilation/outlier without changing catalog data, permissions or caches. Fix concrete regressions and keep deferred environment gates explicit. | Complete locally: Retry/terminal focus and legacy-label compatibility fixed. Unchanged history SQL replayed over 100k connection-local rows; spill/outlier limitations retained. |
| R3.3 — verify and close | Matching regression/native/browser checks for actual fixes, independent re-review, durable findings/dispositions and verified resource cleanup. | Complete locally; independent verdict ACCEPTED with no required changes. Final regression/build/native-label/browser receipts and exact source/test hashes are retained in `.local/reports/backend/20261027-task3-review/`. All three preview servers exited, port released, tabs absent and markers cleared. |

### C8.2c submilestones

| Step | Deliverable / exit evidence | Status |
| --- | --- | --- |
| C8.2c.1 — define the run | Bounded workload/failure matrix, explicit concurrency and timeout limits, expected ownership counts, baseline observations and cleanup procedure. Reuse the existing environment and ignored helpers. | Complete locally: [run protocol](API_ACCEPTANCE.md#c82c-resource-and-concurrency-protocol). |
| C8.2c.2 — local repeated/concurrent replay | Success/failure/retry and execution/section replacement with independent request IDs and no cross-request state. Record active/high-water/final ownership counts and payloads; separate fake-driver, in-process and HTTP results. | Complete locally: fake-driver 48 requests; native 200 WSGI + 200 HTTP workload responses; frontend owners and packaged browser replay. |
| C8.2c.3 — native timeout/cancellation | Observe driver/server completion and logical cleanup after disconnect/cancel/timeout. Distinguish pooled physical sessions from leaked logical owners. Record missing permissions or unavailable conditions explicitly. | Complete for the configured local administrator: real timeout/recovery, explicit driver `HY008`, server WAITFOR removal and disconnect-to-timeout cleanup. Reader/representative-load cases remain open. |
| C8.2c.4 — integration and review | Reconcile results, necessary fixes, regression evidence and process cleanup; obtain a scoped independent review. Leave C8.3/OBS-02/network/hosting gates separate. | Complete locally; scoped independent review accepted. Three P3 evidence/wording clarifications are resolved with additive provenance; no application/SQL fix was required. |

## Baseline and backend foundation

| ID | Status | Delivered scope / remaining condition |
| --- | --- | --- |
| P0a | Complete locally | Workflow/field inventory and local replacement replay; G01/G02/G05 have local implementations/evidence and accepted task 3 scoped review. Environment/cutover gates remain separate. |
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
| C8.2b.2b / .2b.R1 | Complete locally; independently accepted 24 October | [Observation/text results](API_ACCEPTANCE.md#c82b2b-observation-and-text-results) and [child pairing](API_ACCEPTANCE.md#c82b2br1-child-pairing-results). Pairing source work remains bounded from 2,000 to 50,000 repeated starts; missing-end scans and heap-fixture candidate-selection work remain documented limits. |
| C8.2b.2c | Complete locally; independently accepted 24 October | [Summary/timeline/history results](API_ACCEPTANCE.md#c82b2c-aggregate-and-history-results): exact oracles at 2,000/20,000/100,000 executions; bounded prior-success materialization. |
| C8.2b.3 | Complete locally | [Query remedies](API_ACCEPTANCE.md#c82b3-execution-query-remedies): narrow calculated cohorts, cached ID selection/logging and measured event join order; retained small-catalog tradeoffs. |
| C8.2c | Complete locally; independently reviewed 26 October | [Resource/concurrency submilestones](#c82c-submilestones) and [26 October results](API_ACCEPTANCE.md#c82c-local-resource-results-26-october-2026). Four-client acceptance does not establish representative sustained capacity. |
| C8.3 | Planned; required identity/session unavailable | Actual Windows-reader API sign-in/HTTP, hidden/absent equivalence and network timings. Legacy reader replay or administrator impersonation does not substitute. |
| OBS-02 | Partly unobserved | Native cleanup-failure observation; use the existing controlled procedure when the condition exists. |
| Reader SHOWPLAN | NOT RUN | Required existing permission is unavailable. Do not grant permissions merely to pass a check. |
| Real active / Scale Out | Incomplete | Observe representative live state/recording behavior; synthetic active responses and local static catalogs do not close this. |
| Transfer/render/network budgets | Open | The 50-row test-network p95 target is not passed. Keep SQL, WSGI, loopback/browser and network measurements distinct. |
| Hosting/streams | Deferred | Existing B5c/HOST gates; no deployment or production stream acceptance. |

The C8.2b.2 parent is complete locally; it does not close the remaining rows. Retain the measured extreme event response of 43,238,902 bytes at 200 rows and the roughly 0.7 s SQL cost of a 1,000-hour timeline over 100,000 executions. Row limits and improved query plans do not establish transfer/render or sustained-resource capacity.

### Review of Stage C — 17 October 2026

The reviewed SQL remedies preserve results and reduce measured work. [API validation](API_ACCEPTANCE.md#sql-remedies-replay-17-october-2026) owns plans, distributions, tradeoffs and selected evidence; the follow-up cardinality/pairing/history records above supersede their earlier pending status. No synthetic or impersonated-reader result establishes independent-reader HTTP or production acceptance.

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

D-REV-01/02 fixed pagination focus during refresh and exact catalog-name preservation; `1a79c7d` and the `3c41da7` design baseline preceded the accepted UX updates. Local filter/calendar checks include exact names, fractional timestamps, DST ambiguity/gap handling and mixed-bound edits. Original design/filter results remain in `.local/reports/frontend/20261018-stage-d-review/` and `20261022-filter-ux/`.

### Remaining browser acceptance

Unavailable-environment checks remain parked under the 18 October instruction. [Frontend acceptance](FRONTEND_ACCEPTANCE.md) owns the procedures; this table owns status.

| Check | Status | Required evidence |
| --- | --- | --- |
| Actual hidden-tab return | Deferred — NOT RUN | VIS-01–03: real hidden/visible events, no new hidden cycle, one resync, preserved pause/denial and no duplicate timer. Dispatched visibility events do not count. |
| Cached-document return | Deferred — NOT RUN | CACHE-01–02: prove a retained document returned, then observe metadata/page revalidation, pause/view restoration and one expired-cursor reset. Ordinary Back is insufficient. |
| Corporate/cross-browser | Deferred — NOT RUN | BROWSER-01 in actual corporate Edge/Chrome; include Firefox/Safari when used, with keyboard/layout/failure/lifecycle evidence. |
| Native calendar popup | NOT RUN | Date/time field entry and timezone conversion are observed; native popup interaction still needs its own browser check. |
| Complete enabled-resource/reader matrix | Incomplete | Accepted local SSISDB spot checks do not complete enabled event/value cases, real policy/visibility changes or the independent-reader matrix. |

## Phase 4 / native execution workflows

P4.1a–P4.7c are complete locally. Current behavior belongs in [the plan](MODERNIZATION_PLAN.md#native-execution-detail-and-section-ownership), [usage](installation.md#run-locally), [API semantics](API_CONTRACT.md) and [parity inventory](FRONTEND_PARITY.md); the dated summaries below retain evidence provenance without duplicating those specifications. Later accepted UX changes supersede earlier presentation descriptions.

### P4.1a / native execution detail foundation — 18 October 2026

Validated ID/metadata/base-detail shell, explicit empty/denied/failure states and legacy access pass local tests/build/browser checks. Evidence: `.local/reports/frontend/20261018-p4-1a/`. Local implementation does not establish reader or production acceptance.

### P4.1b / detail refresh and overview return — 18 October 2026

Shared refresh ownership, ID replacement, late-result rejection and retained-return behavior pass controlled checks. Evidence: `.local/reports/frontend/20261018-p4-1b/`. Actual hidden/cache behavior remains in the browser gate table.

### P4.1c / overview-to-native-detail integration — 18 October 2026

Overview links, native detail and validated page-one return work at root/prefix with local keyboard/responsive/request checks. Evidence: `.local/reports/frontend/20261018-p4-1c/`. Fresh navigation and simulated retention do not establish actual cached-document acceptance.

### P4.2a / executable observations — 22 October 2026

Lazy independently paged executable observations preserve separate invocation/result/timing semantics. Automated, packaged and available native/browser checks pass. Evidence: `.local/reports/frontend/20261022-p4-2a/`; observation workload evidence belongs to C8.2b.2b.

### P4.2b / child observations — 23 October 2026

Lazy child observations preserve exact identity, independent paging, conservative recording state and unknown coverage. Evidence: `.local/reports/frontend/20261023-p4-2b/`. The 24 October package-call presentation adds readable paths without inventing child results or a graph; its native replay was unavailable (`503 / SQLSTATE 08001`), while fixture evidence is under `20261024-package-calls/`. Later native spot checks do not erase that original limitation.

### P4.3 — searchable events — 24 October 2026

Category/literal search, independent paging, truncation/coverage and shared cancellation/clearing pass automated, packaged native-disabled and enabled-fixture checks. Evidence: `.local/reports/frontend/20261024-p4-3/`. Later accepted reviews include native Events spot checks; the full enabled/reader/environment matrix remains open.

### P4.4a — parameters — 24 October 2026

Lazy parameters preserve type/flag/value semantics and sensitive/policy/NULL/empty distinctions. Automated, native-disabled and enabled-fixture checks pass. Evidence: `.local/reports/frontend/20261024-p4-4a/`; real policy/reader coverage remains separate.

### P4.4b — property overrides — 24 October 2026

Independent override pages preserve exact paths, sensitivity, policy clearing and cursor resets under the shared detail owner. Automated, native-disabled and enabled-fixture checks pass. Evidence: `.local/reports/frontend/20261024-p4-4b/`; later native spot checks do not complete the real policy/reader matrix.

### P4.5 — package history — 24 October 2026

Exact authorized package history, independent status/ID pages, actual versus estimated timing and execution navigation pass local automated/native/fixture checks. Evidence: `.local/reports/frontend/20261024-p4-5/`. One unattributed focus movement remains a follow-up; later controlled focus passes do not explain it.

### P4.6a — overview timeline — 24 October 2026

Lazy creation-cohort timeline passes calendar/DST, zero/maximum, keyboard, error/race and packaged/browser checks. The 1,000-bucket fixture response is 163,264 bytes; observed local HTTP/automation-to-idle time is 361 ms, not isolated render time or network p95. Evidence: `.local/reports/frontend/20261024-p4-6a/`.

### P4.6b — history visualization — 24 October 2026

Loaded-page actual/estimate charts add no requests or timers. All 200 loaded rows remain keyboard-selectable; zero/missing/extreme values, refresh/paging, error/denial and disposal checks pass. Evidence: `.local/reports/frontend/20261024-p4-6b/`; transfer/render/reader gates remain independent.

### P4.7 submilestones

#### P4.7a — workflow and bookmark inventory — 25 October 2026

Complete locally at `fb684ea`: eight legacy route families, fields/actions, intentional differences and BM/WF cases are recorded in [the inventory](FRONTEND_PARITY.md). Its 46 database-free routing probes, 32 Python and 47 Node checks establish the inventory, not runtime parity. Translation/integration were delivered in the following two tasks.

#### P4.7b — supported bookmark mapping — 25 October 2026

Complete locally at `1f32f4f`: bounded opt-in conversion, explicit unsupported choices and prefix-safe destinations. 394 database-free Python and 380 Node tests plus eight SQL-blocked browser arrivals/actions pass. Evidence: `.local/reports/frontend/20261025-p47b/`; [mapping rules](FRONTEND_PARITY.md#p47b-translation-contract) remain authoritative.

#### P4.7c — local workflow integration — 25 October 2026

Complete locally at `ef133e3`: SQL-blocked packaged WF-01–07 and bookmark round trips, normal/recovery request budgets, 21 page/viewport combinations and keyboard checks pass. The 394 Python/380 Node regression baseline passed; usage was synchronized. P0a closes with G03 fixed and G01/G02/G05 retained. Evidence: `.local/reports/frontend/20261025-p47c/`; [local replay](FRONTEND_PARITY.md#p47c-local-integration) records coverage. Both preview sessions and owned tabs were closed, markers removed and the viewport restored. This is not native reader/workload or cutover acceptance.

## Accepted reviews

The following statuses were reconciled against the actual local review receipts, including the scoped follow-up on 27 October. Historical implementer “review pending” text does not override these final receipts. Acceptance applies to the specified candidate and scope, not every environment gate.

### Backend review fixes

The 20 October patch (`f7a9cb7`) addressed Host validation, guarded API logging conversion, cursor secrets and HTTP-status classification. The 23 October follow-up was independently accepted in round 003 on `5c6b024` on 24 October.

| Follow-up batch | Commit | Accepted result |
| --- | --- | --- |
| 1 | `91dce8a` | Legacy system-only guarded logging conversion and safe unknown levels; zero-safe running-history estimates. |
| 2 | `58311d2` | Fetch Metadata isolation/response headers and loopback compose publication. |
| 3 | `5c6b024` | Listed-first event/logging reads, one created-date aggregation and removal of the external font stylesheet. Native equivalence/plan/IO checks pass. |

Private review task: `ssis-backend-review-fixes-20261023`, `rounds/003/review-codex-final.md`. Evidence: `.local/reports/backend/20261023-review-fixes-r001/` through `r003/`. Large real catalogs with reader joins, sustained concurrency, other browser engines and Docker/hosting remain outside that acceptance.

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
| Task 3 frontend/API/SQL integration | Accepted 27 October; `d350af8`/`131fece` plus source-bound follow-up | History/cursor/estimates, label lifetime/compatibility, prefix/aliases and resource evidence; two reproduced focus issues resolved. Read-only reviewer ran 38 Node/54 Python checks and audited retained local native/browser evidence; reviewer live replay was not run. Receipt: `.local/reports/backend/20261027-task3-review/`. |

Private receipts live in the sibling `collab-contract/runs/` checkout. The recently reconciled task/round pairs are `20261025-ux-f2-design-system/002`, `20261025-fe-review-fixes-2/001` and `20261025-fe-dedupe-refactor/002`; each `status.json` is `ACCEPTED` with no required pending task gate. Review reports are under `rounds/<round>/`. These local receipts are not installation prerequisites.

The refactor reduced authored JS+CSS from 282,180 to 271,258 bytes and packaged gzip from 48,605 to 47,302 bytes. The authorized wrapping of 17 overview lines preserved AST/minified output. Source-size acceptance is now enforced, not deferred. Detailed receipts remain in `.local/tmp/20261025-fe-dedupe-refactor-002/` and `.local/20261025-fe-dedupe-refactor/review-r002/`.

### Follow-up observations

| Observation | Disposition |
| --- | --- |
| FE-4: full hidden event/value/path text is populated in closed disclosures | Advisory. Measure maximum-text DOM/render cost before proposing lazy population; preserve disclosure restoration and redaction. No optimization is implied by this documentation task. |
| Batch 2 R1-F001: focused Pause/Resume becomes natively disabled at execution end | Closed locally by task 3: reproduced focus loss, enabled Refresh fallback, retained-focus and unrelated-focus tests, clean packaged synthetic terminal-poll replay. Actual cached-document/live-execution acceptance remains separate. |
| Refactor O-1: timeline status shifts transiently by about 254 px on refresh | Pre-existing browser observation; retain for a later UX pass. The behavior-preserving refactor did not resolve it. |
| P4.5 focus observation | Unattributed; later controlled passes do not close it. Reproduce before assigning a fix. |

## Evidence and documentation maintenance

Documentation consolidation on 25 October reconciled accepted reviews, replaced duplicated implementation journals with status/evidence summaries and added the three next actions. The obsolete roadmap-order advisory UX A R1-04 was resolved by that user-requested priority update. That documentation-only edit changed no application, SQL, test, dependency or runtime configuration. Its validation covered document links/anchors, required milestone/checklist coverage, whitespace and scope review.

The 25 October validation passed 20 documents, 468 local links/anchors, all 16 Stage C IDs and 30 backend cases; its six changed files were Markdown documentation only. Task 3's current regression, review and cleanup receipts are recorded above and preserved separately; earlier evidence and commit receipts are immutable. Route/field/bookmark/BM/WF and SQL/hosting/stream boundaries retain their documented scope.

Full earlier journals are recoverable from Git: `864ec53:docs/PROGRESS.md` contains the detailed record through this checkpoint; `36b48f8` retains pre-17-October-consolidation logs. Private source-bound evidence remains in the existing ignored reports/runs and sibling review records; no evidence files are moved or deleted.

For future tasks, update the current status and affected gate once, add a concise dated evidence summary, and link the owning procedure/contract instead of copying it. Record candidate/commit, actual checks, native versus synthetic conditions, measurement limits and task-owned resource cleanup. `Complete locally`, `Accepted`, `Deferred` and `NOT RUN` remain distinct; a written procedure or simulated environment is not a pass.
