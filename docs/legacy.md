# Legacy reference

Release notes and container commands below describe historical upstream releases. Use [installation](installation.md) for `dev-next`. The checked-in Ubuntu 16.04/Python 3.6 container recipe does not support the current runtime pins; a new container and production startup remain deferred B5c work in [progress](PROGRESS.md).

## Release notes

### v 0.6.7 Beta

* Fixed sql scripts so that they works well with ODBC drivers (both on linux and windows)
* Added support for Docker
* Reorganized documentation

### v 0.6.6 Beta

* Improved configuration management. Now confguration is read from config.cfg, which is NOT included in the GitHub repository. This is a step need to make easier to download updted version directly from GitHub.
* Added support for Google Analytics

### v 0.6.5 Beta

* Moved to Roboto font for better readability
* Navigation menu correctly sort items (Issue #19)
* Started using pylint to have cleaner code

### v 0.6.4 Beta

* Updated to Python 3
* Dropped usage of MetisMenu in favor of SmartMenus
* Added package execution chart
* Moved the package execution details in a dedicated page
* Added the ability to display all events
* Added a page to show parameters execution values and parameter overrides
* Code cleanup and refactored

### v 0.6.3 Beta

* Added first support to show/hide navigation panel
* Included Environment informations in package list (Issue #5)
* Upgraded to Font Awesome v 4.5.0
* Upgraded to Bootstrap 3.3.6
* Added refresh page button

### v 0.6.1 Beta

* Updated Morris.js to v 0.5.1
* Updated MetisMenu to v 1.1.1
* Added information on "Child" Packages
* Added more detail to the "Package Execution History" page. Also added an estimated end time / elapsed time for running packages, using a moving average of 7 steps.
* Added navigation sidebar in the main page that shows available folders and projects
* Added support for folders and project filtering
* Changed configuration file in order to comply with Python/Flask standards
* Cleaned Up code in order to follow Python best pratices (still a lot to do :))

### v 0.5.2 Beta

Added support for "\*" wildcard in project names. Now you can filter a specific project name using an url like:
```
http://<yourserver>/project/MyPro*
```
Added initial support for Package Execution History. Just click on a package name and you'll see its latest 15 executions

### v 0.4 Beta

First public release

## Legacy Docker

These commands refer to the published `yorek/ssis-dashboard` image and do not validate the current checkout.

Download and install Docker (Community Edition is enough):

[Docker](http://www.docker.com)

Once Docker is running, pull the docker image:

```
docker pull yorek/ssis-dashboard
```

### Create configuration file
After image is downloaded, create a `config.cfg` configuration file just by copying and pasting the `config.py` file. Remove all the options you don't want to change. Make sure that you use an ODBC driver that is actually loaded on the docker image. You can get a list of available ODBC drivers via running the container and querying pyodbc directly:

```
docker run -it yorek/ssis-dashboard python3
```

and once you are into the container:

```
import pyodbc
pyodbc.drivers()
exit()
```

the result will be something like:

```
['ODBC Driver 13 for SQL Server']
```

That's the driver you want to use in your connection string to connect to SQL Server or Azure SQL, for example:

```
DRIVER={ODBC Driver 13 for SQL Server};SERVER=localhost;DATABASE=SSISDB;UID=;PWD=
```

### Run dashboard
You can now run it using the following options

```
docker run -d -p 127.0.0.1:5000:5000 --name ssis-dashboard -e DASHBOARD_CONFIG=config.cfg -v <path-of-created-config.cfg>:/usr/src/app/dashboard/config.cfg yorek/ssis-dashboard
```

Once the container is running you can connect to the dashboard via the following url:

```
http://localhost:5000/
```
