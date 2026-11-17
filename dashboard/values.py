"""Bounded value sections with SQL and independent serializer redaction."""

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.db import execute_query
from dashboard.inspection import visible_execution
from dashboard.observability import record_query
from dashboard.timestamps import parse_timestamp, utc_now
from dashboard.validation import InvalidInput


QUERY_PARAMETERS = ('limit', 'cursor', 'section', 'scope')
SECTIONS = {'parameters': 'execution_parameter_id', 'overrides': 'property_id'}
PARAMETER_SCOPES = {name: code for code, name in wire.PARAMETER_OBJECT_TYPES.items()}


def _display(row, *, permitted):
    sensitive = wire.boolean(row['sensitive'])
    reason = 'sensitive' if sensitive else None if permitted else 'policy'
    # Do not inspect, validate or stringify a redacted value, even from a bad adapter.
    value = None if reason else wire.catalog_text(row['value'], 32770)
    return {'sensitive': sensitive, 'value': None if value is None else value[:16384],
            'truncated': value is not None and len(value) > 16384,
            'redacted': reason is not None, 'redaction_reason': reason}


def _serialize(row, section, upper, config):
    identity = SECTIONS[section]
    identifier = wire.bigint(row[identity])
    if row[identity] > upper:
        raise ValueError('Unexpected value identity.')
    permitted = section == 'parameters' or config['API_OVERRIDE_VALUES_ENABLED']
    result = {identity: identifier, **_display(row, permitted=permitted)}
    if section == 'parameters':
        name = wire.catalog_text(row['name'], 128, units=True, name=True)
        sql_type = wire.catalog_text(row['sql_type'], 128, units=True)
        if name is None or sql_type is None:
            raise ValueError('Missing parameter metadata.')
        result.update(object_type=wire.parameter_object_type(row['object_type']), name=name, sql_type=sql_type,
                      required=wire.boolean(row['required']), value_set=wire.boolean(row['value_set']),
                      runtime_override=wire.boolean(row['runtime_override']))
    else:
        path = wire.catalog_text(row['property_path'], 4000, units=True, name=True)
        if path is None:
            raise ValueError('Missing property path.')
        result['property_path'] = path
    return result


def value_page(value, values, config):
    now = utc_now()
    section = values.get('section', 'parameters')
    parameter_scope = values.get('scope')
    if 'scope' in values and (section != 'parameters' or parameter_scope not in PARAMETER_SCOPES):
        raise InvalidInput('Unsupported parameter scope.')
    object_type = PARAMETER_SCOPES.get(parameter_scope)
    try:
        identifier = inputs.identifier(value)
        if section not in SECTIONS:
            raise InvalidInput('Unsupported value section.')
        limit = inputs.integer(values['limit']) if 'limit' in values else 50
        bound_selection = {'execution_id': value, 'section': section, 'limit': limit}
        if section == 'parameters':
            bound_selection['order'] = ['object_type', 'execution_parameter_id']
            if parameter_scope is not None:
                bound_selection['scope'] = parameter_scope
        selection = cursors.digest(bound_selection)
        scope = cursors.scope_digest(config)
        state = None
        last_type = None
        if 'cursor' in values:
            state = cursors.open_cursor(values['cursor'], resource='v1/values', selection=selection, scope=scope, now=now)
            upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
            key, nulls = state['sort_key'], state['sort_nulls']
            width = 2 if section == 'parameters' else 1
            if (last > upper or type(key) is not list or len(key) != width or key[-1] != state['last_id']
                    or type(nulls) is not list or len(nulls) != width or any(flag is not False for flag in nulls)):
                raise cursors.InvalidCursor()
            if section == 'parameters':
                last_type = key[0]
                if (type(last_type) is not int or not -32768 <= last_type <= 32767
                        or object_type is not None and last_type != object_type):
                    raise cursors.InvalidCursor()
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise

    visible_execution(value, config, as_of=now)

    def query(resource, parameters, *, one_row=False):
        return execute_query(resource, parameters, connection_string=config['CONNECTION_STRING']['main'], one_row=one_row,
                             login_timeout=config['DB_LOGIN_TIMEOUT_SECONDS'], query_timeout=config['DB_QUERY_TIMEOUT_SECONDS'],
                             typed_timestamps=True, declared_parameters=True, on_complete=record_query)

    as_of = now if state is None else parse_timestamp(state['as_of'])
    if state is None:
        fence = query('api-values-' + section + '-fence.sql', (identifier,), one_row=True)
        if not fence:
            raise NotFound()
        upper, last = fence['upper_id'], None
        if upper is not None:
            wire.bigint(upper)
    rows = []
    identity = SECTIONS[section]
    if upper is not None:
        parameters = (identifier, limit + 1, upper)
        if section == 'parameters':
            parameters += (last_type, last, object_type)
        if section == 'overrides':
            parameters += (last, int(config['API_OVERRIDE_VALUES_ENABLED']))
        rows = query('api-values-' + section + '-page.sql', parameters)
        if not rows:
            raise NotFound()
        if len(rows) > limit + 1 or any(wire.bigint(r['execution_id']) != value for r in rows):
            raise ValueError('Unexpected values page.')
        if any(wire.boolean(r['page_empty']) for r in rows):
            if len(rows) != 1 or rows[0][identity] is not None:
                raise ValueError('Unexpected empty values page.')
            rows = []
    if object_type is not None and any(row['object_type'] != object_type for row in rows):
        raise ValueError('Unexpected parameter scope.')
    serialized = [_serialize(row, section, upper, config) for row in rows]
    if len({row[identity] for row in serialized}) != len(serialized):
        raise ValueError('Duplicate value ID.')
    has_more = len(serialized) > limit
    data = serialized[:limit]
    token = None
    if has_more:
        last_id = data[-1][identity]
        key = [data[-1]['object_type']['code'], last_id] if section == 'parameters' else [last_id]
        token = cursors.seal({'v': 2, 'resource': 'v1/values', 'selection': selection, 'scope': scope,
                             'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': last_id,
                             'sort_key': key, 'sort_nulls': [False] * len(key)})
    return data, {'from': None, 'to': None, 'limit': limit,
                  'sort': 'object_type' if section == 'parameters' else identity, 'direction': 'asc',
                  'as_of': as_of.isoformat(), 'upper_id': None if upper is None else wire.bigint(upper),
                  'next_cursor': token, 'has_more': has_more, 'consistency': 'live', 'section': section}
