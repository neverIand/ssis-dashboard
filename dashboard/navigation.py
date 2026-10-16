"""Bounded, visible catalog folders/projects with exact names and typed IDs."""

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.observability import record_query
from dashboard.timestamps import parse_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('limit', 'cursor', 'sort', 'direction')
_ID = {'folders': 'folder_id', 'projects': 'project_id'}


def _text(value, *, name=False):
    if value is None and not name:
        return None
    try:
        if (not isinstance(value, str) or (name and (not value or '\0' in value))
                or len(value.encode('utf-16-le')) // 2 > (128 if name else 1024)):
            raise ValueError('Invalid catalog output text.')
    except UnicodeError:
        raise ValueError('Invalid catalog output text.') from None
    return value


def _seek_name(state, *, sort):
    if state is None:
        return None
    key, nulls = state['sort_key'], state['sort_nulls']
    if (type(key) is not list or len(key) != 1 or type(nulls) is not list
            or len(nulls) != 1 or nulls[0] is not False):
        raise cursors.InvalidCursor()
    if sort == 'name':
        return inputs.catalog_name(key[0])
    if inputs.identifier(key[0]) != inputs.identifier(state['last_id']):
        raise cursors.InvalidCursor()
    return None


def navigation_page(kind, values, config):
    id_field = _ID[kind]
    now = utc_now()
    try:
        folder = None
        if kind == 'projects':
            if 'folder' not in values:
                raise InvalidInput('An exact folder is required.')
            folder = inputs.catalog_name(values['folder'])
        selection = {'folder': folder, 'limit': inputs.integer(values['limit']) if 'limit' in values else 50,
                     'sort': values.get('sort', 'name'), 'direction': values.get('direction', 'asc')}
        if selection['sort'] not in ('name', id_field) or selection['direction'] not in ('asc', 'desc'):
            raise InvalidInput('Unsupported catalog order.')
        selection_digest = cursors.digest(selection)
        scope = cursors.scope_digest(config)
        state = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/' + kind,
                                         selection=selection_digest, scope=scope, now=now)
            upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
            if last > upper:
                raise cursors.InvalidCursor()
        last_name = _seek_name(state, sort=selection['sort'])
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'],
                             one_row=one_row, login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'],
                             query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'], typed_timestamps=True,
                             on_complete=record_query)

    parameters = (folder,) if kind == 'projects' else ()
    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        upper = query('api-' + kind + '-fence.sql', parameters, one_row=True)['upper_id']
        last = None
        if upper is not None:
            wire.bigint(upper)
    rows = [] if upper is None else query('api-' + kind + '-page.sql', (
        *parameters, selection['limit'] + 1, upper, last, last_name,
        int(selection['sort'] == 'name'), int(selection['direction'] == 'desc')))
    has_more = len(rows) > selection['limit']
    data = []
    for row in rows[:selection['limit']]:
        item = {id_field: wire.bigint(row[id_field]), 'name': _text(row['name'], name=True),
                'description': _text(row['description'])}
        if kind == 'projects':
            item.update(folder_id=wire.bigint(row['folder_id']), folder_name=_text(row['folder_name'], name=True))
        data.append(item)
    token = None
    if has_more:
        token = cursors.seal({'v': 2, 'resource': 'v1/' + kind, 'selection': selection_digest, 'scope': scope,
                              'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': data[-1][id_field],
                              'sort_key': [data[-1]['name'] if selection['sort'] == 'name' else data[-1][id_field]],
                              'sort_nulls': [False]})
    return data, {'from': None, 'to': None, 'limit': selection['limit'], 'sort': selection['sort'],
                  'direction': selection['direction'], 'as_of': as_of.isoformat(),
                  'upper_id': None if upper is None else wire.bigint(upper), 'has_more': has_more,
                  'next_cursor': token, 'consistency': 'live'}
