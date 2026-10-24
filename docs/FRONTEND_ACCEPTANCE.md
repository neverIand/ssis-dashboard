# Frontend acceptance procedures

These are manual procedures, not test results. [Progress](PROGRESS.md#remaining-browser-acceptance) owns current status; the [roadmap](roadmap.md) owns scope and [the plan](MODERNIZATION_PLAN.md#overview-state-and-refresh) owns expected lifecycle behavior. On 18 October 2026 the user agreed to leave unavailable-environment checks pending while reviewing how to test them and continuing local phase 4 development. The design system and its recorded local checks are already complete at `3c41da7`.

Use `PASS` only for the exact condition observed, `FAIL` for a behavior mismatch, and `NOT RUN` when the required browser, identity, fixture or lifecycle condition is unavailable. A simulated owner event is useful unit evidence, but does not prove an actual hidden document or restored browser-cache entry. An ordinary Back navigation tests a different path from a cached-document return.

## Prepare a run

1. Select the revision and packaged build being checked. Follow [local startup](installation.md#run-locally) and [browser build instructions](installation.md#build-the-browser-assets). Attribute and reuse an existing healthy preview, or start one owned loopback process. Record its PID, port and shutdown method. Use the actual Flask `/app/` page, not the separate Vite development harness.
2. Use an ordinary browser that can actually hide and restore a tab. For corporate acceptance, use the real managed Edge/Chrome profile; record full browser version, OS and relevant restrictions. Include Firefox/Safari when they are used by the intended audience. An in-app browser run does not establish those environments.
3. Use the approved local configuration and a visible execution cohort with at least two pages. Record the exact effective time bounds, page size/order and data source privately. For view tests, select a position away from the document's scroll limit so content-height changes do not create a false scroll failure. Keep native SSISDB and controlled synthetic results separately identified.
4. Capture API request order, start/end times, status and request IDs, plus the visible page/poll status. A successful overview cycle normally contains one execution-page request followed by one summary request with the returned exact bounds. Metadata and folder/project navigation are separate requests. Compare cycles, not just the raw request count.
5. Prepare controlled scenarios for a delayed list, delayed summary, summary-only retry, transient failure, denial and expired cursor. The retained frontend evidence includes local preview helpers, but ignored tools are not a portable application feature: inspect their available routes and ownership before reuse, or prepare an equivalent isolated fixture. A missing fixture leaves its subcase `NOT RUN`. Do not revoke real permissions, change shared caches or disrupt a production service to create a browser failure.
6. Record results with the [evidence template](#evidence-and-handoff). Keep private HAR/console/network data and screenshots in ignored dated runs under the [local-artifact rules](installation.md#local-artifacts); publish only sanitized outcomes. Response bodies, query names/cursors, event text and values may contain private data.

Browser inspection itself can affect lifecycle eligibility. Record how evidence was collected and any eligibility diagnostic. Preserve application cache/access policies; do not remove them just to obtain a cache pass. If the document is never retained, verify the ordinary fallback and leave cached-document acceptance `NOT RUN`, with the observed reason.

### Observe real lifecycle events

An optional temporary console observer records actual events without changing application state or dispatching fake events. Install it once on the loaded overview before hiding or navigating away. Preserve the console log across navigation when the browser supports it. Reloading removes this observer; a retained document keeps it. If inspection prevents cache retention, use the browser's lifecycle diagnostics or a reviewed local diagnostic build instead and record that difference.

```javascript
(() => {
  const record = (event) => console.info('frontend-acceptance', JSON.stringify({
    at: new Date().toISOString(),
    event: event.type,
    visibility: document.visibilityState,
    persisted: 'persisted' in event ? event.persisted : null,
  }));
  document.addEventListener('visibilitychange', record);
  window.addEventListener('pagehide', record);
  window.addEventListener('pageshow', record);
})();
```

For visibility evidence, require actual `hidden` and `visible` observations. For cache evidence, require the returning `pageshow` to report `persisted: true`; the same URL, a fast return or a `back_forward` navigation label alone is insufficient. The observer is diagnostic only and does not enable either condition.

## Hidden-tab return

These cases cover D3c.2. Run them with production scheduling; do not shorten the application interval for the real-browser claim. Slow-cycle and failure fixtures may control responses, and must be labeled synthetic.

### VIS-01: idle hide and return

1. Load a two-page-capable overview, wait for the list and summary to finish, and note the displayed next refresh time. Auto refresh should be enabled.
2. Switch to another tab or minimize the window and confirm the overview actually becomes hidden. Remain hidden beyond at least two normal scheduled intervals; for a slow or backed-off cycle use the displayed delay rather than assuming 30 seconds.
3. Return and confirm a real visible transition. Observe completion and the next scheduled cycle without repeatedly pressing Refresh.

**Pass:** no new polling cycle starts while hidden. Return produces exactly one list/summary resync for the current page, then one completion-based schedule. A deeper page replays its exact entry cursor/window; page one follows its selected default/explicit-window rules. Filters, sorting, current page and view anchors remain consistent. Record the hidden interval and request sequence.

### VIS-02: hide/return during work

1. Use a delayed-list fixture. Start a refresh, hide the document while the list is pending, then return before it completes. Repeat with a delayed summary and with the active cycle completing while still hidden.
2. Repeat a rapid hidden/visible transition during the same active refresh. Record whether one return resync is queued; do not infer its count from status text alone.
3. Produce a summary failure, start **Retry summary** with a delay, then hide/return while that request is pending.
4. Separately repeat a hide/return during an initial load or explicit selection load.

**Pass:** only one resource request is active in the coordinator at a time. An already-started cycle may finish while hidden, including its summary; that is not a new poll. Return during a refresh or summary-only retry coalesces to one subsequent full resync, with no extra timer. Initial/restored/selection loading already covers return and must not add another immediate full cycle. A later hidden transition removes any pending schedule. Changing selection during a delayed old response cannot display or clear the new selection using that old response.

### VIS-03: pause and nonretryable stopping

1. Pause auto refresh, hide and return, and wait past the normal refresh interval. Use manual Refresh while paused, then repeat hide/return. Resume and observe the next cycle.
2. In an isolated denial fixture, let a refresh return a nonretryable access error. Hide/return and wait past the normal interval. Restore the fixture and recover through the explicit retry/selection action.

**Pass:** user pause survives hide/return and manual refresh; return causes no automatic resync while paused. Resume starts one refresh or joins active work. Denial clears protected observations and does not restart automatically on return. Recovery requires the documented user action. Record pause state and both the absence and later presence of requests.

## Cached-document return

These cases cover the other part of D3c.2. Overview execution links now open native detail. Exercise both the native detail path and its retained Legacy detail link; a successful ordinary return does not establish a retained document.

### CACHE-01: restore a retained overview

1. Open a deeper overview page and record its selection, order, limit and exact page context. Set a stable document/table scroll position, focus an execution link, and pause auto refresh. Install the lifecycle observer if needed.
2. Follow the execution link in the same tab, then use browser Back. Check whether the actual returning `pageshow` reports `persisted: true`.
3. If retained, observe settings revalidation and the restored page load through completion. Record the active element, scroll positions, page label and pause control afterward. Wait beyond the normal interval.
4. Repeat with auto refresh enabled. Also record one ordinary fresh-document return/reload as a separate fallback case.

**Pass for the retained path:** metadata is revalidated, one saved-page list/summary cycle completes, current data is re-fetched rather than treated as a cached snapshot, and the saved pause/view anchors are restored. The paused path performs no later automatic cycle; the enabled path creates one schedule. A removed focused row uses the table-region fallback. Browser scroll clamping is not an exact-position failure when the available range shrinks.

**Fresh-document fallback:** validated URL filters/order/limit restore and loading starts at page one; in-memory pause/cursor state need not survive. Record this independently. A successful fresh return does not close CACHE-01, and failure to obtain `persisted: true` must remain `NOT RUN` for that condition.

### CACHE-02: expired saved cursor

1. Obtain the retained-document setup from CACHE-01 on a deeper page. Use a controlled expiry/invalid-cursor response on return, or wait past the metadata-advertised cursor lifetime before returning. Do not change system/browser clocks to manufacture expiry.
2. Prove `persisted: true`, then observe the saved cursor attempt, fallback requests, visible explanation and restored pause behavior. Repeat with the first-page fallback itself failing.

**Pass:** exactly one invalid saved-path attempt leads to one explained first-page reset. There is no cursor replay loop, mixed old/new scope or duplicate timer. If that reset fails, a clear error waits for explicit action. A paused screen remains paused. Separate actual elapsed expiry from synthetic expiry evidence.

## Corporate browser walkthrough

### BROWSER-01: target environment smoke and regression checks

Run the following in actual corporate Edge/Chrome and each additional supported browser in use. Record the environment independently even if the same steps passed in the in-app browser.

| Area | Actions | Expected evidence |
| --- | --- | --- |
| Startup and links | Open the packaged shell directly, reload a valid deep selection, follow a detail link and return. Repeat on an available mounted prefix. | Local packaged assets load; metadata/failure states are clear; generated links retain their application prefix. Record an unavailable prefix environment separately. |
| Selection and paging | Choose/type exact folder/project names, change status and time scope, Apply, change server order/size and walk Next/Previous. Exercise an exact-name fixture with CR/LF, Unicode and literal markup. | Canonical names survive unchanged Apply; explicit folder edits clear project. Server order/cursors are used; all-status cards retain their documented cohort. Actual catalog-name creation is not implied by fixture results. |
| Keyboard and refresh | Navigate by Tab/Shift+Tab; activate actions with the keyboard. Let real scheduled refresh run with Next, Previous or Show latest focused; move focus during a delayed cycle. | Focus remains usable, busy actions do not start requests and completion does not steal a new focus target. Empty/terminal pages retain navigation. |
| Layout and content | Check 1280/768/360 px widths and increased browser zoom, long names/paths, large IDs, unknown codes and NULL/zero values. | Labels/statuses remain readable, names render literally, controls are reachable, and table overflow stays in its own scroll region. |
| Failure and recovery | Exercise list/summary transient failure, slow response, empty page, denied access and explicit recovery using isolated fixtures. | Previous observations are correctly labeled or cleared; request IDs wrap; retries preserve the authorized scope without loops. |
| Lifecycle | Run VIS-01–03 and CACHE-01–02 above. | Record each result and actual event/request evidence. Unsupported or unobtained conditions stay NOT RUN. |

Include native execution detail, direct ID links, execution switching, detail refresh and the retained legacy link in this walkthrough. [P4.1c's local record](PROGRESS.md#p41c--overview-to-native-detail-integration--18-october-2026) provides comparison evidence, not corporate-browser acceptance. Do not mark planned section workflows passed from the current metadata/count checks. [Phase 4 tasks](PROGRESS.md#phase-4--native-execution-workflows) define each later section's additional cases.

## Native detail refresh and return

The overview and direct `/app/executions/{id}` links use the same native detail screen. The [P4.1c record](PROGRESS.md#p41c--overview-to-native-detail-integration--18-october-2026) owns local integration/field comparisons; [P4.2a](PROGRESS.md#p42a--executable-observations--22-october-2026) / [P4.2b](PROGRESS.md#p42b--child-observations--23-october-2026) own executable/package-call observations; [P4.3](PROGRESS.md#p43--searchable-events--24-october-2026) owns searchable events; [P4.4a](PROGRESS.md#p44a--parameters--24-october-2026) owns parameters. Property overrides are covered by [P4.4b](PROGRESS.md#p44b--property-overrides--24-october-2026); package history is covered by [P4.5](PROGRESS.md#p45--package-history--24-october-2026); later chart and bookmark parity remain P4.6–P4.7. Keep native observations separate from controlled failure/active/unknown fixtures.

1. Open a native detail directly and under an available prefix. Check settings then one detail request, exact ID/timing/counts and retained Legacy detail navigation. Manual Refresh, polling and Resume must share that request owner. Hold a delayed cycle, activate Refresh repeatedly and move focus/scroll elsewhere before it completes; verify no overlapping request or focus taken back. Use a scroll position away from its current limit; record browser clamping separately when content height shrinks.
2. Pause auto refresh, wait beyond the interval and use manual Refresh. Resume should update once when idle or join pending work. Exercise transient failure, 401/403/404 and malformed responses in isolated fixtures. Only transient same-ID failures may retain labeled old observations and their original time; other failures clear every protected field and stop automatic retry. Retry recovers after the cause is resolved.
3. Follow an execution ID from a deeper overview page under root and an available prefix. Edit a filter without applying it before following another link; only the applied selection may become the detail's `overview` context. Verify the Overview destination preserves exact names/times/status/order/limit and opens page one, with a visible explanation. Invalid, repeated or external-looking context must fall back to the local default overview without constraining the detail read. Compare Browser Back independently; a fresh document starts at page one, while a real retained overview re-fetches its saved path and resets an expired path once. Compare metadata/counts with the explicit Legacy detail link; later observation/event/value sections retain their own parity tasks.
4. Extend VIS-01–03 to detail using one base-detail request per cycle plus one request per open observation table, serially. Standalone section opening/paging uses one section request. Extend CACHE-01–02 to detail with actual `pageshow.persisted: true`: metadata, base detail and each open page must be re-fetched before restoring a still-applicable pause/page/view checkpoint. Move focus/scroll during revalidation and check that completion respects that new position. Never infer this condition from owner simulations or ordinary Back. Record an unavailable hidden/cache condition as NOT RUN.

Repeat keyboard and 1280/768/360 px checks with long literal names, request IDs and both Refresh and Pause/Resume controls. Returning after a settings failure must not leave old result fields, active schedule hints or an unwired Retry execution control. Update the owning [P4.1b/P4.1c records](PROGRESS.md#phase-4--native-execution-workflows) only for the exact cases observed; these procedures do not close their environment gates.

### Executable observations

Open the section under root and a prefix; verify no executable request while closed. Walk supported orders, Previous/Next and a changed page size, then refresh a deeper page with the same entry cursor/cohort. Show latest and order/size changes start page one. A cursor failure gets one explained reset; failure of that fallback must not relabel retained rows. Empty pages distinguish unknown coverage from explicitly not recorded.

Compare exact statistics/executable IDs, names, paths, wire timestamps, nullable duration and the separate executable-result vocabulary against the DTO. Use controlled cases for repeated invocations, unknown result codes, NULL/empty/zero and long Unicode/markup-like text where native data is absent. Timing must stack Started above Ended in the same cell; Duration and Result stay separate. At 1280/768/360 px verify document width, table keyboard scrolling and access to both timestamps. During refresh retain keyed rows, expanded paths and the user's current focus/scroll.

Exercise transient errors, section denial/malformed data and section 404 separately. Close during a delayed request and switch IDs, including an A → B → A sequence; late responses must not repopulate a closed/new scope. A closed denied section must allow base-only polling. Confirm no overlap or duplicate cycle while requests are delayed, and dispose requests/listeners/timers on navigation. Owner/DOM tests cover retained section state and races; repeat actual hidden/cache/corporate-browser conditions when available, retaining NOT RUN until observed.

### Child observations and shared section lifetime

Repeat the executable paging/refresh/error procedures with `/children`, the supported started-time/observation-ID orders, and the independent child cursor path. Open both tables, page/order one and verify the other stays unchanged. A normal refresh must read base detail then each open page serially, with one completion-based schedule. Open a second section during a delayed first section; it must queue. Close the in-flight section; another queued section must still load, and the closed section's late success/denial must not affect the execution. Retry a failed section independently; a base failure gates both, and any section 404 clears both.

Compare start-event IDs, exact package/path/source metadata, seven-digit timestamps, missing/zero duration and pairing state with the DTO. Use controlled repeated-key, missing-identity and late-end cases separately from native completed pairs. An incomplete row may become an observed pair above the retained start-ID fence without replacing the row, expanded paths, focus or scroll. No success badge or separate execution link may be invented. Unidentified-start coverage must remain visible on nonempty, empty and continuation pages and force unknown availability. Repeat keyboard, stacked timing and 1280/768/360 px checks. Record retained checkpoints only as controlled evidence until actual hidden/cache/corporate-browser conditions are obtained.

### Searchable events

With the configured event capability disabled, open root and prefixed detail pages and refresh them: the Events control stays unavailable and the UI sends zero `/events` requests. Check the direct API denial separately; do not enable native event access merely to replace a missing acceptance condition. An enabled SQL-free fixture proves controlled UI behavior only. Enabled native event search and legacy category comparisons remain NOT RUN until that configured environment is available.

With event access enabled, verify no event request while closed. Open Events, page both directions, change each supported order/page size, refresh a deeper page with its entry cursor/cohort, and reset an expired path once. Category/search edits remain drafts until Apply filters. Refresh and order changes must keep the applied selection; Apply starts page one, and Reset clears category/search while retaining order/size. Test literal whitespace, punctuation, Unicode and the advertised search limit. A full-source match beyond the returned message prefix must still appear, with explicit truncation. A browser textarea normalizes CR/LF to LF; compare the request with its actual value, while DTO messages and source fields retain their exact returned line endings.

Compare exact event/execution IDs, wire times, NULL/empty text, unknown numeric codes and source paths with the DTO. Markup-like text must stay literal. Expand a message and Source, refresh, and retain keyed expansion, current focus and scroll. Show coverage on nonempty, empty and continuation pages, including unidentified matching events excluded from paging. Open all three tables: refresh reads base detail, executables, package calls and events serially under one completion-based schedule, with independent pages. Disabled sections add no request.

During a delayed event query, apply another search and queue a sibling section. The last applied search must win, queued sibling work must survive, and late success/denial from the old search must be ignored. A new query cannot retain old-query rows after failure. Repeat transient/retry, denied/malformed section clearing and whole-execution clearing on 404. Check repeated busy refreshes, deliberately moved focus, keyboard/table scrolling and 1280/768/360 px layouts. Search text, fetched event bodies and cursors must stay out of URL/history/storage. Actual visibility/cache/corporate-browser and native SQL cancellation remain separate acceptance conditions.

### Parameters

Open native detail under root and a prefix with the configured values capability disabled. The parameter control must remain unavailable and both opening/refreshing must add zero `/values` requests. Check direct API denial separately and confirm it precedes SQL. Keep enabled native replay NOT RUN while that configured environment is unavailable; enabled SQL-free fixtures prove UI behavior only.

With permitted access, verify lazy opening, fixed ascending parameter-ID order, independent Previous/Next, page-size changes, Show latest, deeper-page refresh and one reset of a policy-invalidated cursor. Only `section=parameters`, limit and cursor belong in the value query. Compare exact high IDs, names/catalog type labels, unknown object-type codes, flags and lexical values (including decimal scale, binary text, dates, Unicode and line endings). Distinguish sensitive/policy redaction from unredacted NULL and empty strings. Check explicit returned-prefix truncation and literal markup; do not infer a JSON type or expose a reveal control for redacted values.

Expand a value and flags, then refresh. Keyed rows retain applicable expansion, focus and scroll. When that parameter becomes redacted, its old full text must be removed from the DOM; hidden value focus falls back to the table. Malformed redaction flags or leaked plaintext fail closed before rendering and clear prior parameter rows. Exercise transient stale/retry, section denial/malformed clearing and whole-execution 404 independently. Enabled parameters are independent of override-value permission. Disabled metadata on a retained return drops the section, and restored pages re-fetch under current policy before view restoration.

Open all four sections: refresh reads base detail then executables, package calls, events and parameters serially under the existing scheduler. Repeated busy refreshes coalesce; opening another section while parameters are pending queues it. Closing in-flight parameters must preserve queued sibling work and ignore late responses. Keep deliberately moved focus, verify keyboard/table scrolling and 1280/768/360 px layouts, then close/dispose owned resources. Checkpoints may retain IDs/view anchors, never parameter names/types/values or fetched rows. Actual visibility/cache/corporate-browser and native SQL cancellation remain separate gates.

### Property overrides

Follow the [P4.4b completion record](PROGRESS.md#p44b--property-overrides--24-october-2026) for local results. With configured value access disabled, root and prefixed native pages must keep Overrides unavailable and add zero value requests; direct denial must precede SQL. Preserve that configuration and leave enabled native replay NOT RUN. Use separate SQL-free fixtures for permitted behavior.

With `values` enabled, open Overrides lazily and compare exact ordered property IDs, bounded property paths, sensitivity and lexical values with the DTO. Verify Previous/Next, page size, Show latest and deeper-page refresh independently from Parameters. Queries contain only section, limit and cursor. Preview long paths, then expand View path to compare literal markup, Unicode and trailing line endings. No catalog type or parameter flags are inferred. Values distinguish sensitive/policy redaction, unredacted NULL, empty and explicitly truncated returned prefixes; no redacted value has a reveal control.

With `override_values` disabled but `values` enabled, the section remains usable for metadata and shows the policy hint. Nonsensitive values must be policy-redacted, and sensitive redaction takes precedence. Plaintext inconsistent with either rule must fail closed before rendering and clear old rows. Re-fetch retained pages under fresh metadata before restoring anchors; disabled value access drops them. Invalid policy-bound cursors reset once, removing prior values before the first-page attempt, including when fallback fails. A valid live redaction removes hidden/expanded raw text while retaining applicable path expansion and moving hidden-value focus to the table.

Open all five sections: base detail, executables, package calls, events, parameters and overrides must read serially under one schedule. Keep their pages independent. Exercise stale/retry, section denial/malformed clearing, execution 404, repeated busy refreshes, queued siblings and closing a pending override request with late completion. Verify current focus, keyboard/table scroll and 1280/768/360 px layouts. Checkpoints contain only queries/cursors and ID/view anchors, never fetched paths or values. Close owned resources; actual visibility/cache/corporate-browser and native SQL cancellation retain their separate gates.

### Package history

Use the [P4.5 record](PROGRESS.md#p45--package-history--24-october-2026) for observed local results. Open history at root and a prefix without enabling event/value access. Verify exact folder/project/package from base detail, including literal punctuation, Unicode and line endings; queries must not inherit overview dates or patterns. Initial statuses are 2/7. Checkbox drafts must wait for Apply statuses; direction, size and refresh use applied statuses and preserve drafts. Empty status selection must fail locally. Walk both ID directions, Previous/Next, changed size, Show latest, a deeper-page refresh and one expired-cursor reset. Missing or hidden named history scopes remain empty 200 collections.

Compare exact IDs and wire timestamps with the DTO. Created/Started/Ended remain stacked; missing actual end/duration stays missing when an estimate exists. Display zero actual duration and observed active elapsed separately. Compare estimated duration/end and the one-to-five sample count, including a positive sub-tick mean whose rounded end equals the start. An unavailable estimate must not invent a cause or sample count; zero-mean and eligibility calculations belong to the independent history API tests. Refresh changing estimates/retention, remove obsolete estimate text, and keep applicable keyed links, focus and scroll. An empty retained page still offers Previous/Show latest.

Open all six sections and verify seven serial reads under one schedule with independent pages. Close pending history, preserve queued siblings and ignore late results. Exercise transient/retry, denial/malformed history clearing, global history 404 without clearing base detail, and a changed exact identity without retaining old rows after failure. Follow a history ID to native detail with only validated overview return selection. Restored checkpoints must refetch before restoring ID/view anchors and exclude rows, names and estimates. Repeat keyboard/table scroll and 1280/768/360 px checks. Record changed focus with its intervening actions; an unattributed background/tooling-gap observation must not be counted as a pass. Actual hidden/cache/corporate-browser, reader/resource, native cancellation and test-network p95 gates remain separate.

## Other environment-dependent gates

These gates keep their existing owners and result status. Missing environments can wait; local workload/resource work that can run should remain scheduled alongside phase 4.

| Gate | Required condition and handoff | Canonical procedure/result |
| --- | --- | --- |
| C8.3 reader API HTTP | An actual approved Windows-reader sign-in/session and the intended SQL connection context. Repeat API visibility/hidden-versus-absent and HTTP timing checks under that process identity. A browser login alone does not change SQL identity; administrator impersonation is separate evidence. Keep credentials outside chat and tracked files. | [Reader preparation](SSIS_FIXTURE_PROJECT_GUIDE.md#reader-permissions-and-sign-in-reference), [API shared checks](API_ACCEPTANCE.md#shared-boundary-checks), [current gate](PROGRESS.md#remaining-acceptance). |
| Reader SHOWPLAN | The required permission already exists for the tested scope. Record missing access as NOT RUN; do not add grants solely to complete this measurement. | [SQL diagnostics](API_ACCEPTANCE.md#sql-diagnostics). |
| Real active/Scale Out observations | Representative catalog data that exposes the required identities/coverage, with an approved test scope. Synthetic IDs/pairs or one small catalog do not establish this integration. | [Fixture guide](SSIS_FIXTURE_PROJECT_GUIDE.md), [API validation](API_ACCEPTANCE.md). |
| OBS-02 | An isolated, attributable native cleanup-failure observation. A synthetic exception or successful close is different evidence. | [Backend timing and resources](BACKEND_CHECKLIST.md#timing-logging-and-resource-checks). |
| HOST-01/02/03, production stream and cutover | Hosting must first be explicitly resumed; then use the actual identity, authentication/proxy/HTTPS and capacity environment. | [Deferred hosting checks](BACKEND_CHECKLIST.md#hosting-checks-deferred-at-the-users-request), [hosting design](MODERNIZATION_PLAN.md#identity-and-hosting). |

No browser procedure closes the SQL/WSGI/network distinction or the proposed network p95 budget. [C8 workload protocol](API_ACCEPTANCE.md#workload-protocol) governs those measurements and their remaining resource/reader checks.

## Evidence and handoff

For each attempted case, retain the following in the ignored dated run and add a sanitized result to the owning progress/acceptance record:

```text
Case ID / subcase:
Result: PASS | FAIL | NOT RUN
Date/time (UTC), tested revision and asset hashes:
OS, browser version/profile, application mount:
Data source: native | synthetic; approved visibility scope:
Setup and actions:
Actual visibility events / pageshow.persisted (when applicable):
Request sequence, timing, statuses and request IDs:
Observed selection/page/pause/focus/scroll before and after:
Evidence file paths:
Difference from expectation or missing environment/fixture:
Owned tabs/processes/ports and verified cleanup:
```

Close owned tabs and previews through their supported shutdown, verify process exit and port release, then remove the run's `.active` marker and retain selected evidence with hashes. Do not stop unrelated processes. Report a failed case with its reproducible trigger; report an unexercised case with the exact missing condition and next prerequisite. Update D3c.2/.3 only after their applicable cases have real evidence; keep API, hosting and later-screen acceptance independent.
