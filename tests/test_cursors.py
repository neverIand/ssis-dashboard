"""Cursor signing keys: random per process by default, or a configured secret per app."""

import secrets
import unittest
from unittest.mock import patch

from dashboard import create_app, cursors
from dashboard.timestamps import TICKS_PER_SECOND, Timestamp, parse_timestamp


NOW = parse_timestamp('2026-10-20T12:00:00Z')
SECRET = 'shared-test-secret-' + 'x' * 32
OTHER_SECRET = 'another-shared-secret-' + 'y' * 32
SCOPE = {'resource': 'v1/folders', 'selection': 'selection-digest', 'scope': 'scope-digest'}


def payload(**changes):
    return {'v': 2, **SCOPE, 'as_of': NOW.isoformat(), 'upper_id': '9', 'last_id': '3',
            'sort_key': ['3'], 'sort_nulls': [False], **changes}


def folders_fixture(resource, parameters, **settings):
    if resource == 'api-folders-fence.sql':
        return {'upper_id': 3}
    take, upper, last, last_name, by_name, descending = parameters
    return [{'folder_id': i, 'name': f'Folder {i}', 'description': None}
            for i in range((last or 0) + 1, upper + 1)][:take]


class CursorSecretTests(unittest.TestCase):
    def setUp(self):
        # The default key is process-wide; never leak a test key into other tests.
        self.enterContext(patch.object(cursors, '_KEY', cursors._KEY))
        self.connect = self.enterContext(patch('pyodbc.connect', side_effect=AssertionError('Unexpected SQL access')))
        self.enterContext(patch('dashboard.navigation.utc_now', return_value=NOW))
        self.enterContext(patch('dashboard.navigation.execute_query', side_effect=folders_fixture))

    def tearDown(self):
        self.connect.assert_not_called()

    def app(self, secret=None, **changes):
        # Every app shares one SQL/policy scope, so only the signing key differs.
        return create_app({'TESTING': True, 'LOG_LEVEL': 'ERROR', 'API_CURSOR_SECRET_KEY': secret,
                           'CONNECTION_STRING': {'main': 'cursor-test-scope'}, **changes})

    def start_process(self, secret=None):
        """Model a new worker or restart: a fresh random key, then app startup."""
        cursors._KEY = secrets.token_bytes(32)
        return self.app(secret)

    def get(self, app, cursor=None):
        values = {'limit': '1', 'sort': 'folder_id'}
        if cursor is not None:
            values['cursor'] = cursor
        return app.test_client().get('/api/v1/folders', query_string=values)

    def issue(self, app):
        response = self.get(app)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json['meta']['next_cursor']

    def assert_accepts(self, app, cursor):
        response = self.get(app, cursor)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['data'][0]['folder_id'], '2')

    def assert_rejects(self, app, cursor):
        response = self.get(app, cursor)
        self.assertEqual((response.status_code, response.json['code']), (400, 'invalid_cursor'))

    def open(self, app, token, *, now=NOW, **changes):
        with app.app_context():
            return cursors.open_cursor(token, **{**SCOPE, **changes}, now=now)

    def test_default_random_key_still_invalidates_cursors_on_restart(self):
        token = self.issue(self.start_process())
        self.assert_rejects(self.start_process(), token)

    def test_shared_secret_survives_restarts_and_other_workers(self):
        token = self.issue(self.start_process(SECRET))
        for secret in (SECRET, SECRET.encode('utf-8')):
            with self.subTest(secret=type(secret).__name__):
                self.assert_accepts(self.start_process(secret), token)

    def test_shared_secret_keeps_scope_binding_expiry_and_rejects_other_secrets(self):
        app = self.app(SECRET)
        with app.app_context():
            token = cursors.seal(payload())
        for changes in ({'resource': 'v1/projects'}, {'selection': 'other'}, {'scope': 'other'}):
            with self.subTest(changes=changes), self.assertRaises(cursors.InvalidCursor):
                self.open(app, token, **changes)
        later = Timestamp(NOW.utc_ticks + cursors.TTL_SECONDS * TICKS_PER_SECOND)
        with self.assertRaises(cursors.InvalidCursor) as raised:
            self.open(app, token, now=later)
        self.assertTrue(raised.exception.expired)
        with self.assertRaises(cursors.InvalidCursor):
            self.open(self.app(OTHER_SECRET), token)

    def test_interleaved_apps_keep_their_own_keys(self):
        first = self.app(SECRET)
        first_token = self.issue(first)
        second = self.app(OTHER_SECRET)
        second_token = self.issue(second)
        default = self.app()
        default_token = self.issue(default)
        for app, own, foreign in ((first, first_token, (second_token, default_token)),
                                  (second, second_token, (first_token, default_token)),
                                  (default, default_token, (first_token, second_token))):
            with self.subTest(secret=app.config['API_CURSOR_SECRET_KEY']):
                self.assert_accepts(app, own)
                for token in foreign:
                    self.assert_rejects(app, token)
        self.assert_accepts(first, self.issue(first))

    def test_failed_startup_leaves_running_apps_and_the_process_key_unchanged(self):
        first, default = self.app(SECRET), self.app()
        first_token, default_token = self.issue(first), self.issue(default)
        process_key = cursors._KEY
        for changes in ({'API_CURSOR_SECRET_KEY': OTHER_SECRET, 'AS_OF_DATE': 'invalid-date'},
                        {'API_CURSOR_SECRET_KEY': 'x' * 31}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.app(**changes)
        self.assertIs(cursors._KEY, process_key)
        self.assert_accepts(first, first_token)
        self.assert_accepts(default, default_token)

    def test_startup_derives_the_app_key_without_exposing_the_secret(self):
        process_key = cursors._KEY
        app = self.app(SECRET)
        self.assertEqual(app.extensions['api_cursor_key'], cursors.signing_key(SECRET))
        self.assertNotEqual(app.extensions['api_cursor_key'], SECRET.encode('utf-8')[:32])
        self.assertIsNone(self.app().extensions['api_cursor_key'])
        self.assertIs(cursors._KEY, process_key)
        body = app.test_client().get('/api/v1/meta').get_data(as_text=True)
        self.assertNotIn(SECRET, body)
        self.assertNotIn('API_CURSOR_SECRET_KEY', body)


if __name__ == '__main__':
    unittest.main()
