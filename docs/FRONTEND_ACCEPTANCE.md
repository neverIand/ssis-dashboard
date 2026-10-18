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

The overview and direct `/app/executions/{id}` links use the same native detail screen. The [P4.1c record](PROGRESS.md#p41c--overview-to-native-detail-integration--18-october-2026) owns local integration/field comparisons; later section and bookmark parity remain P4.2–P4.7. Keep native observations separate from controlled failure/active/unknown fixtures.

1. Open a native detail directly and under an available prefix. Check settings then one detail request, exact ID/timing/counts and retained Legacy detail navigation. Manual Refresh, polling and Resume must share that request owner. Hold a delayed cycle, activate Refresh repeatedly and move focus/scroll elsewhere before it completes; verify no overlapping request or focus taken back. Use a scroll position away from its current limit; record browser clamping separately when content height shrinks.
2. Pause auto refresh, wait beyond the interval and use manual Refresh. Resume should update once when idle or join pending work. Exercise transient failure, 401/403/404 and malformed responses in isolated fixtures. Only transient same-ID failures may retain labeled old observations and their original time; other failures clear every protected field and stop automatic retry. Retry recovers after the cause is resolved.
3. Follow an execution ID from a deeper overview page under root and an available prefix. Edit a filter without applying it before following another link; only the applied selection may become the detail's `overview` context. Verify the Overview destination preserves exact names/times/status/order/limit and opens page one, with a visible explanation. Invalid, repeated or external-looking context must fall back to the local default overview without constraining the detail read. Compare Browser Back independently; a fresh document starts at page one, while a real retained overview re-fetches its saved path and resets an expired path once. Compare metadata/counts with the explicit Legacy detail link; later observation/event/value sections retain their own parity tasks.
4. Extend VIS-01–03 to detail using one detail request per cycle instead of list plus summary. Extend CACHE-01–02 to detail with actual `pageshow.persisted: true`: metadata and detail must be re-fetched before restoring a still-applicable pause/view checkpoint. Move focus/scroll during revalidation and check that completion respects that new position. Never infer this condition from owner simulations or ordinary Back. Record an unavailable hidden/cache condition as NOT RUN.

Repeat keyboard and 1280/768/360 px checks with long literal names, request IDs and both Refresh and Pause/Resume controls. Returning after a settings failure must not leave old result fields, active schedule hints or an unwired Retry execution control. Update the owning [P4.1b/P4.1c records](PROGRESS.md#phase-4--native-execution-workflows) only for the exact cases observed; these procedures do not close their environment gates.

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
