# Local development on dev-next

Use the personal fork's `dev-next` branch. The preferred development runtime is standard, GIL-enabled **CPython 3.14**, validated on **3.14.8 / Windows x64** with Flask **3.1.3**, pyodbc **5.3.0**, and the complete runtime graph pinned in [`constraints.txt`](../constraints.txt). Native driver/catalog compatibility, current container images, and shared production hosting remain tracked work in [implementation progress](PROGRESS.md).

## Create an environment

Create a fresh environment when changing Python minor versions; use a new ignored path such as `.local/venv314` if `.venv` already belongs to another interpreter. From the project root on Windows, with a registered standard CPython 3.14 interpreter:

```bat
py -3.14 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

For an interpreter installed without launcher registration, use its full `python.exe` path in place of `py -3.14`. B5a2 used the official [CPython 3.14.8 NuGet package](https://www.nuget.org/packages/python/3.14.8) under `.local/python-3.14.8/`, then created `.local/venv-b5a2`. This follows Python's [local CI runtime documentation](https://docs.python.org/3.14/using/windows.html#the-nuget-org-packages) and does not require a system-wide installer or PATH change.

On other systems, use an explicitly selected standard CPython 3.14 interpreter and activate `.venv/bin/activate`; those platforms still need their own validation. A SQL Server ODBC driver and an SSIS Catalog are required for real monitoring pages; application construction and the test suite do not connect to SQL Server.

### Runtime and dependency policy

- Standard CPython 3.14 is the preferred development baseline. B5a2 validated Windows x64/3.14.8, the `cp314-win_amd64` ABI, matching pyodbc/MarkupSafe wheels, native imports, and all 77 database-free tests. B5a1's CPython 3.11.4 environment remains earlier compatibility evidence. Free-threaded builds, other platforms/architectures, and actual driver/catalog compatibility are unverified; native integration remains B5a3. Record the actual interpreter patch, architecture, and evidence when changing them.
- Python 3.6-era Visual Studio/IIS settings and the Ubuntu 16.04 Docker recipe are historical, unsupported configurations for this checkout. Current hosting is B5c work; installing the Python dependencies does not update those hosts or provide a production server.
- [`requirements.txt`](../requirements.txt) declares only Flask and pyodbc and automatically includes `constraints.txt`. The constraint file fixes all eight required runtime distributions, including transitive dependencies. Normal `python -m pip install -r requirements.txt` applies the reviewed pins; avoid separate unconstrained installs of Flask or pyodbc.
- Review stable published versions and their release notes before changing pins. The B5a1 snapshot includes the reviewed Flask 3.1.3, Werkzeug 3.1.9, MarkupSafe 3.0.4, and Click 8.5.0 updates. No optional Flask extras or additional test dependency is required; the tests use `unittest`. Installer/build tooling such as pip and setuptools is separate from the application runtime graph.
- These constraints make package-version selection repeatable; they do not lock interpreter/system-driver versions or wheel hashes. Native wheel/driver compatibility and production artifact validation require separate evidence. A wheelhouse belongs in the ignored `wheelhouse/` directory and contains platform/interpreter-specific artifacts.

This follows pip's [constraints-file semantics](https://pip.pypa.io/en/stable/user_guide/#constraints-files) and [repeatable-install guidance](https://pip.pypa.io/en/stable/topics/repeatable-installs/). Release information comes from the maintainers' [Flask](https://flask.palletsprojects.com/en/stable/changes/), [Werkzeug](https://werkzeug.palletsprojects.com/en/stable/changes/), [MarkupSafe](https://markupsafe.palletsprojects.com/en/stable/changes/), and [Click](https://github.com/pallets/click/releases/tag/8.5.0) releases, plus [pyodbc's published requirements and wheels](https://pypi.org/project/pyodbc/5.3.0/). Pin updates require a clean environment, dependency consistency, the database-free suite, and application entry-point checks before committing the new snapshot.

### Download and install offline

For an interpreter/platform with compatible published wheels, prepare the wheelhouse while online, then install into a new environment without using an index:

```sh
python -m pip download --only-binary=:all: --dest wheelhouse -r requirements.txt
python -m pip install --no-index --only-binary=:all: --find-links wheelhouse -r requirements.txt
python -m pip check
```

Download wheels using the intended interpreter and platform. `--only-binary=:all:` fails if a compatible wheel is unavailable; source builds and their toolchains are outside this validated workflow. The B5a1 clean install used pip 23.1.2, also worked from outside the project directory with an absolute requirements path, and matched every installed runtime distribution to its declared constraint. Repeating the install proposed no package changes. Recreate the environment when reviewing the graph so unused packages from an older installation do not obscure the result.

## Configure

The application starts with defaults from `dashboard/config.py`, including `DEBUG=False`. To configure SSISDB locally, copy the relevant options into the ignored project-root `config.cfg`, or use `DASHBOARD_CONFIG` to point to a private Python configuration file:

```bat
set DASHBOARD_CONFIG=C:\private\ssis-dashboard-config.cfg
```

Set `CONNECTION_STRING["main"]`, `HOUR_SPAN`, `AS_OF_DATE`, and `EXECUTION_COUNT` as needed. Keep connection strings and credentials out of Git. Explicit and environment file paths may be absolute; relative paths retain the legacy convention of being relative to the `dashboard` package. Without an explicit file or environment variable, the optional `config.cfg` is resolved at the project root, independent of the shell's working directory. A missing explicitly selected file or malformed Python configuration file fails startup; a missing optional root file uses defaults. Configuration loading does not modify `DASHBOARD_CONFIG` or print its contents.

For tests or programmatic construction, `create_app({...})` uses defaults plus that mapping and skips automatic environment/root-file loading. `create_app({...}, config_path=...)` explicitly loads the selected file before applying the mapping. Each app owns its configuration; monitoring reads the active Flask app context.

### Database timeouts and query resources

`DB_LOGIN_TIMEOUT_SECONDS` defaults to **10** and is passed to `pyodbc.connect(..., timeout=...)`. `DB_QUERY_TIMEOUT_SECONDS` defaults to **30** and is set on the connection before creating its cursor. Both must be positive integers from 1 to 2,147,483,647; zero (an unbounded timeout), booleans, strings, and fractions are rejected at application construction and by the standalone query operation. These are initial configurable limits to tune with the real catalog, not measured performance targets.

The limits are driver-level login/query settings, not an end-to-end HTTP deadline. Actual timeout enforcement must be checked with the deployed ODBC driver and SSISDB. See pyodbc's [connection timeout](https://github.com/mkleehammer/pyodbc/wiki/The-pyodbc-Module#connect) and [query timeout](https://github.com/mkleehammer/pyodbc/wiki/Connection#timeout) documentation.

SQL loads from package-relative `dashboard/query` resources, using UTF-8 with optional BOM, before opening a connection. Only flat `.sql` resource names are accepted. Each query explicitly attempts cursor and connection closing, including after execution/fetch failures; a cleanup error does not replace the original operation error. Transaction defaults, parameter binding, SQL text, and legacy dictionary/list/empty-result shapes are preserved.

### Legacy inputs and errors

Execution routes accept positive SQL Server `BIGINT` IDs from 1 to 9,223,372,036,854,775,807. Zero and out-of-range integer IDs that reach the view return 400 before a query. Negative or non-integer path segments do not match the route; segments exceeding Python's enabled integer-conversion limit also return 404. Status names are case-sensitive: `all`, `created`, `running`, `cancelled`, `failed`, `pending`, `halted`, `succeeded`, `stopping`, or `completed`. Supported event categories are `all`, `errors`, `warnings`, `duplicate-warnings`, and `memory-warnings`. Event and internal detail operations select from fixed SQL resource maps. Unsupported selectors return 400 without querying SSISDB. This validation retains the existing history query's scope; the status path segment does not yet change its SQL filter.

Unknown pages, missing static assets, and unsupported HTTP methods return database-independent HTML errors. Execution details, events, and values first look up the requested execution; no visible record returns 404 and skips subsequent queries. This does not distinguish a missing execution from one hidden by catalog row visibility.

The application maps ODBC timeout states `HYT00`/`HYT01` to 504, connection states in class `08` and database-login/driver states `28000`/`IM002`/`IM003` to 503. Other driver errors and unexpected application failures return 500. SQL syntax/access errors are not assumed to be a browser authorization failure, and database login failures do not challenge the browser for credentials. These are application error-policy choices based on ODBC's [SQLSTATE definitions](https://learn.microsoft.com/en-us/sql/odbc/reference/appendixes/appendix-a-odbc-error-codes) and pyodbc's [exception mapping](https://github.com/mkleehammer/pyodbc/wiki/Exceptions); real driver/identity results still require integration checks.

Error pages use fixed safe messages, carry `Cache-Control: no-store`, and display a server-generated request ID matching `X-Request-ID`. HTTP exception headers such as 405's `Allow` are preserved, following Flask's [error-handler guidance](https://flask.palletsprojects.com/en/stable/errorhandling/). Database/unexpected-error application events include the request ID and safe status information; they omit exception text, SQL, values, credentials, and tracebacks. The current legacy responses are HTML; problem JSON, API access controls, and streaming errors belong to their later phases.

### Request and query timing

Application event messages are JSON, correlated by the server-generated `X-Request-ID`. `LOG_LEVEL` defaults to `INFO` and accepts `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`. Logger levels configure Python's process-wide `dashboard` logger; request IDs/counters are context-local. `LOG_LEVEL` does not enable Flask's interactive debugger. The default Flask formatter may add its usual timestamp/level prefix around the JSON message; production formatting/collection remains a hosting choice.

| Event | Safe fields / meaning |
| --- | --- |
| `query_completed` | Resource basename, per-request index, `ok`/`error`/`cancelled` outcome, milliseconds, successful row count or null, failure stage, cleanup-failure flag, request ID |
| `request_completed` | Fixed endpoint name, standard method (unknown methods use `OTHER`), HTTP status or null for aborted dispatch, outcome, milliseconds, query count/failures/summed query milliseconds, request ID |
| `database_error` / `request_error` | Safe status and validated SQLSTATE where available; request ID; no original exception text or traceback |

Query timing starts after SQL-resource/parameter preparation, before connection acquisition, and finishes after cursor/connection cleanup. Counts include failed acquisition attempts. Empty successful results have zero rows; failures have null rows. A cleanup failure preserves the original query failure and sets `cleanup_failed`; timing observers cannot replace an active operation error. Ordinary log/observer failures do not change database results or HTTP errors. Cancellation still propagates after resources are closed.

Request timing ends at response preparation, includes query work and rendering, and excludes body transfer/network/stream lifetime. Query and request timers use a monotonic clock; they are not deadlines. Successful completions are INFO events; query failures, 5xx/aborted request completions, and safe errors are ERROR events. Raising `LOG_LEVEL` suppresses lower-level events.

Application events omit raw URLs/paths/query strings, request bodies/headers, SQL text/parameters, configuration content, credentials and row values. WSGI/proxy/access/startup output is separate and needs its own host review. Follow the tracked [manual backend checklist](BACKEND_CHECKLIST.md) for real driver/catalog, recovery, performance and host validation after the B milestones.

### Legacy query scope

Pages query only their displayed data and required shared navigation. A successful overview request uses six logical queries, execution details seven, an event page four, values five, and history two. These counts are regression-tested with synthetic query traces; they are not measured SQL Server timings. The complete before/after record is in [implementation progress](PROGRESS.md#b4-work-record).

The monitoring adapter provides explicit `get_aggregate_event_kpi()` and `get_execution_event_kpi(execution_id)` operations. The aggregate operation retains legacy folder/project/start-time filtering and binds SQL's internal `-1` aggregate selector. The execution operation accepts only a positive BIGINT ID and does not inherit the screen's folder/project or selected-execution filters. Other execution resource operations require a valid selected ID rather than silently querying execution zero. Overview status cards use their existing status-count query and do not request unused event KPIs. Checked-in SQL and existing history/time-filter semantics remain unchanged pending the API milestone.

## Run locally

```bat
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Open <http://127.0.0.1:5000/> with a working SSISDB configuration. `run.bat` invokes the same local command. `python runserver.py` remains available for Visual Studio at <http://127.0.0.1:5555/>; `SERVER_HOST` and `SERVER_PORT` retain their existing override behaviour. Both launchers use the application factory. Hosts requiring a WSGI application object should use `dashboard.wsgi:app` (IIS's dotted handler form is `dashboard.wsgi.app`); the legacy IIS Python path still needs the separate runtime/deployment milestone.

The Flask development server is for local development. Shared hosting requires the authorization and production-server/proxy work described in the [modernization plan](MODERNIZATION_PLAN.md).

## Run the database-free tests

```bat
python -m unittest discover -s tests -v
```

The tests use `unittest` and synthetic monitor data, render the existing templates, and reject ODBC connection attempts. No additional test dependency or live SQL Server is required. Real SQL/driver/authentication and deployment validation are separate integration checks.
