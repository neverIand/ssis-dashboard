# Full-project review

A layered, read-only review of the whole project, run when the user asks a newly released model to review it. Work moves from architecture to individual implementations, and each layer is written down before the next one starts. Fixes are separate tasks, after the user decides.

## Trigger and roles

- Manual only. The user opens a new conversation with the new model and asks for the review (in Claude Code: `/full-review`).
- The agent hosting that conversation runs every stage. Another agent cross-reviews only when the user asks.
- Start from a clean tree with no task in progress. Otherwise ask the user whether to wait, or to review `HEAD` and exclude the uncommitted files.
- When a check needs a capability the agent lacks (an interactive browser, Windows authentication to the local SSISDB), record it as NOT RUN or ask the user. Never count it as passed.

## Rules

1. **Read-only.** No tracked file changes during the review. Probes and failing tests go under `.local/tmp/`.
2. **Coarse to fine.** Finish each layer's notes before starting the next. When a lower layer contradicts an earlier conclusion, append a correction to the earlier note instead of rewriting it.
3. **Independent first.** Until synthesis, do not open earlier review reports (`.local/reports/reviews/`, review and handoff files under `.local/tmp/`) or expand recalled review memories. AGENTS.md, the [roadmap](roadmap.md) and the [plan](MODERNIZATION_PLAN.md) state intent. Completion and acceptance statements in [Progress](PROGRESS.md) and the acceptance documents are claims to check.
4. **Evidence.** Each finding is VERIFIED (reproduced by a test, probe, local SSISDB query or browser), PLAUSIBLE (reading only) or REFUTED. P1 and P2 findings must be VERIFIED or state why they could not be reproduced.
5. **No duplicate gates.** Do not re-report hosting holds, environment-blocked checks or NOT RUN items already in Progress unless their premise has changed.
6. **Provable coverage.** A ledger maps every in-scope tracked file to the unit that read it.

## Scope

In scope: the application, API, native shell and SQL under `dashboard/` (except the legacy parts below), `web/`, `tests/`, `docs/` and the root build and dependency files.

Out of scope: the legacy presentation (`ssis.py`, `views.py`, `processors.py`, templates outside `templates/app/`, legacy static assets including vendored plugins, fonts and LESS, and legacy SQL such as `package-*`, `engine-*` and `executions-statistics.sql`), legacy hosting files (`Dockerfile`, `docker-compose*.yml`, `web.config`) and IDE project files. Look at them only where something in scope depends on them, such as shared application construction or legacy tests that must pass for a green baseline. Report a legacy problem only when it blocks such a dependency. `legacy_navigation.py` translates legacy bookmarks into native destinations and stays in scope.

## Output

```
.local/reports/reviews/<YYYYMMDD>-full-review-<model>/
  baseline.md     commit, environment, test/build/budget results
  coverage.md     in-scope tracked files → unit; out-of-scope files → reason
  notes/          L1-architecture.md … L5-hotspots.md
  findings.md     numbered findings
  decisions.md    questions for the user
  evidence/       retained probe output
.local/tmp/full-review-<YYYYMMDD>-<run>/   disposable probes; .active while running
```

Follow the [local artifact rules](installation.md#local-artifacts).

## Stage 0 — baseline

1. Record `HEAD`, branch, `git status`, model and date.
2. Build the coverage ledger from `git ls-files`.
3. Run and record:
   - Python discovery (run, passed, skipped) and the opt-in [native suite](../tests/native/README.md); a native skip is NOT RUN;
   - `npm --prefix web ci`, `run build` and `test`, then `tests.test_frontend_assets` (authored and packaged bytes);
   - `.local/tools/check-docs.py`.

   Commands: [test and diagnose](installation.md#test-and-diagnose), [build](installation.md#build-the-browser-assets).
4. If the baseline is not green, stop and report before reviewing.

## L1 — product and architecture

Read AGENTS.md, the roadmap, the plan, the [documentation index](README.md) and Progress current status.

- Does the architecture still serve the roadmap's constraints (read-only, loopback, one SQL identity, legacy coexistence)? Will it carry the next phases (live updates, cutover)?
- Generate the Python and `web/src` import graphs with a script under `.local/tmp/` and compare them with the plan's boundary table: cycles, layer crossings, unused modules.
- Structural duplication across resources, such as the fence/page SQL pairs and per-resource paging and validation.
- Runtime and dependency pins: age, known vulnerabilities, licensing.
- Documentation ownership: overlaps and stale statements.

Output: a text architecture map, architectural risks, and direction questions in `decisions.md`. Architectural opinions are `Design` findings for the user to decide; they do not go straight into fix batches.

## L2 — boundaries and contracts

Check that both sides of each boundary agree:

- **API:** `openapi.yaml`, `api.py`/`api_validation.py`, `tests/test_api_contract.py` and the DTO checks in `web/src` (fields, BIGINT strings, 100-ns timestamps, error envelope, cursors, capabilities, limits).
- **Configuration:** each key's default, validation, documentation and startup failure.
- **SQL:** every in-scope `query/` file's parameters and types against its caller; unreferenced SQL.
- **Security:** host allowlist, Fetch Metadata, CSP, `nosniff`/`X-Frame-Options`, redaction, safe errors, log fields.
- **Shell:** manifest validation, prefixes, the 503 fallback, cache headers.
- **Legacy to native:** bookmark mapping and prefix links.
- **Newest component** (in November 2026, the P5.1 detector): its interface with application construction and lifecycle.

Output: a table of boundary, side A, side B, mismatch and impact.

## L3 — cross-cutting concerns

One sweep per theme across backend, SQL and frontend:

| Theme | Focus |
| --- | --- |
| Time and precision | Time zones and DST, 100 ns, NULL and unknown codes, BIGINT |
| Paging and ordering | Limit + 1, cursor authentication and stability, global calculated sorts |
| Concurrency | Frontend generations, aborts and late responses; backend threads and the reloader |
| Resource lifecycle | Connection and cursor closing, timers, listeners, disposal, stop/join |
| SQL work | The AGENTS SQL rules and the [workload protocol](API_ACCEPTANCE.md#workload-protocol); sample actual plans |
| Frontend cost | Request counts, polling, DOM size, [budgets](roadmap.md#acceptance-budgets) |
| Security | Parameter binding, text-only DOM writes, CSP compatibility, error disclosure, cross-site requests |
| Error handling | Safe-error mapping, consistent retry and backoff |
| Accessibility | Focus, keyboard paths, ARIA, forced colours |
| Test quality | Behaviour rather than implementation, weakened assertions, untested paths, batch-named test files |
| Documentation drift | Numbers and behaviour stated in documents against the code |
| Maintainability | Duplication, oversized modules, naming |

Output: a note per theme and a list of hotspot files for L4 and L5.

## L4 — module implementation

Read unit by unit and write one note per unit. Regenerate the units from the ledger each time; the November 2026 grouping was:

| Unit | Files |
| --- | --- |
| B1 construction and operations | `__init__`, `config`, `wsgi`, `runserver.py`, `observability`, `browser_policy`, `errors` |
| B2 API and representation | `api`, `api_validation`, `validation`, `serialization`, `timestamps`, `timezones`, `cursors` |
| B3 resource coordination | `executions`, `execution_order`, `navigation`, `metrics`, `timeline`, `inspection`, `events`, `executables`, `children`, `values`, `history`, `filters`, `legacy_navigation` |
| B4 database and SQL | `db.py`, `query/api-*.sql`, `query/detector-*.sql` |
| B5 change detection | `changes`, `detector` |
| F1 shell and startup | `frontend.py`, `templates/app/`, `main`, `bootstrap`, `api`, `display`, `theme-init`, `ui`, `loading-space` |
| F2 filters and time | `selection`, `filters`, `range-editor`, `time-range`, `catalog-search`, `navigation`, `table-order` |
| F3 overview | `overview*`, `render-overview`, `refresh-loop`, `timeline`, `render-timeline` |
| F4 detail | `detail*`, `render-detail`, `section-table`, `observation-page`, events, executables, children and values with their renderers |
| F5 history and charts | `history*`, `render-history*`, `chart-view` |
| F6 styles | `styles.css` |
| T tests | `tests/`, `tests/native/`, `web/tests/` |
| O build and dependencies | `web/vite.config.js`, `web/package*.json`, `requirements*.txt`, `constraints*.txt`, `.gitattributes` |

Follow the data flow: B4, B3, B2, B1, B5, F1–F6, T, O.

For each unit, check:

- its responsibility against the L1 and L2 conclusions;
- each public function's validation, failure paths and boundary values (empty, 1, limit, limit + 1, NULL, maximum text);
- state and lifecycle;
- branches its tests miss;
- simplification (P3 or P4 only).

## L5 — hotspots and runtime checks

- Read the L3 and L4 hotspots line by line: off-by-one errors, precedence and short-circuiting, encoding and regular expressions, swallowed exceptions, implicit conversions.
- Backend and SQL: read-only probes against the local SSISDB, recording actual plans under the AGENTS SQL rules.
- UI: with an interactive browser, check behaviour, layout and use of space at 1440, 853 and 390 px in light and dark themes.
- Reproduce each suspicion, or mark it PLAUSIBLE with the reason.

## Synthesis

1. Merge duplicates and shared root causes.
2. Verify each finding with a probe or a failing test under `.local/tmp/`.
3. Only now read earlier reviews (`.local/reports/reviews/` and [accepted reviews](PROGRESS.md#accepted-reviews)). Tag each finding NEW, REGRESSION, KNOWN or PREVIOUSLY-DECLINED, and list earlier conclusions that no longer hold.
4. Rate severity:
   - **P1:** wrong data, security exposure, crash or leak on a common path;
   - **P2:** failure under realistic conditions, or material performance or database work;
   - **P3:** edge case, hardening, or significant maintainability cost;
   - **P4:** style, documentation, optional cleanup.

   Categories: Bug, Security, Performance, Resource, Design, Test gap, Docs drift, Cleanup.
5. Propose fix batches grouped by file overlap and dependency, each independently testable and reviewable.

Finding template:

```
### R-07 — P2 · Resource · VERIFIED · NEW
Location: dashboard/example.py:120-134 (L3 resource lifecycle)
Observed: …
Evidence: evidence/r07-probe.json (command and output)
Impact: …
Suggested fix: …
Related: Progress gate … / earlier finding …
```

## Handoff

- Stop and present `findings.md` and `decisions.md`. The user chooses what to fix and how to batch it.
- Each fix batch is a normal task with its Progress entry, tests and review, committed only on the user's word.
- Add one line to [accepted reviews](PROGRESS.md#accepted-reviews): date, model, base commit, findings by severity and the report path.
- Record how many NEW findings earlier reviews missed and what share was REFUTED, to judge whether reviewing with each new model is worth it.

## Pacing

Use one conversation by default, with a chapter per layer. Layer notes are the resume point after context compaction or in a follow-up conversation. L4 units may run in parallel subagents, but each writes its own note and the main conversation does the synthesis.
