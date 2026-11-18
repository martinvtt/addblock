"""Build deterministic, allowlisted extension and source archives offline."""

import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ('manifest.json', 'background.js', 'statistics.js', 'rules.js',
           'popup.html', 'popup.css', 'popup.js', 'popup-guard.js', 'popup-bridge.js',
           'cosmetics.js', 'diagnostics.html', 'diagnostics.js', 'about.html', 'about.css',
           'LICENSE', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.txt', 'INSTALL.txt', 'INSTALL.html')


def runtime_files(root):
    files = set(RUNTIME)
    files.update(f'icons/icon-{size}.png' for size in (16, 32, 48, 128))
    files.update(('rules/advertising.json', 'rules/sources.json', 'rules/base-domains.json',
                  'vendor/adaway/hosts.txt'))
    for name in files:
        if not (root / name).is_file() or (root / name).is_symlink():
            raise ValueError(f'Missing or unsafe release file: {name}')
    return files


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        self.links.extend(value for key, value in attrs if key in ('href', 'src') and value)


def validate(root, files):
    manifest = json.loads((root / 'manifest.json').read_text())
    package = json.loads((root / 'package.json').read_text())
    if manifest['version'] != package['version']:
        raise ValueError('Manifest and package versions differ.')
    if len(manifest['description']) > 132:
        raise ValueError('Manifest description exceeds the Store limit.')
    for name in files:
        if name.endswith('.html'):
            parser = Links()
            parser.feed((root / name).read_text())
            for link in parser.links:
                parsed = urlsplit(link)
                if not parsed.scheme and parsed.path:
                    target = (Path(name).parent / parsed.path).as_posix()
                    if target not in files:
                        raise ValueError(f'Broken packaged link: {name} -> {link}')
    return manifest


def archive(path, root, files, manifest=None, prefix=''):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as output:
        for name in sorted(files):
            data = (json.dumps(manifest, indent=2) + '\n').encode() if name == 'manifest.json' and manifest else (root / name).read_bytes()
            entry = zipfile.ZipInfo(prefix + name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, data)


def build(root=ROOT):
    files = runtime_files(root)
    manifest = validate(root, files)
    # Debug feedback is not required by the distributed extension.
    manifest['permissions'].remove('declarativeNetRequestFeedback')
    dist = root / 'dist'
    dist.mkdir(exist_ok=True)
    version = manifest['version']
    extension = dist / f'addblock-{version}.zip'
    archive(extension, root, files, manifest)
    source_files = files | {'README.md', 'TESTING.txt', 'package.json', 'package-lock.json',
                            '.gitignore', 'CHANGELOG.md'}
    for folder in ('scripts', 'tests', 'demo', 'docs', '.github'):
        source_files.update(p.relative_to(root).as_posix() for p in (root / folder).rglob('*')
                            if p.is_file() and not p.is_symlink()
                            and '__pycache__' not in p.parts and p.suffix != '.pyc')
    source = dist / f'addblock-{version}-source.zip'
    archive(source, root, source_files, prefix='addblock/')
    checksums = '\n'.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}'
                          for p in (extension, source)) + '\n'
    (dist / 'SHA256SUMS.txt').write_text(checksums)
    return extension, source


if __name__ == '__main__':
    subprocess.run([sys.executable, str(ROOT / 'scripts/filters.py'), '--check'], check=True)
    for artifact in build():
        print(artifact)
