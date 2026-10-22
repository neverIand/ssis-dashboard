"""Process-local authenticated paging state; tokens never authorize a SQL read."""

import base64
import hashlib
import hmac
import json
import re
import secrets

from flask import current_app, has_app_context

from dashboard.timestamps import TICKS_PER_SECOND, parse_timestamp
from dashboard.validation import InvalidInput


_KEY = secrets.token_bytes(32)
TTL_SECONDS = 1800
MAX_CHARACTERS = 8192
MIN_SECRET_BYTES = 32
_EXTENSION = 'api_cursor_key'
_SECRET_MESSAGE = 'API_CURSOR_SECRET_KEY must be None or a str/bytes secret of at least 32 bytes.'


def signing_key(secret):
    """Derive the HMAC key from a configured secret, validating it first."""
    if isinstance(secret, str):
        try:
            secret = secret.encode('utf-8')
        except UnicodeError:
            raise ValueError(_SECRET_MESSAGE) from None
    if type(secret) is not bytes or len(secret) < MIN_SECRET_BYTES:
        raise ValueError(_SECRET_MESSAGE)
    # Domain separation keeps tokens independent if the secret is reused elsewhere.
    return hmac.new(secret, b'ssis-dashboard/api-cursor/v2', hashlib.sha256).digest()


def configure(app):
    """Bind the app's key at startup; a None secret keeps this process's random key.

    Each app owns its derived key, so creating another app, even one that then
    fails startup, never changes which cursors an existing app issues or accepts.
    Workers sharing one secret accept each other's cursors and survive restarts;
    TTL and scope binding still apply.
    """
    secret = app.config['API_CURSOR_SECRET_KEY']
    app.extensions[_EXTENSION] = None if secret is None else signing_key(secret)


def _key():
    # No secret or no app context: the process key, read at call time.
    key = current_app.extensions.get(_EXTENSION) if has_app_context() else None
    return _KEY if key is None else key


class InvalidCursor(InvalidInput):
    def __init__(self, *, expired=False):
        super().__init__('Invalid paging cursor.')
        self.expired = expired


def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def _decode(value):
    if re.fullmatch(r'[A-Za-z0-9_-]+', value) is None:
        raise ValueError('Invalid token encoding.')
    decoded = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if _encode(decoded) != value:
        raise ValueError('Invalid token encoding.')
    return decoded


def digest(value):
    """Keyed binding hides low-entropy filters and connection identity strings."""
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hmac.new(_key(), encoded.encode('ascii'), hashlib.sha256).hexdigest()


def scope_digest(config):
    """Bind the configured SQL/policy scope; browser headers grant no identity."""
    return digest({'connection': config['CONNECTION_STRING']['main'],
                   'policy': [config[name] for name in (
                       'API_EVENTS_ENABLED', 'API_VALUES_ENABLED', 'API_OVERRIDE_VALUES_ENABLED')]})


def seal(payload):
    body = _encode(json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('ascii'))
    signature = _encode(hmac.new(_key(), body.encode('ascii'), hashlib.sha256).digest())
    token = body + '.' + signature
    if len(token) > MAX_CHARACTERS:
        raise ValueError('Paging state exceeds the token limit.')
    return token


def open_cursor(token, *, resource, selection, scope, now):
    try:
        if not isinstance(token, str) or len(token) > MAX_CHARACTERS:
            raise ValueError('Invalid token length.')
        body, signature = token.split('.')
        expected = hmac.new(_key(), body.encode('ascii'), hashlib.sha256).digest()
        if not hmac.compare_digest(_decode(signature), expected):
            raise ValueError('Invalid token signature.')
        payload = json.loads(_decode(body))
        if (not isinstance(payload, dict)
                or set(payload) != {'v', 'resource', 'selection', 'scope', 'as_of', 'upper_id', 'last_id', 'sort_key', 'sort_nulls'}
                or type(payload['v']) is not int or payload['v'] != 2
                or payload['resource'] != resource
                or not isinstance(payload['selection'], str) or not isinstance(payload['scope'], str)
                or not hmac.compare_digest(payload['selection'], selection)
                or not hmac.compare_digest(payload['scope'], scope)):
            raise ValueError('Invalid paging scope.')
        as_of = parse_timestamp(payload['as_of'])
        age = now.utc_ticks - as_of.utc_ticks
        if age < 0:
            raise ValueError('Invalid paging time.')
        if age >= TTL_SECONDS * TICKS_PER_SECOND:
            raise InvalidCursor(expired=True)
        # The operation validates typed keys, NULL flags and IDs before SQL.
        return payload
    except InvalidCursor:
        raise
    except (ValueError, TypeError, UnicodeError):
        raise InvalidCursor() from None
