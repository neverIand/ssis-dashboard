ssis-dashboard-next v 0.6.8 Beta
=========================================

The purpose of this project is to provide a web-based, user-friendly, useful and nice looking SQL Server Integration Services Dashboard and a set of REST API to monitor execution of SQL Server Integration Services Packages.

![Sample Screenshot](https://cloud.githubusercontent.com/assets/2612362/4003128/76e6869e-2973-11e4-9629-2bf45acd1141.png)

## Legacy Supported Environments

* SQL Server 2012
* SQL Server 2014
* SQL Server 2016
* SQL Server 2017
* SSIS on Azure Data Factory V2 (https://docs.microsoft.com/en-us/azure/data-factory/)

## Documentation

* [Install, Configure & Run](docs/installation.md)    
* [Install, Configure & Run on Docker](docs/docker-support.md)
* [Release Notes](docs/release-notes.md)
* [Roadmap](docs/roadmap.md)
* [Modernization Plan](docs/MODERNIZATION_PLAN.md)
* [Implementation Progress](docs/PROGRESS.md)
* [Draft Read-only API Contract](docs/API_CONTRACT.md) and [OpenAPI](docs/openapi.yaml)
* [Backend Validation: Checklist, Procedures & Results](docs/BACKEND_CHECKLIST.md)
* [SSIS Test Project Guide](docs/SSIS_FIXTURE_PROJECT_GUIDE.md)

## Development on dev-next

Create and activate a fresh standard CPython 3.14 virtual environment, then install the runtime dependencies and run locally:

```sh
python -m pip install -r requirements.txt
python -m flask --app dashboard:create_app run --host=127.0.0.1
```

Run the database-free tests with the standard library test runner:

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

See [installation](docs/installation.md) for configuration and environment setup. Python 3.14.8 on Windows x64 passes the database-free suite; real SSISDB and production hosting checks remain tracked work.

## Legacy Platforms & Tools

The legacy dashboard was built using:

* Python 3.6: https://www.python.org/ 
* Flask 0.12.2: http://flask.pocoo.org/ 
* PyODBC 4.0.17: https://github.com/mkleehammer/pyodbc
* SB Admin 2 Template: http://startbootstrap.com/template-overviews/sb-admin-2/

The IDE used to build the project is Visual Studio 2017 (that's why you can see the `runserver.py` file), though now I'm also using Visual Studio Code
