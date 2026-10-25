"""Opt-in legacy bookmark translation without catalog reads or policy fallback."""

from urllib.parse import unquote_to_bytes

from flask import g, make_response, redirect, render_template, request, url_for

from dashboard.api_validation import catalog_name, query_arguments
from dashboard.observability import request_id
from dashboard.validation import InvalidInput, event_query, status_code, validate_execution_id


_OVERVIEW = {'packages', 'folder', 'folder_project', 'folder_project_status'}
_EXECUTION = {'execution', 'package_events', 'package_execution_values'}
_LEGACY = _OVERVIEW | _EXECUTION | {'package_history'}


def _representable_name(value):
    try:
        catalog_name(value, utf16_units=100)
    except InvalidInput:
        return False
    # Legacy LIKE, extra decoding and path normalization cannot become exact scope.
    return (value not in ('.', '..') and not value.endswith(' ')
            and not any(character in '*%_[]/\\\ufffd' or ord(character) < 32
                        or 127 <= ord(character) <= 159 for character in value))


def _native_destination(endpoint, values):
    """Return a local native URL, or None for an unsupported legacy scope."""
    if endpoint in _EXECUTION:
        if endpoint == 'package_events':
            event_query(values['event_type'])
        identifier = str(validate_execution_id(values['execution_id']))
        anchor = None
        if endpoint == 'package_events':
            kind = values['event_type']
            anchor = 'events' if kind == 'all' else f'events/{kind}'
        elif endpoint == 'package_execution_values':
            anchor = 'parameters'
        return url_for('frontend.execution', execution_id=identifier, _anchor=anchor, _external=False)

    status = status_code(values.get('status', 'all'))
    if endpoint == 'package_history':
        return None
    scope = {}
    for key in ('folder', 'project'):
        name = values.get(f'{key}_name', 'all')
        if name == 'all':
            continue
        if not _representable_name(name):
            return None
        scope[key] = name
    if status:
        scope['status'] = str(status)
    return url_for('frontend.overview', **scope, _external=False)


def _has_native_marker(raw):
    # Detect only the opt-in key. Unmarked legacy queries were never validated;
    # malformed unrelated bytes must not start a new parser/error path for them.
    return any(unquote_to_bytes(part.partition(b'=')[0].replace(b'+', b' ')) == b'native'
               for part in raw.split(b'&'))


def _translate_bookmark():
    g.native_bookmark_url = None
    if (request.routing_exception is not None or request.endpoint not in _LEGACY
            or request.method not in ('GET', 'HEAD')):
        return None
    marked = _has_native_marker(request.query_string)
    if marked and query_arguments(request.query_string, ('native',)) != {'native': '1'}:
        raise InvalidInput('Select a supported native bookmark option.')
    destination = _native_destination(request.endpoint, request.view_args)
    if not marked:
        if destination is not None:
            g.native_bookmark_url = url_for(request.endpoint, **request.view_args, native='1', _external=False)
        return None
    if destination is None:
        response = make_response(render_template(
            'error.html', status=409, title='Native view unavailable',
            detail='This bookmark has no equivalent native view. Continue in the legacy view or choose filters in the native overview.',
            # A query-only link clears native=1 without decoding/rebuilding the
            # legacy path, including percent escapes and the deployment prefix.
            legacy_url='?', home_url=url_for('frontend.overview', _external=False),
            request_id=request_id(),
        ), 409)
    else:
        response = redirect(destination, code=302)
    response.headers['Cache-Control'] = 'no-store'
    return response


def register_legacy_navigation(app):
    # Register after browser isolation, so redirects cannot bypass its checks.
    app.before_request(_translate_bookmark)
    app.context_processor(lambda: {'native_bookmark_url': g.get('native_bookmark_url')})
