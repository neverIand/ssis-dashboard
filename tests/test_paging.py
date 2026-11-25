"""Rules shared by the paged resources through dashboard.paging (decision D1/Q1, option A)."""

import unittest
from unittest.mock import patch

from werkzeug.exceptions import NotFound

from dashboard import cursors, paging
from dashboard.timestamps import parse_timestamp
from dashboard.validation import InvalidInput


def row(identity=7, *, execution_id=42, page_empty=False, flag=False):
    return {'execution_id': execution_id, 'event_id': identity, 'page_empty': page_empty, 'flagged': flag}


class ObservationRowTests(unittest.TestCase):
    def check(self, rows, *, limit=2, flag='flagged'):
        return paging.observation_rows(rows, limit=limit, execution_id='42', identity='event_id', label='event',
                                       flag=flag)

    def test_a_page_within_limit_plus_one_returns_its_rows_and_flag(self):
        rows = [row(1, flag=True), row(2, flag=True), row(3, flag=True)]
        self.assertEqual(self.check(rows), (rows, True))
        self.assertEqual(self.check(rows[:1], flag=None), (rows[:1], None))

    def test_rejected_pages(self):
        cases = {
            'more than limit + 1 rows': [row(1), row(2), row(3), row(4)],
            'another execution': [row(1), row(2, execution_id=43)],
            'flag differs between rows': [row(1), row(2, flag=True)],
            'sentinel with other rows': [row(None, page_empty=True), row(2)],
            'sentinel with an ID': [row(5, page_empty=True)],
        }
        for label, rows in cases.items():
            with self.subTest(label), self.assertRaisesRegex(ValueError, 'Unexpected (empty )?event page'):
                self.check(rows)

    def test_the_sentinel_alone_is_an_empty_page_that_still_carries_the_flag(self):
        self.assertEqual(self.check([row(None, page_empty=True, flag=True)]), ([], True))

    def test_no_rows_means_the_execution_is_no_longer_visible(self):
        with self.assertRaises(NotFound):
            self.check([])


class FenceTests(unittest.TestCase):
    def test_scoped_and_cohort_fences(self):
        self.assertEqual(paging.fence(lambda *a, **k: {'upper_id': 9, 'f': 1}, 'r.sql', (), scoped=True, flag='f'),
                         (9, True))
        self.assertEqual(paging.fence(lambda *a, **k: {'upper_id': None}, 'r.sql', ()), (None, None))
        with self.assertRaises(NotFound):
            paging.fence(lambda *a, **k: {}, 'r.sql', (), scoped=True)
        with self.assertRaises(KeyError):
            paging.fence(lambda *a, **k: {}, 'r.sql', ())

    def test_the_flag_is_checked_before_the_upper_id(self):
        with self.assertRaises(KeyError):
            paging.fence(lambda *a, **k: {'upper_id': 0}, 'r.sql', (), scoped=True, flag='f')
        with self.assertRaisesRegex(ValueError, 'BIGINT'):
            paging.fence(lambda *a, **k: {'upper_id': 0, 'f': False}, 'r.sql', (), scoped=True, flag='f')

    def test_the_query_reads_one_row_with_the_given_parameters(self):
        calls = []
        paging.fence(lambda *a, **k: calls.append((a, k)) or {'upper_id': None}, 'r.sql', (1, None))
        self.assertEqual(calls, [(('r.sql', (1, None)), {'one_row': True})])


class CursorTests(unittest.TestCase):
    NOW = parse_timestamp('2026-11-25T12:00:00Z')

    def open(self, state):
        with patch('dashboard.paging.cursors.open_cursor', return_value=state):
            return paging.continuation({'cursor': 'c'}, resource='v1/x', selection='s', scope='p', now=self.NOW)

    def test_first_page_and_continuation(self):
        self.assertEqual(paging.continuation({}, resource='v1/x', selection='s', scope='p', now=self.NOW),
                         (None, None, None, self.NOW))
        state = {'upper_id': '9', 'last_id': '9', 'as_of': '2026-11-25T11:00:00Z'}
        self.assertEqual(self.open(state), (state, 9, 9, parse_timestamp('2026-11-25T11:00:00Z')))

    def test_last_above_upper_or_a_non_id_is_an_invalid_cursor(self):
        for upper, last in (('9', '10'), ('9', '09'), ('x', '1')):
            with self.subTest(upper=upper, last=last), self.assertRaises(InvalidInput):
                self.open({'upper_id': upper, 'last_id': last, 'as_of': '2026-11-25T11:00:00Z'})

    def test_invalid_input_with_a_cursor_becomes_an_invalid_cursor(self):
        for values, expected in (({}, InvalidInput), ({'cursor': 'c'}, cursors.InvalidCursor)):
            with self.subTest(values=values):
                with self.assertRaises(expected) as raised, paging.cursor_inputs(values):
                    raise InvalidInput('bad')
                self.assertIs(type(raised.exception), expected)
        with self.assertRaises(cursors.InvalidCursor) as raised, paging.cursor_inputs({}):
            raise cursors.InvalidCursor(expired=True)
        self.assertTrue(raised.exception.expired)
        with self.assertRaises(ValueError) as raised, paging.cursor_inputs({'cursor': 'c'}):
            raise ValueError('not input')
        self.assertIs(type(raised.exception), ValueError)


if __name__ == '__main__':
    unittest.main()
