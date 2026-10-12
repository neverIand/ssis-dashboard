# Local development on dev-next

Use the personal fork's `dev-next` branch. The first backend milestone is validated on Python 3.11 with Flask 3.1.2 and pyodbc 5.3.0. Python 3.14, dependency constraints, current container images, and shared production hosting remain tracked work in [implementation progress](PROGRESS.md); the legacy Python 3.6 instructions do not describe the new development environment.

## Create an environment

From the project root on Windows:

```bat
python -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
```

On other systems, activate `.venv/bin/activate` instead. A SQL Server ODBC driver and an SSIS Catalog are required for real monitoring pages; application construction and the test suite do not connect to SQL Server.

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

Execution routes accept positive SQL Server `BIGINT` IDs from 1 to 9,223,372,036,854,775,807. Zero and larger IDs return 400 before a query; negative or non-integer path segments do not match the existing route and return 404. Status names are case-sensitive: `all`, `created`, `running`, `cancelled`, `failed`, `pending`, `halted`, `succeeded`, `stopping`, or `completed`. Supported event categories are `all`, `errors`, `warnings`, `duplicate-warnings`, and `memory-warnings`. Event and internal detail operations select from fixed SQL resource maps. Unsupported selectors return 400 without querying SSISDB. This validation retains the existing history query's scope; the status path segment does not yet change its SQL filter.

Unknown pages, missing static assets, and unsupported HTTP methods return database-independent HTML errors. Execution details, events, and values first look up the requested execution; no visible record returns 404 and skips subsequent queries. This does not distinguish a missing execution from one hidden by catalog row visibility.

The application maps ODBC timeout states `HYT00`/`HYT01` to 504, connection states in class `08` and database-login/driver states `28000`/`IM002`/`IM003` to 503. Other driver errors and unexpected application failures return 500. SQL syntax/access errors are not assumed to be a browser authorization failure, and database login failures do not challenge the browser for credentials. These are application error-policy choices based on ODBC's [SQLSTATE definitions](https://learn.microsoft.com/en-us/sql/odbc/reference/appendixes/appendix-a-odbc-error-codes) and pyodbc's [exception mapping](https://github.com/mkleehammer/pyodbc/wiki/Exceptions); real driver/identity results still require integration checks.

Error pages use fixed safe messages, carry `Cache-Control: no-store`, and display a server-generated request ID matching `X-Request-ID`. HTTP exception headers such as 405's `Allow` are preserved, following Flask's [error-handler guidance](https://flask.palletsprojects.com/en/stable/errorhandling/). Database/unexpected-error log records include the request ID and safe status information; they omit exception text, SQL, values, credentials, and tracebacks. Detailed request/query timing remains a separate milestone. The current legacy responses are HTML; problem JSON, API access controls, and streaming errors belong to their later phases.

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
