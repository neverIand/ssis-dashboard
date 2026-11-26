ssis-dashboard-next v 0.6.8 Beta
=========================================

A web dashboard and a read-only REST API for monitoring SQL Server Integration Services (SSIS) package executions in the SSIS catalog (SSISDB).

The `dev-next` branch adds a new dashboard at `/app/` (overview, execution detail and package history) and a versioned API under `/api/v1/`. The legacy dashboard stays available at `/` until the new one replaces it.

## Requirements

* SQL Server 2016 or later (the minimum engine version for the native queries) with the SSIS catalog (SSISDB)
* Standard CPython 3.14.10 or a later 3.14 maintenance release, and a SQL Server ODBC driver of the same architecture
* Node 22.12.0 or a later 22.x release with npm 10, only to build the browser assets (`npm ci` enforces this range)
* A current browser: Chrome or Edge 143, Firefox 146, Safari 26.2 or later

Validated and observed versions, and the other details, are in [installation](docs/installation.md#requirements).

## Quick start

From the repository root in PowerShell, with Python 3.14 selected by its path. The example assumes `.venv` does not exist; for an existing environment, remove it first or use the same new path in both the creation and activation commands:

```powershell
& 'C:\Path\To\Python314\python.exe' -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
npm --prefix web ci
npm --prefix web run build
```

Put the SSISDB connection in a `config.cfg` file in the repository root ([configure](docs/installation.md#configure)), then run:

```powershell
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Open http://127.0.0.1:5000/app/ for the new dashboard or http://127.0.0.1:5000/ for the legacy one.

## Documentation

* [Installation](docs/installation.md): requirements, environment, configuration, build, run and tests
* [Using the dashboard](docs/usage.md)
* [Documentation index](docs/README.md)
* [Roadmap](docs/roadmap.md) and [progress](docs/PROGRESS.md)
* [API contract](docs/API_CONTRACT.md) and [OpenAPI](docs/openapi.yaml)
* [Legacy reference](docs/legacy.md): legacy platforms, release notes and Docker image
