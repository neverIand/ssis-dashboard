"""SQL resources, parameter binding, and ownership of one query's resources."""

from importlib.resources import files
import re
from time import perf_counter

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
    return first_error is not None


def execute_query(query_file, parameters=(), *, connection_string, one_row=False,
                  login_timeout, query_timeout, on_complete=None):
    """Execute bound SQL and return legacy dictionaries, closing owned resources.

    Keep pyodbc's existing transaction defaults. An empty single-row result is
    {}, an empty multi-row result is [], and ODBC-returned values stay typed.
    Each call owns its connection and cursor; no Flask context is required.
    An optional observer receives safe metadata after cleanup, never row values.
    """
    validate_timeouts(login_timeout, query_timeout)
    query = load_query(query_file)
    parameters = tuple(parameters)
    connection = None
    cursor = None
    operation_failed = False
    started = perf_counter()
    stage = 'connect'
    outcome = 'error'
    row_count = None
    cleanup_failed = False
    try:
        connection = pyodbc.connect(connection_string, timeout=login_timeout)
        stage = 'timeout_setup'
        connection.timeout = query_timeout
        stage = 'cursor'
        cursor = connection.cursor()
        stage = 'execute'
        cursor.execute(query, parameters)
        stage = 'fetch'
        if one_row:
            row = cursor.fetchone()
            stage = 'map'
            result = {} if row is None else dict(zip([column[0] for column in cursor.description], row))
            row_count = int(row is not None)
        else:
            rows = cursor.fetchall()
            stage = 'map'
            if rows:
                columns = [column[0] for column in cursor.description]
                result = [dict(zip(columns, row)) for row in rows]
            else:
                result = []
            row_count = len(result)
        outcome = 'ok'
        return result
    except BaseException as error:
        operation_failed = True
        outcome = 'error' if isinstance(error, Exception) else 'cancelled'
        raise
    finally:
        try:
            cleanup_failed = _close_resources(cursor, connection, operation_failed=operation_failed)
        except BaseException as error:
            cleanup_failed = True
            stage = 'cleanup'
            outcome = 'error' if isinstance(error, Exception) else 'cancelled'
            raise
        finally:
            if on_complete is not None:
                report = {
                    'query': query_file,
                    'duration_ms': round(max(0.0, perf_counter() - started) * 1000, 3),
                    'outcome': outcome,
                    'rows': row_count if outcome == 'ok' else None,
                    'failure_stage': None if outcome == 'ok' else stage,
                    'cleanup_failed': cleanup_failed,
                }
                try:
                    on_complete(report)
                except BaseException as error:
                    # Preserve active query/cleanup failures. Ordinary observer
                    # errors are best effort; cancellation on success propagates.
                    if outcome == 'ok' and not isinstance(error, Exception):
                        raise
