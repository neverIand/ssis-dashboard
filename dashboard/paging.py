"""Fenced-paging steps shared by the paged API resources.

Each resource keeps its own selection, SQL, seek key and serializer. These helpers hold the steps
the resources agree on rule for rule: invalid input that comes with a cursor is an invalid cursor;
a continuation cursor's upper and last IDs are BIGINTs with last <= upper; the fence row bounds the
cohort; observation pages carry the execution ID and a page_empty sentinel; IDs are unique; and the
next cursor and the page metadata have one shape.
"""

from contextlib import contextmanager

from werkzeug.exceptions import NotFound

from dashboard import api_validation as inputs, cursors, serialization as wire
from dashboard.timestamps import parse_timestamp
from dashboard.validation import InvalidInput


@contextmanager
def cursor_inputs(values):
    """Report invalid input as an invalid cursor when the request continues a cursor."""
    try:
        yield
    except cursors.InvalidCursor:
        raise
    except InvalidInput:
        if 'cursor' in values:
            raise cursors.InvalidCursor() from None
        raise


def continuation(values, *, resource, selection, scope, now):
    """Return (state, upper, last, as_of); state, upper and last are None on a first page."""
    if 'cursor' not in values:
        return None, None, None, now
    state = cursors.open_cursor(values['cursor'], resource=resource, selection=selection, scope=scope, now=now)
    upper, last = inputs.identifier(state['upper_id']), inputs.identifier(state['last_id'])
    if last > upper:
        raise cursors.InvalidCursor()
    return state, upper, last, parse_timestamp(state['as_of'])


def fence(query, resource, parameters, *, scoped=False, flag=None):
    """Read the fence row and return (upper ID, flag value). A scoped fence (one execution's observations) is
    empty when that execution is no longer visible, which is a 404; a cohort fence is an aggregate and always
    returns one row. The upper ID is read, then the optional Boolean flag, then the ID checked as a BIGINT."""
    row = query(resource, parameters, one_row=True)
    if not row and scoped:
        raise NotFound()
    upper = row['upper_id']
    value = None if flag is None else wire.boolean(row[flag])
    if upper is not None:
        wire.bigint(upper)
    return upper, value


def observation_rows(rows, *, limit, execution_id, identity, label, flag=None):
    """Check one execution's fenced page and drop its page_empty sentinel.

    Returns (rows, flag value); a flag column must hold one value on every row, sentinel included."""
    if not rows:
        raise NotFound()
    value = None if flag is None else wire.boolean(rows[0][flag])
    if (len(rows) > limit + 1 or any(wire.bigint(row['execution_id']) != execution_id
                                     or flag is not None and wire.boolean(row[flag]) != value for row in rows)):
        raise ValueError(f'Unexpected {label} page.')
    if any(wire.boolean(row['page_empty']) for row in rows):
        if len(rows) != 1 or rows[0][identity] is not None:
            raise ValueError(f'Unexpected empty {label} page.')
        rows = []
    return rows, value


def unique(items, identity, message):
    if len({item[identity] for item in items}) != len(items):
        raise ValueError(message)
    return items


def next_cursor(*, resource, selection, scope, as_of, upper, last_id, key, nulls):
    return cursors.seal({'v': 2, 'resource': resource, 'selection': selection, 'scope': scope,
                         'as_of': as_of.isoformat(), 'upper_id': wire.bigint(upper), 'last_id': last_id,
                         'sort_key': key, 'sort_nulls': nulls})


def page_meta(*, limit, sort, direction, as_of, upper, token, has_more, start=None, end=None, **extra):
    return {'from': start, 'to': end, 'limit': limit, 'sort': sort, 'direction': direction,
            'as_of': as_of.isoformat(), 'upper_id': None if upper is None else wire.bigint(upper),
            'next_cursor': token, 'has_more': has_more, 'consistency': 'live', **extra}
