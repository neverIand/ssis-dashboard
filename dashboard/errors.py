"""Keep HTTP failures independent of catalog data and driver diagnostics."""

from http import HTTPStatus
import re
from uuid import uuid4

from flask import current_app, g, render_template
import pyodbc
from werkzeug.exceptions import HTTPException

from dashboard.validation import InvalidInput


_DETAILS = {
    400: 'The request contains an unsupported or invalid value.',
    401: 'Authentication is required to access this page.',
    403: 'You do not have permission to access this page.',
    404: 'The requested page or execution is not available.',
    405: 'This request method is not supported for this page.',
    500: 'The request could not be completed. Use the request ID when reporting the problem.',
    503: 'The monitoring database is unavailable. Please try again later.',
    504: 'The monitoring database did not respond in time. Please try again later.',
}


def _request_id():
    if 'request_id' not in g:
        g.request_id = uuid4().hex
    return g.request_id


def _error_response(status, *, response=None):
    if response is None:
        response = current_app.response_class(status=status)
    response.set_data(render_template(
        'error.html',
        status=status,
        title=HTTPStatus(status).phrase,
        detail=_DETAILS.get(status, 'The request could not be completed.'),
        request_id=_request_id(),
    ))
    response.content_type = 'text/html; charset=utf-8'
    response.headers['Cache-Control'] = 'no-store'
    return response


def _invalid_input(error):
    return _error_response(400)


def _http_error(error):
    # Preserve protocol headers such as Allow on a 405 response.
    if error.code is None:
        return error
    return _error_response(error.code, response=error.get_response())


def _database_error(error):
    # pyodbc puts SQLSTATE first. Never search or echo its diagnostic message.
    state = error.args[0] if error.args else None
    if not isinstance(state, str) or not re.fullmatch(r'[A-Z0-9]{5}', state):
        state = None
    if state in ('HYT00', 'HYT01'):
        status = 504
    elif state is not None and (state.startswith('08') or state in ('28000', 'IM002', 'IM003')):
        status = 503
    else:
        status = 500
    current_app.logger.error(
        'Database request failed: status=%s sqlstate=%s request_id=%s',
        status, state or 'unknown', _request_id(),
    )
    return _error_response(status)


def _unexpected_error(error):
    # Exception text/tracebacks may contain SQL, credentials, or parameter values.
    current_app.logger.error('Request failed: status=500 request_id=%s', _request_id())
    return _error_response(500)


def register_error_handlers(app):
    app.before_request(_start_request)
    app.after_request(_add_request_id)
    app.register_error_handler(InvalidInput, _invalid_input)
    app.register_error_handler(HTTPException, _http_error)
    app.register_error_handler(pyodbc.Error, _database_error)
    app.register_error_handler(Exception, _unexpected_error)


def _start_request():
    _request_id()


def _add_request_id(response):
    response.headers['X-Request-ID'] = _request_id()
    return response
