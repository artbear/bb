import hashlib
import json
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parents[2]
archive = Path(sys.argv[1])
expected = '3bbc7f5dfd68bdbddedd470e68cde4468d85356c36f31c130ea140aec49d9d18'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == expected
assert json.loads((root / 'packages/plugin-sdk/package.json').read_text())['version'] == '0.6.132'
files = []
with tarfile.open(archive, 'r:gz') as tar:
    assert json.load(tar.extractfile('package/package.json'))['version'] == '0.6.132'
    for member in tar.getmembers():
        if member.isfile() and member.name.startswith('package/bundled-types/'):
            relative = Path(member.name.removeprefix('package/'))
            assert '..' not in relative.parts
            target = root / 'packages/plugin-sdk' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            content = tar.extractfile(member).read()
            target.write_bytes(content)
            files.append({'path': str(target.relative_to(root)), 'sha256': hashlib.sha256(content).hexdigest()})
assert len(files) == 22
logs = root.parent / 'restoration-20261111'
logs.mkdir(parents=True, exist_ok=True)
(logs / 'published-sdk-types.json').write_text(json.dumps({
    'sdk_version': '0.6.132', 'tarball_sha256': expected, 'files': files,
}, indent=2) + '\n')
print('Prepared 22 exact published SDK 0.6.132 declarations.')
