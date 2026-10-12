"""Keep HTTP failures independent of catalog data and driver diagnostics."""

from collections import deque
from http import HTTPStatus
from pathlib import Path
import re
import logging

from flask import current_app, render_template
import pyodbc
from werkzeug.exceptions import HTTPException

from dashboard.validation import InvalidInput
from dashboard.observability import log_event, request_id as _request_id


_PACKAGE_ROOT = Path(__file__).resolve().parent


def _safe_symbol(value):
    if isinstance(value, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]{0,159}', value):
        return value
    return 'unknown'


def _exception_details(error):
    """Retain bounded application locations without formatting a traceback."""
    frames = deque(maxlen=8)
    traceback = error.__traceback__
    while traceback is not None:
        code = traceback.tb_frame.f_code
        try:
            source = Path(code.co_filename).relative_to(_PACKAGE_ROOT)
        except ValueError:
            pass
        else:
            if source.suffix == '.py' and '..' not in source.parts:
                module = source.with_suffix('').parts
                if module[-1] == '__init__':
                    module = module[:-1]
                frames.append({
                    'module': _safe_symbol('.'.join(('dashboard', *module))),
                    'function': _safe_symbol(code.co_name),
                    'line': traceback.tb_lineno,
                })
        traceback = traceback.tb_next
    # Do not read exception arguments, notes, chains, source lines or frame locals.
    return {'exception_type': _safe_symbol(type(error).__name__), 'application_frames': list(frames)}


def _propagate_errors():
    # Explicit opt-in restores Flask's debugger/test handling. A production app
    # keeps its safe response even if PROPAGATE_EXCEPTIONS was set accidentally.
    return current_app.config['PROPAGATE_EXCEPTIONS'] is True and (current_app.debug or current_app.testing)


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
    log_event(
        'database_error', level=logging.ERROR,
        status=status, sqlstate=state or 'unknown', request_id=_request_id(),
        **_exception_details(error),
    )
    if _propagate_errors():
        raise
    return _error_response(status)


def _unexpected_error(error):
    log_event(
        'request_error', level=logging.ERROR, status=500, request_id=_request_id(),
        **_exception_details(error),
    )
    if _propagate_errors():
        raise
    return _error_response(500)


def register_error_handlers(app):
    app.register_error_handler(InvalidInput, _invalid_input)
    app.register_error_handler(HTTPException, _http_error)
    app.register_error_handler(pyodbc.Error, _database_error)
    app.register_error_handler(Exception, _unexpected_error)
