# Local development on dev-next

Use a fresh standard CPython 3.14 environment. The recorded native baseline is Windows x64 / CPython 3.14.8 / pyodbc 5.3.0 / ODBC Driver 17.10.0006 / SQL Server 2022 16.0.1000.6. Other SQL/driver/platform combinations require their own validation; the README's legacy compatibility list is historical. Production hosting is deferred. See [the documentation index](README.md) for API use and validation.

## Create an environment

From the repository root in PowerShell, select the intended Python interpreter explicitly:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pip check
```

On a POSIX shell, activate with `. .venv/bin/activate`. Recreate the environment when changing Python minor versions. `requirements.txt` applies the exact runtime pins in `constraints.txt`; development tools have separate requirements/constraints. Pins cover Python packages, not interpreter/OS/ODBC versions or artifact hashes. Dependency updates require a clean install, `pip check`, tests, entry-point discovery and affected native checks.

For offline installation, download wheels with the target interpreter/platform while online, then install them into the fresh environment:

```sh
python -m pip download --only-binary=:all: --dest wheelhouse -r requirements.txt
python -m pip install --no-index --only-binary=:all: --find-links wheelhouse -r requirements.txt
python -m pip check
```

Keep `.venv/`, `wheelhouse/`, private config and reusable temporary scripts ignored. A successful pyodbc import does not establish an installed SQL Server ODBC driver or catalog access.

## Configure

Copy the needed options from [defaults](../dashboard/config.py) into ignored project-root `config.cfg`, or select a private Python configuration file:

```powershell
$env:DASHBOARD_CONFIG = 'C:\private\ssis-dashboard-config.cfg'
```

Set `CONNECTION_STRING['main']` to the approved SSISDB connection using an installed matching-architecture driver and the intended SQL identity. Keep credentials out of Git and logs. List installed driver names with `python -c "import pyodbc; print(pyodbc.drivers())"`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `DEBUG` | `False` | Local debugging only |
| `TRUSTED_HOSTS` | `['localhost', '127.0.0.1']` | Non-empty list of accepted Host names (ports ignored; IPv6 literals unsupported). Other hosts get 400, blocking DNS rebinding. Add a name only for a reviewed proxy/host that serves it |
| `DISPLAY_TIMEZONE` | `Europe/London` | Loadable IANA zone for API buckets and offset-free fixed dates; pinned `tzdata` supplies a fallback |
| `AS_OF_DATE` | `NOW` | Default API upper creation bound; a fixed date/time must resolve to one instant |
| `HOUR_SPAN` | `360` | Default elapsed-hour window; positive and no larger than `API_MAX_RANGE_HOURS` |
| `EXECUTION_COUNT` | `1000` | Legacy list limit; API pages use their own 50/200 limits |
| `DB_LOGIN_TIMEOUT_SECONDS` / `DB_QUERY_TIMEOUT_SECONDS` | `10` / `30` | Positive 32-bit integer driver limits; not an overall HTTP deadline |
| `API_MAX_RANGE_HOURS` | `744` | Maximum API creation-window span |
| `API_MAX_TIMELINE_BUCKETS` | `1000` | Allowed range 1–1000 |
| `API_READINESS_TIMEOUT_SECONDS` | `2` | Allowed 1–2; caps both readiness driver timeouts without increasing lower global limits |
| `API_EVENTS_ENABLED` | `False` | Permit API event text/search for the configured SQL scope |
| `API_VALUES_ENABLED` | `False` | Permit API nonsensitive parameters and override metadata |
| `API_OVERRIDE_VALUES_ENABLED` | `False` | Permit nonsensitive override values; requires values enabled |
| `API_CURSOR_SECRET_KEY` | `None` | Paging-cursor signing secret, at least 32 bytes; keep it private like the connection string. `None` uses a random key per process, so cursors fail across workers and after restart |
| `LOG_LEVEL` | `INFO` | Safe request/query events; validated Python logger level |

API capability settings require actual booleans. Sensitive values are always redacted. These API flags do not change legacy page access. The 14 Stage C GET operations plus the separate operational server-label GET are implemented; [the contract](API_CONTRACT.md) defines their selectors, paging and response semantics. Browser identity/proxy headers do not grant access or change SQL identity.

Defaults load first. An explicit `config_path` takes precedence over `DASHBOARD_CONFIG`; absent both, optional root `config.cfg` loads independently of the working directory. Relative explicitly selected paths are relative to the `dashboard` package. A missing explicitly selected or malformed config fails startup. `create_app({...})` uses defaults plus the mapping and skips automatic file loading; `create_app({...}, config_path=...)` applies the mapping after that file.

## Run locally

```sh
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Open [the native shell](http://127.0.0.1:5000/app/) after building the browser assets below, [the legacy dashboard](http://127.0.0.1:5000/) or [API metadata](http://127.0.0.1:5000/api/v1/meta). `run.bat` uses this loopback command. `python runserver.py` retains the Visual Studio entry point on port 5555 with `SERVER_HOST`/`SERVER_PORT` overrides. The WSGI object is `dashboard.wsgi:app` (IIS dotted form `dashboard.wsgi.app`); production launcher and legacy IIS runtime-path changes remain separate hosting work.

Supported legacy pages have an **Open native** navigation link. It opts in by adding the single query pair `native=1` to the old URL, then temporarily redirects to the native overview, execution or requested event/value tab. For example, `/folder/Finance/project/Load/status/failed?native=1` opens `/app/?folder=Finance&project=Load&status=4`, retaining any application mount prefix. Plain legacy URLs still open the old UI. Do not combine this marker with other query parameters: legacy filter/search/sort queries are not native filters.

Independent legacy history bookmarks convert to `/app/history` in explicit LIKE mode, preserving `%`, `_`, bracket patterns and `*` as `%`. Their historically ignored status path stays ignored: converted bookmarks select Running/Succeeded (2/7). Ambiguous overview patterns still show **Native view unavailable**, with explicit legacy/native choices. Generated legacy links containing slash/backslash names use `/legacy/overview` or `/legacy/history` query aliases; these accept only their documented selectors and optional `native=1`, decode once and retain the deployment prefix. Original path routes remain available. Events/values still obey native capabilities, with no automatic legacy fallback. [The parity inventory](FRONTEND_PARITY.md#p47b-translation-contract) lists restrictions and intentional differences. The default homepage remains legacy.

The native overview has scope/filter controls, summary cards, an optional creation timeline and an execution table. The shared header shows application version, SQL server label, display timezone, **Overview**, **History**, **Theme** (System/Light/Dark) and **Legacy**; page status and Refresh/Pause controls sit beside the page title. The server label loads once in a separate request with a 10-second browser deadline and at most five-second driver limits; failure shows **Server unavailable** without blocking the page, polling or retrying. Shell/assets/settings remain database-free. Settings load once for limits, statuses, sorts, capabilities and timezone, followed by page data. Metadata failure offers **Retry settings**; invalid settings never use guessed defaults. System theme follows the device preference; theme is the only persistent preference and contains no catalog data.

**Folder** and **Project** in the title row open searchable scope pickers. Choosing a scope applies immediately; changing the folder clears its dependent project. Search scans bounded catalog pages, with **Search more** when only part has been scanned. **Use exact name** applies typed text, including a project across all folders. All folders/projects means unscoped; literal `all`, wildcard characters, plus and slash remain exact name characters in the native UI. Navigation failures have manual retry and a 15-second browser deadline; leaving cancels outstanding work.

**Status** permits multiple known statuses; **All statuses** clears specific codes. Changed choices apply on **Done**, clicking outside or tabbing out. Escape discards the draft and restores trigger focus. **Created** presets apply in one click. Today/Last 24 hours/Last 7 days/Last 30 days remain relative selections in the URL and resolve from server-anchored time on each first-page cycle; a deeper page retains its exact cursor window. **Default window** uses the server default. **Custom range** applies on **Use range**: calendar dates use the display timezone, date-only ranges include both dates, and **Include time** makes the end exclusive. A blank bound uses its server default. Repeated clock-change times require an occurrence choice; skipped times are rejected. **Exact timestamps** accepts RFC 3339 with Z/an offset and up to seven fractional digits, retaining unchanged precision and offsets. Explicit bounds stay fixed on refresh.

**Reset** clears status/time while keeping scope and table order. Scope/order actions consume an open Status draft in the same selection change; an unsubmitted custom-date draft remains separate. Back/Forward and reload restore the shareable applied selection/order/limit. Invalid URLs require **Reset invalid filters** and do not display a guessed fallback. The creation scope is inclusive at From and exclusive at To; the effective range appears above the cards. Cards count **all statuses** in the same folder/project/time cohort, even when the table selects one status. A zero-row table can therefore have nonzero cards. Unknown status codes remain visible and contribute to Total/Other.

Execution ID and entry-package links open native detail with the applied overview selection/order/limit as return context; they carry no page cursor, rows or unsubmitted date draft. A pointer action may commit an open Status draft before following the link. Folder/project row links apply that row's exact scope. Warn/Err count links open the corresponding detail Events category. Times use the display timezone in a fixed date/time format; complete dates and wire timestamps remain available in titles/time attributes. `—` means missing, actual zero remains zero, and active elapsed is labeled separately from actual duration. Each overview request has a 30-second browser deadline. Displayed retry actions rerun the failed resource; a failed summary retains valid rows, while denied access clears rows and counts. Selection changes cancel obsolete work. Supported column headers and the combined **Sort** selector change global server order immediately. **Rows** defaults to the server setting (normally 50), up to its maximum (normally 200). First/Previous/Next page controls use opaque cursors, with no total-page count or unbounded All. An expired page link resets once with a notice.

**Timeline** opens below its toolbar and loads calendar buckets across every execution page for the applied folder/project/status selection and exact creation bounds. Cards remain all-status. Choose **Day** or **Hour** under Interval. Stacked Succeeded/Failed/Other segments add up to Created; Other includes executions with other current statuses. The selected readout and **Data table** also show With an actual start. Counts concern executions created in the bucket, regardless of when they started/ended. Edge buckets can extend beyond the range but count only selected executions. Server zero buckets remain zero. Clock changes can produce 23/25-hour days, repeated hours with different UTC offsets, partial-hour transitions or skipped dates. An excessive Hour request displays an error; choose Day or narrow the range.

Select a bar with the pointer or keyboard arrows/Home/End, or use **Bucket**. **Data table** supplies every returned bucket and all four counts. Refresh preserves the selected UTC bucket and expanded table/scroll; a changed interval chooses a meaningful loaded bucket. An open timeline adds one serial read after list and summary under the existing schedule; a closed timeline adds none. Its **Retry** rereads that resource when the list is current. Temporary same-range errors may label a previous timeline; invalid data clears it, a changed effective range discards old counts, and denied access clears the overview. Summary retry also refreshes an open timeline. Chart choices and payloads stay out of URLs and persistent storage.

Open `/app/executions/{id}` directly for native execution detail, including under an application prefix. The ID must be a canonical positive BIGINT decimal string. The page reads settings then one execution, independently of overview filters, and shows package/environment identity, status/logging, actual timing and recorded event counts. `—` means missing; zero remains zero. Observed active elapsed is separate from actual duration. **Refresh**, **Pause/Resume auto refresh** and **Retry execution** share one operation with the same completion-based schedule/backoff as the overview. Each detail request has a 30-second browser deadline. A temporary failure may show a labeled previous same-ID observation; denial, absence or malformed data clears it and stops automatic retry. Leaving disposes requests, scheduling and listeners.

Six tabs share one refresh owner: **Events**, **Executables**, **Package calls**, **Parameters**, **Overrides** and **History**. A failed execution opens Errors when allowed; otherwise the default is Executables. A recognized bookmark fragment selects its permitted section/category. Only the active tab loads: a normal arrival/refresh reads base detail, then that section; a standalone tab change normally makes one section request. Disabled tabs show one capability note and described hints without denied-resource requests. Arrow keys/Home/End move through enabled tabs; the narrow tab strip scrolls to keep the selection visible. Switching tabs clears old rows and aborts obsolete section work. Section **Retry**, **Rows**, supported headers/Sort and First/Previous/Next controls operate independently; First page starts a fresh section cohort. A temporary section error may retain labeled rows; denial/invalid data clears them. An execution-scoped section 404 clears the execution; a global history 404 clears History only.

**Executables** shows bounded executable observations. Statistics IDs distinguish invocations even when an executable ID repeats. **Paths** retains exact package/execution paths. Started and Ended have separate one-line columns; actual Duration and executable Result remain separate. Missing observations, zero duration and unknown result codes remain distinct. Refresh retains the active page, focus, expanded paths and scroll. Recording coverage is independent of execution state.

**Package calls** shows starts observed under the parent execution, retaining repeated paths as separate observations. Readable call paths do not infer a complete graph. **Details** preserves observation ID, source metadata and exact raw paths, including missing/empty values. Started/Ended have separate columns. **Start/end recorded** means an unambiguous matched pair; **End unconfirmed** means no unambiguous end was observed. Neither is a child package result or an independent execution link. Unidentified starts are excluded from paging and coverage is labeled unknown.

**Events** requires event access. Changing **Category** applies immediately; **Search** or Enter commits **Search full messages**. Either starts page one. Search sends literal text, including whitespace/punctuation, and matches the complete source message even when only a truncated prefix is returned. Sort/page size/refresh retain applied filters. **Reset** clears category/search while keeping order and size. **View message** and **Source** retain returned text and exact metadata; missing and empty text stay distinct. Truncation and unknown coverage/unpageable event IDs are labeled. Search drafts, text and cursors stay out of URLs, history and storage; an actual retained document revalidates settings/data before restoring its in-memory view checkpoint.

**Parameters** requires value access and pages in fixed ascending parameter-ID order. Names, scope, catalog type labels and value strings retain their format, including decimal scale, binary text and line endings. Values distinguish **Redacted (sensitive)**, **Redacted (policy)**, **NULL (unredacted)** and **(empty)**. **View value** expands long returned text; truncation is explicit. Flags show Sensitive, Required, Value set and Runtime override. A refreshed redaction removes the previous value, including expanded/hidden text. Inactive or disabled tabs send no value request. Values stay out of URLs, history, storage and retained view checkpoints.

**Overrides** has independent ascending property-ID pages. Its three columns show property/ID, value and sensitivity. **View path** preserves the exact property path; **View value** expands permitted text. Redacted values have no reveal control. If value access is enabled but override-value display is disabled, metadata remains available with a policy hint; sensitive redaction takes precedence. Disabling value access disables both value tabs. Invalidated policy-bound cursors reset once to page one; a failed reset cannot retain old values. Checkpoints retain IDs/view anchors without property paths or values.

**History** reads the authorized detail's exact folder/project/entry package across all creation dates, independently of overview dates and event/value access. The UI explicitly selects **all known statuses** by default, including Failed; the API's omitted-status default remains Running/Succeeded (2/7). **All**, **Succeeded**, **Failed** and **Running** apply in one click. **Custom…** applies changed status choices on Done/outside/Tab, cancels with Escape and rejects an empty scope. The Execution header changes execution-ID direction; Rows and cursor controls keep a separate history path. The current execution is labeled/accented when loaded. Created, Started and Ended have separate one-line columns; Started/Ended may omit the date on the same display day, retaining full dates in titles. Actual duration and observed active elapsed remain distinct from estimated duration/end and the prior-success sample count. Unavailable estimates do not invent a reason. Estimates can change with visibility/retention. Per-run project version/environment/logging are available through each ID's detail; ID links retain the validated overview selection.

Open **History** in the header or `/app/history` for independent history across all creation dates. **Match** selects exact folder/project/package names or explicit SQL LIKE patterns (`*`/`%` any text, `_` one character, `[abc]` a set). **Load history** applies the three fields; unapplied drafts do not change the URL or requests. Fresh entry defaults to LIKE `*` and all known statuses. Each row displays its own package identity and estimates use only that exact package's prior visible successes. Status/order/size and scope are shareable; cursors/results remain private to the mounted page. Refresh keeps the current page; First page starts a fresh cohort. One request owns each cycle, with cancellation, pause, transient-error labeling and clearing on denial. An invalid URL requires a corrected Load history action. A linked execution offers **Back to History** with the validated selection and a fresh first page.

**Chart** compares actual and estimated duration for the loaded history page, with no extra request. Bars use status colors; dashed marks show estimates on the same scale, a circle marks actual zero and missing durations have no mark. The horizontal axis orders the loaded observations chronologically by Created/ID, independently of table direction. Pointer or arrows/Home/End select an execution; the readout gives actual/estimated duration and sample count. Active elapsed is never plotted as actual duration. The full history table remains available. Refresh keeps a loaded selected ID; a changed page selects a loaded fallback. Short projections are centered/capped; unavailable pages show text and actual zero retains its zero mark/label. Switching away from History or clearing it removes chart data; transient same-scope failures label retained data. No rows or estimates enter checkpoints, URLs or storage.

**Overview** opens the validated return filters at page one, or the default overview for a standalone/invalid context. Its `overview` URL parameter carries only selection/order/limit, never an arbitrary destination, page cursor or result data; it does not constrain the detail API read. **Legacy detail** opens the retained legacy route for broader parity checks, and remains available for comparison. Browser Back may re-fetch a retained overview's in-memory page path; a fresh return starts at page one. Detail pause, each table's page/query and view anchors are retained only in an actual cached document, after settings/data revalidation; actual visibility/cache acceptance remains open.

Missing, incomplete or invalid browser builds return an HTML **503 Application unavailable** with a legacy link and request ID on all three native screens; building again repairs the page without restarting Flask. Legacy/API/health routes remain available without a frontend build. If JavaScript does not start, the page retains its reload/legacy guidance; disabled JavaScript also displays a dedicated message.

`/healthz` and `/api/v1/meta` use no database. `/readyz` performs one zero-row SSISDB dependency check, independent of visible row count. Readiness is not workflow or hosting acceptance. API errors use safe `application/problem+json`; successes and failures have no-store and a server-generated request ID. Invalid inputs and denied capabilities fail before SQL.

## Build the browser assets

Frontend build tools are for developers only. Use **Node 22 LTS, at least 22.12.0 and below 23, with npm 10**; the local D1a baseline is Node 22.19.0 / npm 10.9.3 on Windows x64. `web/package.json` pins Vite 8.3.4, `web/package-lock.json` locks its dependency graph and integrity hashes, and `.npmrc` checks the supported engine range. No frontend framework or runtime package is installed.

From the repository root:

```sh
npm --prefix web ci
npm --prefix web run build
npm --prefix web test
python -m unittest tests.test_frontend_assets
```

`npm ci` replaces `web/node_modules/` from the lockfile. The source entry is `web/src/main.js`, with authored `styles.css` and vanilla ES modules. Production builds empty **only** `dashboard/static/app/` and generate `manifest.json`, hashed JS/CSS under `assets/` and `LICENSES.txt` for the bundled Vite modulepreload polyfill. The entire generated directory is ignored by Git; track source, build configuration and the lockfile in `web/`. Rebuild before packaging and include the complete updated output in the prepared application delivery. Frontend source uses LF line endings across platforms. Other legacy static directories remain outside the build output.

**Application deliveries must include prebuilt `dashboard/static/app/` files alongside the Python application.** A source checkout requires the build commands above to produce them; deployment copying or archiving must retain the generated directory even though Git ignores it. Running the prepared application requires neither Node, npm nor `web/node_modules/`. The manifest maps `src/main.js` to its JS, CSS and imported chunks; Flask's shell uses its static endpoint to add the deployment prefix. Generated asset imports use a relative base, so a mounted deployment does not need a separate frontend build. The shell also supplies prefix-aware application/API/execution-link bases as JSON. The development HTML is excluded from production output.

For source development, run Flask on `127.0.0.1:5000` as above, then in another terminal:

```sh
npm --prefix web run dev
```

Open [the development harness](http://127.0.0.1:5173/). Vite listens only on loopback, uses a strict port, serves native modules/HMR, and proxies `/api/v1/…` to `http://127.0.0.1:5000` with the path/query intact. The harness's metadata link checks that connection without SQL; its dashboard link opens Flask's built `/app/` page. To inspect changes in that page, rebuild and reload it; Vite's separate harness is for module/proxy development checks. No browser CORS setting or production Vite server is needed. HMR updates code; the overview's refresh controls update data. Stop each task-owned server with Ctrl+C when finished, and verify it exited.

Use Node's built-in `node:test` runner for focused frontend checks; run the build first, as its packaging check requires the generated manifest, JS/CSS and notice. Request/metadata/display tests cover safe failures, exact wire values, timezone projection, cancellation, deadlines and manual retry. The native-fetch and Vite development/proxy tests own ephemeral loopback listeners and close them. Flask's existing unittest suite checks packaged manifest assets at root and a simulated `/dashboard` mount without SQL or Node. On an unbuilt source checkout only those two asset tests skip; a present but incomplete build fails. These tests do not establish browser interaction, independent-reader HTTP or real SSISDB acceptance.

Refresh updates the current overview without a page reload. Page one re-resolves default/relative bounds; later pages replay their cursor and exact window. First page starts a new cohort. A temporary failure labels retained rows/counts as previous observations with update times; a changed window discards old counts, and denial clears the data. Unsubmitted date edits remain separate. Returning from detail can restore an in-memory page/view checkpoint only when the browser retains its back/forward cache; otherwise the URL selection starts at page one. This behavior has separate actual-cache acceptance below.

Automatic refresh uses the same operation. Its timer waits at least **30 seconds after the complete overview cycle**, including the timeline when open, extending to five times a slow cycle's cost. Consecutive temporary failures back off through 30/60/120/240/300 seconds; all delays are capped at five minutes. The next attempt and resource update/error state appear with the table. **Pause auto refresh** leaves manual Refresh available and applies across selection changes. **Resume auto refresh** updates immediately when idle or joins current work. Hidden tabs stop scheduled polling; returning requests one resync, unless user-paused or stopped by a nonretryable error. A current cycle may finish while hidden/paused. Denied access or an invalid response stops automatic retries; use the displayed retry action, change selection or pause/resume after the cause is resolved. Pause is an in-memory preference carried only through a retained browser-cache checkpoint, never stored in the URL or persistent storage; a fresh reload enables automatic refresh. In-app browser controls, focus/scroll, retries and narrow layout pass locally; actual hidden-tab, cached return and corporate-browser checks remain [open](PROGRESS.md#remaining-browser-acceptance).

For remaining real-browser checks, use [Frontend acceptance](FRONTEND_ACCEPTANCE.md): actual visibility/cache proof, request sequences, failure fixtures and evidence are separate. Environment-dependent checks are parked for user review as of 18 October 2026. [P4.7c](FRONTEND_PARITY.md#p47c-local-integration) records the SQL-blocked local workflow/bookmark replay; enabled native event/value acceptance retains its gap. Standalone history, absent server/version labels and existing legacy prefix limitations remain explicit [cutover gaps](FRONTEND_PARITY.md#remaining-gaps-and-documentation-work), not permission to retire legacy.

`web/node_modules/`, npm caches and test evidence remain ignored. If a local npm cache is needed, pass `--cache .local/npm-cache` to root-level npm commands. Disposable build experiments belong under `.local/tmp/`; retain selected build hashes, sizes and logs under `.local/reports/frontend/`. Pin updates require a clean `npm ci`, rebuild, frontend/backend checks and review of the generated assets. See the [Vite backend integration guide](https://vite.dev/guide/backend-integration.html) for manifest semantics.

## Test and diagnose

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

The tracked suite is database-free and includes legacy pages, API routes, schemas/examples, inputs, typed serialization, cursor/redaction rules and fake-driver cleanup. Native SQL, actual reader sign-in and network checks have separate evidence in [API acceptance](API_ACCEPTANCE.md) and the [backend checklist](BACKEND_CHECKLIST.md). Local native helpers and evidence are under ignored `.local/backend-validation/`; do not treat their absence in a fresh checkout as a unit-test prerequisite.

Application logs emit `query_completed`, `request_completed`, `database_error` and `request_error`, correlated by `X-Request-ID`. Query timing includes acquisition through cleanup; request timing ends at response preparation. Logs retain resource/endpoint labels, outcomes, counts, SQLSTATE and bounded exception locations, excluding raw URLs, inputs, SQL, messages, values and diagnostic exception text. External host/proxy/access logs require separate validation. Explicit `PROPAGATE_EXCEPTIONS=True` with debug/testing restores local exception propagation; production retains safe responses.

## Local artifacts

All private tools, evidence and configuration stay ignored. Commit sanitized results to [API validation](API_ACCEPTANCE.md) or the [backend checklist](BACKEND_CHECKLIST.md); keep milestone status in [PROGRESS](PROGRESS.md).

| Material | Location and retention |
| --- | --- |
| Python runtime and environment | `.local/python-3.14.8/` (CPython 3.14.8 x64) and the single `.local/venv314/` built from it with `requirements-dev.txt`. Rebuild that environment instead of adding another. |
| Working configuration, SSIS fixture and workstation recovery kits | `.local/backend-validation/dashboard.cfg`, `.local/ssis-fixture/` and `.local/recovery/<kit>/`. Keep their paths; they are not cleanup targets. |
| Offline npm cache | `.local/npm-cache/`, used by the frontend build verifier's `npm ci --offline`. Repopulate it from the lockfile instead of letting it accumulate. |
| Reusable helpers | `.local/tools/`; related native probes stay together in `.local/backend-validation/tools/` for shared imports. |
| Disposable experiments, extracted copies and intermediate output | `.local/tmp/<task>-<run>/`; remove after selecting useful evidence. |
| Selected native evidence | `.local/backend-validation/runs/<milestone>-<UTC>/`; retain inputs/source version, outcomes, raw measurements and limitations together. |
| Closed historical evidence | `.local/backend-validation/archive/`; ZIP archives retain original bytes and a per-file SHA-256 manifest. |
| Offline reports and cleanup receipts | `.local/reports/<topic>/`; keep one current summary and the evidence it references. |

Create output directories in the probe's execution entry point, not during shared-module import. A running task puts `.active` in its temporary directory and removes it only after owned processes have exited. Check ownership before cleanup; markers do not discover unmarked legacy processes. Do not reuse another task's output directory or classify a run as failed merely because its filename says `fixtures`.

Use `.local/venv314` or another verified environment. Contract tools use the checked-in `requirements-dev.txt` / `constraints-dev.txt` and `python -m unittest tests.test_api_contract`; do not maintain another `pip --target` package tree or regenerate the current contract from an old draft-authoring script.

### Cleanup and recovery

The ignored helper below is available in this working copy. It needs only Python's standard library and is not a fresh-checkout prerequisite. From the repository root:

```powershell
$pythonExe = '.local/venv314/Scripts/python.exe'
& $pythonExe -B .local/tools/organize-local.py --preview
& $pythonExe -B .local/tools/organize-local.py --apply PATH_TO_PRINTED_PLAN
& $pythonExe -B .local/tools/organize-local.py --index
& $pythonExe -B .local/tools/check-docs.py
```

The default preview selects bytecode caches, unmarked temporary output and empty native-run directories. Apply checks the absolute root, rejects links/junctions, and rejects files added or changed since preview. It never automatically removes a nonempty evidence run, environment, configuration, tool or report. `-B` avoids recreating bytecode during short maintenance commands.

For milestone closure, review completed runs and their references first. Put selected directory names in an ignored JSON list and pass `--preview --archive-runs PATH_TO_LIST`. Keep active runs, current acceptance/workload inputs and hard-coded tool inputs unpacked. Apply writes and reads back the ZIP, verifies every SHA-256 and rechecks originals before removing them. A new preview is required after source changes; an interrupted apply may leave both an archive and originals for inspection.

The local `backend-validation/runs/INDEX.md` distinguishes unpacked and archived evidence. Restore one run to its original path before using a historical helper:

```powershell
& $pythonExe -B .local/tools/organize-local.py --restore PATH_TO_ZIP RUN_DIRECTORY_NAME
```

Restore verifies hashes and refuses to overwrite changed content. Retain the ZIP for the other runs. Historical reports keep their original paths and dates; archive location does not change a validation result. Keep older one-off migration/verifier scripts with their dated records, not as current workflow entry points.
