import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
recipe = Path(__file__).parent
logs = root.parent / 'restoration-20261111'
pnpm_entry = Path(sys.argv[1]).resolve(strict=True)
manifest = json.loads((pnpm_entry.parent.parent / 'package.json').read_text())
assert manifest['version'] == '9.15.0'
node = shutil.which('node')
assert node
(logs / 'bin').mkdir(parents=True, exist_ok=True)
shim = logs / 'bin/pnpm'
shim.write_text('#!/bin/sh\nexec ' + shlex.quote(node) + ' ' + shlex.quote(str(pnpm_entry)) + ' "$@"\n')
shim.chmod(0o755)
filters = [
    'bb', '@bb/app...', '@bb/server...', '@bb/cli...', '@bb/host-daemon...',
    'bb-app...', 'bb-plugin-provider-codex...', 'bb-plugin-bb--provider-usage...',
    '@bb/desktop...', 'bb-plugin-provider-claude-code...', 'bb-plugin-provider-acp...',
]
command = [sys.executable, str(recipe / 'run-heavy.py'), 'selected-install', 'pnpm']
for selected in filters:
    command.extend(['--filter', selected])
command.extend([
    'install', '--frozen-lockfile', '--ignore-scripts', '--child-concurrency=1',
    '--network-concurrency=1', '--reporter=append-only',
])
package_path = root / 'package.json'
original = package_path.read_bytes()
package = json.loads(original)
package['pnpm']['supportedArchitectures']['cpu'] = ['current']
try:
    package_path.write_text(json.dumps(package, indent=2) + '\n')
    result = subprocess.run(command, cwd=root)
finally:
    package_path.write_bytes(original)
sys.exit(result.returncode)
