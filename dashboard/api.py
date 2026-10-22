"""Local read-only API HTTP boundary, metadata and dependency health."""

from datetime import datetime, timezone
from http import HTTPStatus
import json

from flask import Blueprint, current_app, g, request
from werkzeug.exceptions import Forbidden, ServiceUnavailable

from dashboard.api_validation import COHORT_PARAMETERS, fixed_as_of, query_arguments
from dashboard.executions import EXECUTION_SORTS, QUERY_PARAMETERS, execution_page
from dashboard.executables import QUERY_PARAMETERS as EXECUTABLE_PARAMETERS, executable_page
from dashboard.children import QUERY_PARAMETERS as CHILD_PARAMETERS, child_page
from dashboard.events import QUERY_PARAMETERS as EVENT_PARAMETERS, event_page
from dashboard.values import QUERY_PARAMETERS as VALUE_PARAMETERS, value_page
from dashboard.history import QUERY_PARAMETERS as HISTORY_PARAMETERS, history_page
from dashboard.inspection import execution_detail
from dashboard.metrics import execution_summary
from dashboard.timeline import execution_timeline
from dashboard.navigation import QUERY_PARAMETERS as NAVIGATION_PARAMETERS, navigation_page
from dashboard.db import execute_query
from dashboard.observability import record_query, request_id
from dashboard import cursors
from dashboard import serialization as wire
from dashboard.validation import EVENT_QUERIES, InvalidInput
from dashboard.version import APP_VERSION


blueprint = Blueprint('api', __name__, url_prefix='/api/v1')
_CAPABILITIES = {'events': 'API_EVENTS_ENABLED', 'values': 'API_VALUES_ENABLED',
                 'override_values': 'API_OVERRIDE_VALUES_ENABLED'}
_PROBLEMS = {
    400: ('invalid_input', 'The request contains an unsupported or invalid value.'),
    401: ('unauthenticated', 'Authentication is required to access this resource.'),
    403: ('forbidden', 'You do not have permission to access this resource.'),
    404: ('not_found', 'The requested resource or execution is not available.'),
    405: ('method_not_allowed', 'This request method is not supported for this resource.'),
    500: ('internal_error', 'The request could not be completed. Use the request ID when reporting the problem.'),
    503: ('database_unavailable', 'The monitoring database is unavailable. Please try again later.'),
    504: ('database_timeout', 'The monitoring database did not respond in time. Please try again later.'),
}


def is_api_request():
    return (request.path == '/api/v1' or request.path.startswith('/api/v1/')
            or request.path in ('/healthz', '/readyz'))


def validate_config(config):
    for name in _CAPABILITIES.values():
        if type(config[name]) is not bool:
            raise ValueError(f'{name} must be a Boolean.')
    if config['API_OVERRIDE_VALUES_ENABLED'] and not config['API_VALUES_ENABLED']:
        raise ValueError('API_OVERRIDE_VALUES_ENABLED requires API_VALUES_ENABLED.')
    for name, upper in (('HOUR_SPAN', None), ('API_MAX_RANGE_HOURS', None),
                        ('API_MAX_TIMELINE_BUCKETS', 1000), ('API_READINESS_TIMEOUT_SECONDS', 2)):
        value = config[name]
        if type(value) is not int or value < 1 or (upper is not None and value > upper):
            raise ValueError(f'{name} must be a positive integer within its documented limit.')
    if config['HOUR_SPAN'] > config['API_MAX_RANGE_HOURS']:
        raise ValueError('HOUR_SPAN must fit API_MAX_RANGE_HOURS.')
    if config['API_CURSOR_SECRET_KEY'] is not None:
        cursors.signing_key(config['API_CURSOR_SECRET_KEY'])


def capabilities():
    return {key: current_app.config[setting] for key, setting in _CAPABILITIES.items()}


def query_parameters(*names):
    """Declare accepted query keys for validation before a view/SQL operation."""
    def decorate(view):
        view.api_query_parameters = frozenset(names)
        return view
    return decorate


def requires_capability(name):
    if name not in _CAPABILITIES:
        raise ValueError('Unknown API capability.')
    def decorate(view):
        view.api_capability = name
        return view
    return decorate


def _json(payload, *, status=200, response=None, mimetype='application/json'):
    if response is None:
        response = current_app.response_class()
    response.status_code = status
    response.set_data(json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(',', ':')))
    response.mimetype = mimetype
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Request-ID'] = request_id()
    return response


def resource_response(data, *, meta=None):
    return _json({'data': data, 'meta': {
        **(meta or {}),
        'request_id': request_id(), 'generated_at': wire.utc_timestamp(datetime.now(timezone.utc)),
    }})


def problem_response(status, *, response=None, cursor_error=None):
    if status not in _PROBLEMS:
        # The contract fixes the status/code set. Keep an unlisted HTTP error in its
        # class rather than reporting (and logging) a client error as a server fault.
        status = 400 if type(status) is int and 400 <= status < 500 else 500
    code, detail = _PROBLEMS[status]
    if status == 400 and cursor_error in ('invalid_cursor', 'cursor_expired'):
        code = cursor_error
        detail = 'The paging cursor is invalid or expired. Start a new first page.'
    return _json({'type': 'about:blank', 'title': HTTPStatus(status).phrase, 'status': status,
                  'detail': detail, 'code': code, 'request_id': request_id()},
                 status=status, response=response, mimetype='application/problem+json')


def _before_request():
    if not is_api_request() or request.routing_exception is not None:
        return
    if request.method in ('GET', 'HEAD') and (
            request.content_length not in (None, 0) or 'Transfer-Encoding' in request.headers):
        raise InvalidInput('Monitoring requests have no body.')
    view = current_app.view_functions[request.endpoint]
    g.api_query = query_arguments(request.query_string, getattr(view, 'api_query_parameters', ()))
    capability = getattr(view, 'api_capability', None)
    if capability is not None and current_app.config[_CAPABILITIES[capability]] is not True:
        raise Forbidden()


def _after_request(response):
    if is_api_request():
        response.headers['Cache-Control'] = 'no-store'
    return response


@blueprint.get('/meta', merge_slashes=False)
def metadata():
    config = current_app.config
    return resource_response({
        'app_version': APP_VERSION, 'api_version': 'v1',
        'display_timezone': config['DISPLAY_TIMEZONE'], 'capabilities': capabilities(),
        'limits': {
            'default_limit': 50, 'max_limit': 200, 'default_range_hours': config['HOUR_SPAN'],
            'max_range_hours': config['API_MAX_RANGE_HOURS'],
            'max_timeline_buckets': config['API_MAX_TIMELINE_BUCKETS'],
            'cursor_ttl_seconds': cursors.TTL_SECONDS, 'max_cursor_characters': cursors.MAX_CHARACTERS,
            'max_text_characters': 16384, 'max_search_characters': 512,
        },
        'execution_statuses': [wire.execution_status(code) for code in wire.EXECUTION_STATUSES],
        'executable_results': [wire.executable_result(code) for code in wire.EXECUTABLE_RESULTS],
        'logging_levels': [wire.logging_level(code) for code in wire.LOGGING_LEVELS],
        'event_kinds': list(EVENT_QUERIES), 'execution_sorts': list(EXECUTION_SORTS),
    })


@blueprint.get('/executions', merge_slashes=False)
@query_parameters(*QUERY_PARAMETERS)
def executions():
    data, meta = execution_page(g.api_query, current_app.config,
                                fixed_to=current_app.extensions['api_fixed_as_of'])
    return resource_response(data, meta=meta)


@blueprint.get('/folders', merge_slashes=False)
@query_parameters(*NAVIGATION_PARAMETERS)
def folders():
    data, meta = navigation_page('folders', g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/executions/<id>', merge_slashes=False)
def execution(id):
    return resource_response(execution_detail(id, current_app.config))


@blueprint.get('/executions/<id>/executables', merge_slashes=False)
@query_parameters(*EXECUTABLE_PARAMETERS)
def executables(id):
    data, meta = executable_page(id, g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/executions/<id>/children', merge_slashes=False)
@query_parameters(*CHILD_PARAMETERS)
def children(id):
    data, meta = child_page(id, g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/executions/<id>/events', merge_slashes=False)
@query_parameters(*EVENT_PARAMETERS)
@requires_capability('events')
def events(id):
    data, meta = event_page(id, g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/executions/<id>/values', merge_slashes=False)
@query_parameters(*VALUE_PARAMETERS)
@requires_capability('values')
def values(id):
    data, meta = value_page(id, g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/history', merge_slashes=False)
@query_parameters(*HISTORY_PARAMETERS)
def history():
    data, meta = history_page(g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/projects', merge_slashes=False)
@query_parameters('folder', *NAVIGATION_PARAMETERS)
def projects():
    data, meta = navigation_page('projects', g.api_query, current_app.config)
    return resource_response(data, meta=meta)


@blueprint.get('/metrics/summary', merge_slashes=False)
@query_parameters(*COHORT_PARAMETERS)
def summary():
    data, meta = execution_summary(g.api_query, current_app.config,
                                   fixed_to=current_app.extensions['api_fixed_as_of'])
    return resource_response(data, meta=meta)


@blueprint.get('/metrics/timeline', merge_slashes=False)
@query_parameters(*COHORT_PARAMETERS, 'bucket')
def timeline():
    data, meta = execution_timeline(g.api_query, current_app.config,
                                    fixed_to=current_app.extensions['api_fixed_as_of'])
    return resource_response(data, meta=meta)


def liveness():
    return resource_response({'status': 'ok'})


def readiness():
    config = current_app.config
    cap = config['API_READINESS_TIMEOUT_SECONDS']
    row = execute_query('api-readiness.sql', connection_string=config['CONNECTION_STRING']['main'],
                        one_row=True, login_timeout=min(cap, config['DB_LOGIN_TIMEOUT_SECONDS']),
                        query_timeout=min(cap, config['DB_QUERY_TIMEOUT_SECONDS']), on_complete=record_query)
    if row.get('ready') is not True:
        raise ServiceUnavailable()
    return resource_response({'status': 'ready'})


def register_api(app):
    cursors.configure(app)
    app.extensions['api_fixed_as_of'] = fixed_as_of(app.config['AS_OF_DATE'], app.config['DISPLAY_TIMEZONE'])
    app.register_blueprint(blueprint)
    app.add_url_rule('/healthz', 'healthz', liveness, methods=['GET'], merge_slashes=False)
    app.add_url_rule('/readyz', 'readyz', readiness, methods=['GET'], merge_slashes=False)
    app.before_request(_before_request)
    app.after_request(_after_request)
