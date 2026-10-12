from datetime import datetime
import urllib.parse

from flask import abort, render_template
from dashboard.ssis import monitor
from dashboard.validation import event_query, status_code, validate_execution_id

# Set app version
version = "0.6.8 (beta)"

# Define routes
def packages(folder_name=monitor.all, project_name=monitor.all, status=monitor.all):
    status_code(status)
    folder_name = urllib.parse.unquote(folder_name)
    project_name = urllib.parse.unquote(project_name)

    m = monitor()
    m.folder_name = folder_name
    m.project_name = project_name
    m.status = status

    environment = {
        'version': version,
        'timestamp': datetime.now(),
        'project_name': project_name,
        'folder_name': folder_name,
        'status': status
        }

    engine_folders = m.get_engine_folders()
    engine_projects = m.get_engine_projects()
    engine_kpi = m.get_engine_kpi()
    engine_info = m.get_engine_info()
    execution_statistics = m.get_execution_statistics()
    package_info = m.get_package_info()
    package_kpi = m.get_package_kpi()
    package_list = m.get_package_list()
    package_executables = m.get_package_executables()
    package_children = m.get_package_children()

    return render_template(
        'index.html',
        environment=environment,
        engine_folders=engine_folders,
        engine_projects=engine_projects,
        engine_info=engine_info,
        engine_kpi=engine_kpi,
        execution_statistics=execution_statistics,
        package_info=package_info,
        package_kpi=package_kpi,
        package_list=package_list,
        package_children=package_children,
        package_executables=package_executables
    )

def folder_project_status(folder_name, project_name, status):
    return packages(folder_name=folder_name, project_name=project_name, status=status)

def folder_project(folder_name, project_name):
    return packages(folder_name=folder_name, project_name=project_name)

def folder(folder_name):
    return packages(folder_name=folder_name)

def _execution_monitor(execution_id):
    validate_execution_id(execution_id)
    m = monitor()
    m.execution_id = execution_id
    package_info = m.get_package_info()
    if not package_info:
        abort(404)
    return m, package_info


def execution(execution_id=0):
    m, package_info = _execution_monitor(execution_id)

    environment = {
        'version': version,
        'timestamp': datetime.now(),
        'execution_id': execution_id
        }

    engine_folders = m.get_engine_folders()
    engine_projects = m.get_engine_projects()
    engine_kpi = m.get_engine_kpi()
    engine_info = m.get_engine_info()
    execution_statistics = m.get_execution_statistics()
    package_kpi = m.get_package_kpi()
    package_list = m.get_package_list()
    package_executables = m.get_package_executables()
    package_children = m.get_package_children()

    return render_template(
        'execution-details.html',
        environment=environment,
        engine_folders=engine_folders,
        engine_projects=engine_projects,
        engine_info=engine_info,
        engine_kpi=engine_kpi,
        execution_statistics=execution_statistics,
        package_info=package_info,
        package_kpi=package_kpi,
        package_list=package_list,
        package_children=package_children,
        package_executables=package_executables
    )

def package_events(execution_id, event_type):
    event_query(event_type)
    m, package_info = _execution_monitor(execution_id)

    environment = {
        'version': version,
        'timestamp': datetime.now(),
        'execution_id': execution_id,
        'event_type': event_type
        }

    engine_kpi = m.get_engine_kpi()
    engine_info = m.get_engine_info()
    package_kpi = m.get_package_kpi()
    package_events = m.get_package_events(event_type)

    return render_template(
        'execution-events.html',
        environment=environment,
        engine_info=engine_info,
        package_info=package_info,
        package_kpi=package_kpi,
        package_events=package_events
    )

def package_execution_values(execution_id):
    m, package_info = _execution_monitor(execution_id)

    environment = {
        'version': version,
        'timestamp': datetime.now(),
        'execution_id': execution_id,
        }

    engine_info = m.get_engine_info()
    package_kpi = m.get_package_kpi()
    package_parameters = m.get_package_details("execution-values")
    package_overrides = m.get_package_details("execution-overrides")

    return render_template(
        'execution-values.html',
        environment=environment,
        engine_info=engine_info,
        package_info=package_info,
        package_kpi=package_kpi,
        package_parameters=package_parameters,
        package_overrides=package_overrides
    )

def package_history(folder_name, project_name, status, package_name):
    status_code(status)
    folder_name = urllib.parse.unquote(folder_name)
    project_name = urllib.parse.unquote(project_name)
    package_name = urllib.parse.unquote(package_name)

    m = monitor()
    m.project_name = project_name
    m.package_name = package_name
    m.folder_name = folder_name

    environment = {
        'version': version,
        'timestamp': datetime.now(),
        'folder_name': folder_name,
        'project_name': project_name,
        'package_name': package_name,
        'status': status
        }

    engine_kpi = m.get_engine_kpi()
    engine_info = m.get_engine_info()
    package_info = m.get_package_info()
    package_kpi = m.get_package_kpi()
    package_history = m.get_package_history()

    return render_template(
        'execution-history.html',
        environment=environment,
        engine_info=engine_info,
        package_info=package_info,
        package_kpi=package_kpi,
        package_history=package_history
    )

#@app.route('/ssis/execution-status', methods = ['GET'])
#def get_statuses():
#    execution_status = services.get_package_execution_status()
#    return jsonify ( { 'data': execution_status } )

#@app.route('/<int:execution_id>/execution-history', methods = ['GET'])
#def get_execution_history():
#    history = services.get_package_execution_history()
#    return jsonify ( { 'data': history } )

#@app.route('/ssis/execution-events/<int:execution_id>', methods = ['GET'])
#def get_package_execution_events(execution_id):
#    execution_events = services.get_package_execution_events(execution_id)
#    return jsonify ( { 'data': execution_events } )

#@app.route('/ssis/execution-kpi/<int:execution_id>', methods = ['GET'])
#def get_package_execution_kpi(execution_id):
#    kpi = services.get_package_execution_kpi(execution_id)
#    return jsonify( { 'data': kpi } )

#@app.route('/sample', methods = ['GET'])
#def get_sample():
#    return jsonify({'result': 123})

def register_views(app):
    """Retain legacy endpoint names used by templates and existing links."""
    app.add_url_rule('/', view_func=packages)
    app.add_url_rule('/folder/<folder_name>', view_func=folder)
    app.add_url_rule('/folder/<folder_name>/project/<project_name>', view_func=folder_project)
    app.add_url_rule(
        '/folder/<folder_name>/project/<project_name>/status/<status>',
        view_func=folder_project_status,
    )
    app.add_url_rule('/execution/<int:execution_id>', view_func=execution)
    app.add_url_rule('/execution/<int:execution_id>/events/<event_type>', view_func=package_events)
    app.add_url_rule('/execution/<int:execution_id>/values', view_func=package_execution_values)
    app.add_url_rule(
        '/history/<folder_name>/project/<project_name>/status/<status>/package/<package_name>',
        view_func=package_history,
    )

