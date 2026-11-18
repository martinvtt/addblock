import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('filters', Path(__file__).resolve().parents[1] / 'scripts/filters.py')
filters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(filters)


class FiltersTest(unittest.TestCase):
    def test_hosts_syntax_and_comments(self):
        source = '127.0.0.1 Ads.Example.org alias.example.org # ignored.example.org\n0.0.0.0 ads.example.org\n'
        self.assertEqual(filters.parse_hosts(source), {'ads.example.org', 'alias.example.org'})

    def test_local_and_invalid_entries(self):
        source = '\n'.join(['127.0.0.1 localhost', '::1 localhost', '127.0.0.1 127.0.0.1',
                            '127.0.0.1 *.example.org', '127.0.0.1 https://example.org',
                            '127.0.0.1 -invalid.example', '8.8.8.8 safe.example'])
        self.assertEqual(filters.parse_hosts(source), set())

    def test_incomplete_download_rejected(self):
        with self.assertRaises(ValueError):
            filters.build('<html>Temporary server error</html>')

    def test_base_preserved_and_main_navigation_excluded(self):
        result = filters.build('\n'.join(f'127.0.0.1 ad{i}.example.org' for i in range(1000)))
        rule = result['rules/advertising.json'][0]
        self.assertIn('exoclick.com', rule['condition']['requestDomains'])
        self.assertNotIn('main_frame', rule['condition']['resourceTypes'])
        self.assertEqual(result['rules/sources.json']['communityDomains'], 1000)
