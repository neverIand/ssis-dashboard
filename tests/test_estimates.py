"""Opt-in active-estimate cache (UX batch C4): lifetime, bound, recency and thread safety."""

from threading import Thread
import unittest

from dashboard.estimates import MAX_ENTRIES, MISSING, EstimateCache


class EstimateCacheTests(unittest.TestCase):
    def setUp(self):
        self.now = 0.0
        self.cache = EstimateCache(60, entries=3, clock=lambda: self.now)

    def test_values_including_no_sample_live_for_the_configured_seconds(self):
        self.cache.put(('1', 's'), {'sample_count': 1})
        self.cache.put(('2', 's'), None)
        self.assertEqual(self.cache.get(('1', 's')), {'sample_count': 1})
        self.assertIsNone(self.cache.get(('2', 's')))
        self.assertIs(self.cache.get(('1', 'other start')), MISSING)
        self.now = 59.9
        self.assertIsNone(self.cache.get(('2', 's')))
        self.now = 60
        self.assertIs(self.cache.get(('1', 's')), MISSING)
        self.assertIs(self.cache.get(('2', 's')), MISSING)
        self.assertEqual(len(self.cache), 0)

    def test_the_least_recently_used_entry_leaves_first_at_the_bound(self):
        for key in ('1', '2', '3'):
            self.cache.put((key, 's'), key)
        self.cache.get(('1', 's'))
        self.cache.put(('4', 's'), '4')
        self.assertEqual(len(self.cache), 3)
        self.assertIs(self.cache.get(('2', 's')), MISSING)
        self.assertEqual([self.cache.get((key, 's')) for key in ('1', '3', '4')], ['1', '3', '4'])
        self.assertEqual(MAX_ENTRIES, 4096)

    def test_concurrent_writers_keep_the_bound(self):
        cache = EstimateCache(60, entries=50)
        threads = [Thread(target=lambda base=base: [cache.put((str(base * 1000 + i), 's'), i) for i in range(200)])
                   for base in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(cache), 50)
