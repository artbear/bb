import json
from pathlib import Path
import subprocess
import os
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
release = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='artbear-usage-ui-') as temporary:
    data = Path(temporary)
    machine = {
        'id': 'host-fixture', 'displayName': 'Fixture machine', 'status': 'connected',
        'error': None, 'providers': [{
            'id': 'codex', 'providerId': 'codex', 'accountLabel': 'fixture@example.com',
            'displayName': 'Codex', 'logoUrl': None, 'icon': None,
            'strings': {'iconTint': None}, 'signInHint': 'Sign in', 'expiredHint': 'Expired',
            'usage': {'status': 'ok', 'accountEmail': 'fixture@example.com', 'planLabel': 'Fixture',
                      'windows': [{'label': 'Weekly limit', 'usedPercent': 42,
                                   'resetsAt': '2030-01-03T07:00:00Z', 'cost': None}]},
            'resetCredits': {'status': 'ok', 'availableCount': 3, 'credits': [
                {'id': 'later', 'expiresAt': '2030-01-02T07:00:00Z'},
                {'id': 'earlier', 'expiresAt': '2030-01-01T07:00:00Z'},
                {'id': 'permanent', 'expiresAt': None},
            ]},
        }],
    }
    (data / 'bb-app-runtime.json').write_text(json.dumps({
        'version': '0.49.0', 'entryPath': str(release / 'node_modules/bb-app/dist/bb-app.js'),
    }))
    (data / 'host-id').write_text(machine['id'])
    fixture = data / 'usage.json'
    fixture.write_text(json.dumps({'machines': [machine]}))
    cli = data / 'fixture-bb'
    cli.write_text('#!/usr/bin/env node\n' +
                   'process.stdout.write(require("node:fs").readFileSync(' + json.dumps(str(fixture)) + ',"utf8"));\n')
    cli.chmod(0o755)
    subprocess.run(['node', 'scripts/verify-codex-reset-ui.mjs'], cwd=root, check=True,
                   env={**os.environ, 'BB_DATA_DIR': str(data), 'BB_CLI': str(cli)})
