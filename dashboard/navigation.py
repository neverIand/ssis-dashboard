"""Bounded, visible catalog folders/projects with exact names and typed IDs."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.timestamps import utc_now
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
    with paging.cursor_inputs(values):
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
        state, upper, last, as_of = paging.continuation(values, resource='v1/' + kind, selection=selection_digest,
                                                        scope=scope, now=now)
        last_name = _seek_name(state, sort=selection['sort'])

    query = catalog_query(config)
    parameters = (folder,) if kind == 'projects' else ()
    if state is None:
        upper, _ = paging.fence(query, 'api-' + kind + '-fence.sql', parameters)
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
        token = paging.next_cursor(resource='v1/' + kind, selection=selection_digest, scope=scope, as_of=as_of,
                                   upper=upper, last_id=data[-1][id_field],
                                   key=[data[-1]['name'] if selection['sort'] == 'name' else data[-1][id_field]],
                                   nulls=[False])
    return data, paging.page_meta(limit=selection['limit'], sort=selection['sort'], direction=selection['direction'],
                                  as_of=as_of, upper=upper, token=token, has_more=has_more)
