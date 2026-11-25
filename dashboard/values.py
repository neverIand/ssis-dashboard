"""Bounded value sections with SQL and independent serializer redaction."""

from dashboard import api_validation as inputs, cursors, paging, serialization as wire
from dashboard.db import catalog_query
from dashboard.inspection import visible_execution
from dashboard.timestamps import utc_now
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
    with paging.cursor_inputs(values):
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
        state, upper, last, as_of = paging.continuation(values, resource='v1/values', selection=selection,
                                                        scope=scope, now=now)
        last_type = None
        if state is not None:
            key, nulls = state['sort_key'], state['sort_nulls']
            width = 2 if section == 'parameters' else 1
            if (type(key) is not list or len(key) != width or key[-1] != state['last_id']
                    or type(nulls) is not list or len(nulls) != width or any(flag is not False for flag in nulls)):
                raise cursors.InvalidCursor()
            if section == 'parameters':
                last_type = key[0]
                if (type(last_type) is not int or not -32768 <= last_type <= 32767
                        or object_type is not None and last_type != object_type):
                    raise cursors.InvalidCursor()

    visible_execution(value, config, as_of=now)
    query = catalog_query(config)
    if state is None:
        upper, _ = paging.fence(query, 'api-values-' + section + '-fence.sql', (identifier,), scoped=True)
    rows = []
    identity = SECTIONS[section]
    if upper is not None:
        parameters = (identifier, limit + 1, upper)
        if section == 'parameters':
            parameters += (last_type, last, object_type)
        if section == 'overrides':
            parameters += (last, int(config['API_OVERRIDE_VALUES_ENABLED']))
        rows, _ = paging.observation_rows(query('api-values-' + section + '-page.sql', parameters), limit=limit,
                                          execution_id=value, identity=identity, label='values')
    if object_type is not None and any(row['object_type'] != object_type for row in rows):
        raise ValueError('Unexpected parameter scope.')
    serialized = paging.unique([_serialize(row, section, upper, config) for row in rows], identity,
                               'Duplicate value ID.')
    has_more = len(serialized) > limit
    data = serialized[:limit]
    token = None
    if has_more:
        last_id = data[-1][identity]
        key = [data[-1]['object_type']['code'], last_id] if section == 'parameters' else [last_id]
        token = paging.next_cursor(resource='v1/values', selection=selection, scope=scope, as_of=as_of,
                                   upper=upper, last_id=last_id, key=key, nulls=[False] * len(key))
    return data, paging.page_meta(limit=limit, sort='object_type' if section == 'parameters' else identity,
                                  direction='asc', as_of=as_of, upper=upper, token=token, has_more=has_more,
                                  section=section)
