import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release', ROOT / 'scripts/release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def test_all_runtime_links_exist_and_version_matches(self):
        release.validate(ROOT, release.runtime_files(ROOT))

    def test_archives_are_repeatable_and_exclude_browser_metadata(self):
        files = release.runtime_files(ROOT)
        manifest = release.validate(ROOT, files)
        manifest['permissions'].remove('declarativeNetRequestFeedback')
        with tempfile.TemporaryDirectory() as directory:
            a, b = [Path(directory) / name for name in ('a.zip', 'b.zip')]
            release.archive(a, ROOT, files, manifest)
            release.archive(b, ROOT, files, manifest)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            with zipfile.ZipFile(a) as archive:
                self.assertIn('manifest.json', archive.namelist())
                self.assertIn('LICENSE', archive.namelist())
                self.assertIn('vendor/adaway/hosts.txt', archive.namelist())
                self.assertFalse(any(n.startswith(('_metadata/', 'node_modules/', 'tests/', '.git/'))
                                     for n in archive.namelist()))
                self.assertNotIn('declarativeNetRequestFeedback',
                                 json.loads(archive.read('manifest.json'))['permissions'])

    def test_missing_about_page_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Broken packaged link'):
            release.validate(ROOT, release.runtime_files(ROOT) - {'about.html'})
