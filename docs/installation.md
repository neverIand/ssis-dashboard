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
