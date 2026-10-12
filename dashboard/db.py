"""SQL resources, parameter binding, and ownership of one query's resources."""

from importlib.resources import files
import re

import pyodbc


def validate_timeouts(login_timeout, query_timeout):
    """Reject unbounded or invalid timeout settings before opening a connection."""
    for name, value in (
        ('DB_LOGIN_TIMEOUT_SECONDS', login_timeout),
        ('DB_QUERY_TIMEOUT_SECONDS', query_timeout),
    ):
        if type(value) is not int or not 1 <= value <= 2_147_483_647:
            raise ValueError(f'{name} must be a positive 32-bit integer in seconds.')


def load_query(query_file):
    """Read a flat, checked-in SQL resource, independent of the working directory."""
    if not isinstance(query_file, str) or not re.fullmatch(r'[A-Za-z0-9_-]+\.sql', query_file):
        raise ValueError('query_file must be a SQL resource basename.')
    return files('dashboard').joinpath('query', query_file).read_text(encoding='utf-8-sig')


def _close_resources(cursor, connection, *, operation_failed):
    """Attempt both closes; an operation failure takes precedence over cleanup."""
    first_error = None
    for resource in (cursor, connection):
        if resource is not None:
            try:
                resource.close()
            except BaseException as error:
                # Even cancellation during cursor cleanup must attempt the
                # connection close. Never replace an existing query failure.
                if first_error is None:
                    first_error = error
    if first_error is not None and not operation_failed:
        raise first_error


def execute_query(query_file, parameters=(), *, connection_string, one_row=False,
                  login_timeout, query_timeout):
    """Execute bound SQL and return legacy dictionaries, closing owned resources.

    Keep pyodbc's existing transaction defaults. An empty single-row result is
    {}, an empty multi-row result is [], and ODBC-returned values stay typed.
    Each call owns its connection and cursor; no Flask context is required.
    """
    validate_timeouts(login_timeout, query_timeout)
    query = load_query(query_file)
    parameters = tuple(parameters)
    connection = None
    cursor = None
    operation_failed = False
    try:
        connection = pyodbc.connect(connection_string, timeout=login_timeout)
        connection.timeout = query_timeout
        cursor = connection.cursor()
        cursor.execute(query, parameters)
        if one_row:
            row = cursor.fetchone()
            if row is None:
                return {}
            return dict(zip([column[0] for column in cursor.description], row))
        rows = cursor.fetchall()
        if not rows:
            return []
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in rows]
    except BaseException:
        operation_failed = True
        raise
    finally:
        _close_resources(cursor, connection, operation_failed=operation_failed)
