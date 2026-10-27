"""Opt-in legacy bookmark translation without catalog reads or policy fallback."""

from urllib.parse import unquote_to_bytes

from flask import g, make_response, redirect, render_template, request, url_for

from dashboard.api_validation import catalog_name, query_arguments
from dashboard.observability import request_id
from dashboard.validation import InvalidInput, event_query, status_code, validate_execution_id


_OVERVIEW = {'packages', 'folder', 'folder_project', 'folder_project_status'}
_EXECUTION = {'execution', 'package_events', 'package_execution_values'}
_LEGACY = _OVERVIEW | _EXECUTION | {'package_history'}
_ALIASES = {'legacy_overview': 'folder_project_status', 'legacy_history': 'package_history'}


def _representable_name(value, *, query_alias=False):
    try:
        catalog_name(value, utf16_units=100)
    except InvalidInput:
        return False
    # Legacy LIKE, extra decoding and path normalization cannot become exact scope.
    return (value not in ('.', '..') and not value.endswith(' ')
            and not any(character in ('*%_[]\ufffd' if query_alias else '*%_[]/\\\ufffd') or ord(character) < 32
                        or 127 <= ord(character) <= 159 for character in value))


def _native_destination(endpoint, values, *, query_alias=False):
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
        scope = {}
        for key in ('folder', 'project', 'package'):
            name = values[f'{key}_name']
            try:
                catalog_name(name, utf16_units=100)
            except InvalidInput:
                return None
            # Preserve LIKE semantics, but never repeat legacy's second decode
            # or reinterpret a path separator/control as a catalog selector.
            if any(character in ('\ufffd' if query_alias else '/\\\ufffd') or ord(character) < 32
                   or 127 <= ord(character) <= 159 for character in name):
                return None
            scope[key] = '%' if name == 'all' else name.replace('*', '%')
        return url_for('frontend.history', match='like', **scope, status='2,7', _external=False)
    scope = {}
    for key in ('folder', 'project'):
        name = values.get(f'{key}_name', 'all')
        if name == 'all':
            continue
        if not _representable_name(name, query_alias=query_alias):
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
    if (request.routing_exception is not None or request.endpoint not in _LEGACY | _ALIASES.keys()
            or request.method not in ('GET', 'HEAD')):
        return None
    marked = _has_native_marker(request.query_string)
    alias = request.endpoint in _ALIASES
    if alias:
        keys = ('folder', 'project', 'status', 'native') + (('package',) if request.endpoint == 'legacy_history' else ())
        params = query_arguments(request.query_string, keys)
        g.legacy_query_values = {'status': params.get('status', 'all')}
        for key in ('folder', 'project') + (('package',) if request.endpoint == 'legacy_history' else ()):
            g.legacy_query_values[key + '_name'] = catalog_name(params.get(key, 'all'), utf16_units=100)
        valid_marker = params.get('native') == '1'
    else:
        valid_marker = not marked or query_arguments(request.query_string, ('native',)) == {'native': '1'}
    if marked and not valid_marker:
        raise InvalidInput('Select a supported native bookmark option.')
    values = g.legacy_query_values if alias else request.view_args
    selectors = {key.removesuffix('_name'): value for key, value in values.items()} if alias else values
    destination = _native_destination(_ALIASES.get(request.endpoint, request.endpoint), values, query_alias=alias)
    if not marked:
        if destination is not None:
            g.native_bookmark_url = url_for(request.endpoint, **selectors, native='1', _external=False)
        return None
    if destination is None:
        response = make_response(render_template(
            'error.html', status=409, title='Native view unavailable',
            detail='This bookmark has no equivalent native view. Continue in the legacy view or choose filters in the native overview.',
            # A query-only link clears native=1 without decoding/rebuilding the
            # legacy path, including percent escapes and the deployment prefix.
            legacy_url=url_for(request.endpoint, **selectors, _external=False) if alias else '?',
            home_url=url_for('frontend.overview', _external=False),
            request_id=request_id(),
        ), 409)
    else:
        response = redirect(destination, code=302)
    response.headers['Cache-Control'] = 'no-store'
    return response


def register_legacy_navigation(app):
    app.context_processor(lambda: {'legacy_link': legacy_url, 'native_bookmark_url': g.get('native_bookmark_url')})
    # Register after browser isolation, so redirects cannot bypass its checks.
    app.before_request(_translate_bookmark)


def legacy_url(endpoint, **values):
    """Use a query alias when decoded name separators cannot be a path segment."""
    if endpoint in _OVERVIEW | {'package_history'} and any(
            isinstance(value, str) and any(character in '/\\' for character in value)
            for key, value in values.items() if key.endswith('_name')):
        endpoint = 'legacy_history' if endpoint == 'package_history' else 'legacy_overview'
        values = {key.removesuffix('_name'): value for key, value in values.items()}
    return url_for(endpoint, **values, _external=False)
