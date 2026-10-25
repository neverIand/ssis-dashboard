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

API capability settings require actual booleans. Sensitive values are always redacted. These API flags do not change legacy page access. All 14 Stage C GET operations are implemented; [the contract](API_CONTRACT.md) defines their selectors, paging and response semantics. Browser identity/proxy headers do not grant access or change SQL identity.

Defaults load first. An explicit `config_path` takes precedence over `DASHBOARD_CONFIG`; absent both, optional root `config.cfg` loads independently of the working directory. Relative explicitly selected paths are relative to the `dashboard` package. A missing explicitly selected or malformed config fails startup. `create_app({...})` uses defaults plus the mapping and skips automatic file loading; `create_app({...}, config_path=...)` applies the mapping after that file.

## Run locally

```sh
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Open [the native shell](http://127.0.0.1:5000/app/) after building the browser assets below, [the legacy dashboard](http://127.0.0.1:5000/) or [API metadata](http://127.0.0.1:5000/api/v1/meta). `run.bat` uses this loopback command. `python runserver.py` retains the Visual Studio entry point on port 5555 with `SERVER_HOST`/`SERVER_PORT` overrides. The WSGI object is `dashboard.wsgi:app` (IIS dotted form `dashboard.wsgi.app`); production launcher and legacy IIS runtime-path changes remain separate hosting work.

Supported legacy pages have an **Open native** navigation link. It opts in by adding the single query pair `native=1` to the old URL, then temporarily redirects to the native overview, execution or requested event/value tab. For example, `/folder/Finance/project/Load/status/failed?native=1` opens `/app/?folder=Finance&project=Load&status=4`, retaining any application mount prefix. Plain legacy URLs still open the old UI. Do not combine this marker with other query parameters: legacy filter/search/sort queries are not native filters.

Independent history bookmarks and ambiguous legacy name patterns have no equivalent native destination. Conversion shows **Native view unavailable**, with explicit **Open legacy page** and **Open native overview** choices. The legacy choice clears the query while keeping the original encoded path. Events/values still obey native API capabilities, even when the legacy page was readable; disabled sections remain labeled and never trigger automatic legacy fallback. [The parity inventory](FRONTEND_PARITY.md#p47b-translation-contract) lists supported routes, conservative name restrictions and remaining differences. This opt-in conversion does not change the default homepage or finish parity/cutover acceptance.

The native overview has filters, summary cards, an optional creation timeline, an execution table and a compact header with load state, timezone and a **Legacy** link. It loads API metadata once for limits, statuses, sorts, capabilities and display timezone, then requests the first execution page and an all-status summary using that page's exact effective creation bounds. Shell/assets/metadata do not query SQL; navigation, rows and displayed metrics read the catalog. Metadata failure or a 10-second browser deadline displays a safe message, a valid request ID when available and **Retry settings**. Missing or invalid settings never use guessed configuration defaults.

Type an exact folder/project name or choose one from the current page's dropdown. **Previous/Next** browse choices without fetching the whole catalog. Confirm a folder to browse its projects; changing it clears the previous project. Blank names mean all, while a literal `all`, wildcard character, plus or slash remains part of a name. Status checkboxes permit multiple choices; **All statuses** clears specific codes. **Apply** updates the shareable URL, shows the applied scope and loads rows/cards; edits remain separate until then. Back/Forward and reload restore it, including sort/direction/limit URL parameters. Invalid URLs require **Reset filters**; invalid edits keep the earlier applied scope. Navigation failures have manual retry and a 15-second browser deadline; leaving the page cancels outstanding work.

For **Custom window**, enter RFC 3339 timestamps with Z or an explicit offset and up to seven fractional digits. A blank bound uses its server default; leave both bounds omitted with **Default window**. Original timestamp strings retain their precision and offset. The table's creation scope is inclusive at From and exclusive at To; the effective range appears above the cards. Cards count **all statuses** in that folder/project/time cohort, even when the table selects only one status. A zero-row table can therefore have nonzero cards. Unknown statuses remain visible and contribute to total.

Execution IDs open native detail with the applied overview filters/order/limit as return context; pending edits are excluded. Times use the displayed timezone and browser locale. `—` denotes a missing observation, while actual zero remains zero; active elapsed time is labeled separately from actual duration. Each overview request has a 30-second browser deadline. **Retry executions** reruns the applied selection after list failure. A failed summary leaves valid current rows visible and offers **Retry summary** for the same exact bounds; denied access clears both rows and counts. Selection changes cancel and clear obsolete work. The table has server-backed order, page-size and Previous/Next controls, plus manual and automatic data refresh described below.

**Show timeline** loads calendar buckets for the applied folder/project/status selection across every execution page, using the exact creation range displayed above the cards. Cards remain all-status. Choose **Day** or **Hour**, then **Series** for Created, With an actual start, Currently succeeded or Currently failed. These are counts of executions created in each bucket, regardless of when their start/end occurred. Edge buckets can extend beyond the range but count only selected executions. Server zero buckets remain zero; clock changes can produce 23/25-hour days, repeated hours with different UTC offsets, partial-hour transitions or skipped dates. An excessive Hour request displays an error; choose Day or narrow the creation range.

Use the native **Selected bucket** control by keyboard, click a bar, or expand **Data table** for every returned bucket and all four counts. Refresh preserves the series, selected UTC bucket and expanded table/scroll. An open timeline adds one serial read after list and summary under the existing schedule; a closed timeline adds none. **Retry timeline** rereads that resource when its list is current. Temporary same-range errors may label a previous timeline; invalid data clears it, a changed effective range discards old counts, and denied access clears the entire overview. Summary retry also refreshes an open timeline. Chart choices and payloads stay out of URLs and persistent storage.

Open `/app/executions/{id}` directly for native execution detail, including under an application prefix. The ID must be a canonical positive BIGINT decimal string. The page reads settings then one execution, independently of overview filters, and shows package/environment identity, status/logging, actual timing and recorded event counts. `—` means missing; zero remains zero. Observed active elapsed is separate from actual duration. **Refresh**, **Pause/Resume auto refresh** and **Retry execution** share one operation with the same completion-based schedule/backoff as the overview. Each detail request has a 30-second browser deadline. A temporary failure may show a labeled previous same-ID observation; denial, absence or malformed data clears it and stops automatic retry. Leaving disposes requests, scheduling and listeners.

**Show executable observations** loads a bounded page only when opened. Statistics IDs distinguish invocations even when an executable ID repeats. Expand **Paths** for exact package/execution paths; **Timing** stacks Started above Ended, with actual Duration and executable Result separate. Sort, direction and rows per page use the server contract. **Previous/Next** preserve the page cohort; **Show latest** starts page one. An expired page link resets once with an explanation. Refresh reads base detail then the open page, retaining its focus, paths and scroll. A closed section adds no request. A temporary section failure may retain labeled prior rows; section denial or malformed data clears the table, while section 404 clears the execution.

**Show package calls** opens a separate bounded page under the same parent execution. Observation IDs identify recorded starts; repeated paths stay separate. **Start/end recorded** means matching start/end events, and **End unconfirmed** means no unambiguous end was observed. Neither is a package result or an independent execution link. Timing remains stacked, source metadata keeps missing/empty values, and unidentified starts are explicitly excluded from paging with unknown coverage. Tables keep independent order/page/expanded-path state, sharing one refresh cycle: base detail, then each open table serially. Closed tables add no request.

**Show events** loads a bounded event page only when event access is enabled. **Category** and **Search full messages** are drafts until **Apply filters**; applying either starts page one. Search sends literal text to the server, including whitespace and punctuation, and matches the complete source message even when only a truncated prefix is returned. Sort/page-size changes and refresh keep the applied filters. **Reset filters** clears category/search while keeping order and page size. Expand **View message** or **Source** for returned text and exact metadata; missing and empty text remain distinct. The page labels truncation, unknown coverage and matching events without pageable numeric IDs. Disabling event access sends no event request and shows an unavailable state. Search drafts, event text and event cursors are kept out of URLs, history and storage; an actual retained document revalidates settings/data before restoring its in-memory checkpoint.

**Show parameters** opens an independent bounded page when value access is enabled. Parameter IDs always sort ascending; page size, Previous/Next and Show latest use the existing server cursor. Names, catalog type labels and value strings retain their exact format, including decimal scale, binary text and line endings. Values distinguish **Redacted (sensitive)**, **Redacted (policy)**, **NULL (unredacted)** and **(empty)**. Expand **View value** for the returned prefix and **View flags** for sensitivity, Required, Value set and Runtime override; truncation is explicit. A refreshed redaction removes the previous value, including expanded/hidden text. Closed or disabled parameters send no value request. The table joins the same serial refresh cycle and keeps values out of URLs, history, browser storage and retained view checkpoints.

**Show overrides** opens a separate property-ID page with its own size and Previous/Next/Show latest controls. The three columns show property/ID, value and sensitivity. **View path** preserves the exact returned property path; **View value** expands long permitted text. Redacted values have no reveal control. If value access is enabled but override-value display is disabled, property metadata remains available and a policy hint explains the hidden values; sensitive redaction takes precedence. Disabling value access makes both value sections unavailable. Invalidated policy-bound page links reset once to page one; a failed reset cannot retain old values. Refresh includes only open sections, serially, and checkpoints retain IDs/view anchors without property paths or values. The remaining parity workflows retain Legacy detail.

**Show package history** opens the exact entry package across all creation dates, with Running and Succeeded selected by default. Edit **History statuses**, then **Apply statuses**; changing direction or page size keeps the applied scope and any pending status draft. Previous/Next and Show latest keep a separate execution-ID cursor path. History does not require event/value access. Created, Started and Ended are stacked; actual duration and observed active elapsed remain separate from estimated duration/end and the number of prior successful samples. Unavailable estimates can reflect missing start/samples, a zero mean or an out-of-range end; the server does not identify which reason applies. Estimates can change with current visibility and retention. Execution IDs link to native detail with the validated overview return selection.

**Show duration chart** compares actual and estimated duration for the currently loaded history page, without another request. Grey and indigo bars use the same duration scale; a circle marks actual zero, and missing durations have no mark. The **Selected execution** control works by keyboard, or click a bar to inspect its actual/estimated duration and prior-success sample count. Observed active elapsed is labeled separately and never used as actual duration. Full values and timestamps remain in the history table. Refresh preserves the selected execution when it remains loaded; a changed page chooses a loaded ID. Closing history or clearing its page removes the plot, while a temporary same-scope failure labels retained data. Chart choices remain in memory, with no rows or estimates in retained checkpoints, URLs or storage. Full workflow/bookmark parity remains subsequent work.

**Overview** opens the validated return filters at page one, or the default overview for a standalone/invalid context. Its `overview` URL parameter carries only selection/order/limit, never an arbitrary destination, page cursor or result data; it does not constrain the detail API read. **Legacy detail** opens the retained legacy route for broader parity checks, and remains available for comparison. Browser Back may re-fetch a retained overview's in-memory page path; a fresh return starts at page one. Detail pause, each table's page/query and view anchors are retained only in an actual cached document, after settings/data revalidation; actual visibility/cache acceptance remains open.

Missing, incomplete or invalid browser builds return an HTML **503 Application unavailable** with a legacy link and request ID on both native screens; building again repairs the page without restarting Flask. Legacy/API/health routes remain available without a frontend build. If JavaScript does not start, the page retains its reload/legacy guidance; disabled JavaScript also displays a dedicated message.

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

On `/app/`, Folder and Project in the title row are searchable scope pickers. Choosing a scope updates results immediately; changing the folder clears its project. Search continues through bounded catalog pages, with Search more when the catalog is only partly scanned. Use exact name applies the typed name, including a project across all folders. Literal `all` remains distinct from All folders/projects.

Status and Created open compact editors. Use range accepts a date draft; Apply commits pending status/time edits. Scope and table-order changes preserve those drafts. Reset filters clears status/time while keeping scope and table order. Calendar dates use the timezone shown in the global header. Date-only ranges include both dates; Include time makes the end exclusive. A blank bound uses its server default. Repeated clock-change times require an occurrence choice, and skipped times are rejected. Exact timestamps can be expanded when needed and preserve offsets and up to seven fractional digits. Today/Last 24 hours/Last 7 days/Last 30 days resolve once from server time to a fixed range; Default window continues to move with refresh.

The table's Sort, Direction and Rows per page controls immediately update the applied scope and start at page one, preserving pending filter edits. Page size defaults to the server setting (normally 50) and accepts integers up to its maximum (normally 200). Next/Previous request the global server order with opaque cursors; no total page count is available. Back/Forward can replay a recent in-memory page path; reload starts at page one. An expired page link resets once with a visible notice. Use Show latest to start a new first page, including a newly resolved default creation window. Results and all-status cards observe the live catalog separately.

Refresh updates the current overview without a page reload. On page one it re-resolves default bounds; on later pages it replays the existing cursor and exact window. A temporary failure labels retained rows/counts as previous observations with their update times. A changed window discards old counts, and denied access clears the data. Pending filter edits are preserved. Returning from a detail page can restore an in-memory page/view checkpoint when the browser retains its back/forward cache; otherwise the URL selection starts at page one.

Automatic refresh uses the same operation. Its timer waits at least **30 seconds after the complete overview cycle**, including the timeline when open, extending to five times a slow cycle's cost. Consecutive temporary failures back off through 30/60/120/240/300 seconds; all delays are capped at five minutes. The next attempt and resource update/error state appear with the table. **Pause auto refresh** leaves manual Refresh available and applies across selection changes. **Resume auto refresh** updates immediately when idle or joins current work. Hidden tabs stop scheduled polling; returning requests one resync, unless user-paused or stopped by a nonretryable error. A current cycle may finish while hidden/paused. Denied access or an invalid response stops automatic retries; use the displayed retry action, change selection or pause/resume after the cause is resolved. Pause is an in-memory preference carried only through a retained browser-cache checkpoint, never stored in the URL or persistent storage; a fresh reload enables automatic refresh. In-app browser controls, focus/scroll, retries and narrow layout pass locally; actual hidden-tab, cached return and corporate-browser checks remain [open](PROGRESS.md#remaining-browser-acceptance).

For the remaining real-browser checks, use [Frontend acceptance](FRONTEND_ACCEPTANCE.md): it separates actual visibility/cache proof, expected request sequences, failure fixtures and the evidence record. These environment-dependent checks are parked for user review as of 18 October 2026. Native overview/detail, observations, events, values, history and both charts have their recorded local checks in [progress](PROGRESS.md#phase-4--native-execution-workflows); native enabled event/value acceptance retains its gap. Full workflow and bookmark parity are subsequent tasks.

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
