import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

root = Path(__file__).resolve().parents[2]
release = Path(sys.argv[1]).resolve()
logs = root.parent / 'restoration-20261111'
package = release / 'node_modules/bb-app'
assert not Path('/home/hermes/.bb/bb.db').exists(), 'Run inside the documented isolated mount/network namespace.'

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

with tempfile.TemporaryDirectory(prefix='runtime-smoke-', dir=logs) as temporary:
    work = Path(temporary)
    data = work / 'data'
    home = work / 'home'
    data.mkdir()
    home.mkdir()
    server_port, daemon_port = port(), port()
    url = f'http://127.0.0.1:{server_port}'
    env = {
        'PATH': '/home/hermes/.local/bin:/usr/bin:/bin', 'HOME': str(home),
        'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_CACHE_HOME': str(home / '.cache'),
        'BB_DATA_DIR': str(data), 'BB_SERVER_URL': url, 'BB_HOST_DAEMON_PORT': str(daemon_port),
        'BB_TELEMETRY': 'false', 'BB_SKIP_ONBOARDING': '1', 'NODE_ENV': 'production',
        'NODE_OPTIONS': '--max-old-space-size=512 --max-semi-space-size=16',
        'UV_THREADPOOL_SIZE': '1', 'GOMAXPROCS': '1',
    }
    initializer = '''
import { createConnection, migrate } from "./packages/db/src/index.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const db = createConnection(join(process.env.BB_DATA_DIR, "bb.db"));
migrate(db);
const base = process.argv[1];
for (const name of readdirSync(base)) {
  const manifest = JSON.parse(readFileSync(join(base, name, "package.json"), "utf8"));
  const id = manifest.name.replace(/^bb-plugin-/, "");
  db.$client.prepare("insert into plugins(id, source, provenance, source_kind, source_builtin_name, root_dir, version, enabled, installed_at, updated_at) values(?, ?, 'builtin', 'builtin', ?, ?, ?, ?, 0, 0)")
    .run(id, "builtin:" + name, name, join(base, name), manifest.version, ["provider-codex", "bb--provider-usage"].includes(id) ? 1 : 0);
}
db.$client.close();
'''
    subprocess.run(['node', '--conditions=source', '--import', 'tsx', '--input-type=module', '--eval', initializer,
                    str(package / 'server/dist/builtin-plugins')], cwd=root, env=env, check=True)
    with (logs / 'release-runtime.log').open('w') as log:
        process = subprocess.Popen([
            'node', str(package / 'dist/bb-app.js'), '--data-dir', str(data),
            '--server-bind-host', '127.0.0.1', '--server-port', str(server_port),
            '--host-daemon-port', str(daemon_port), '--bundled', '--no-in-app-updates',
        ], env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        start = time.monotonic()
        report = {}
        try:
            while time.monotonic() - start < 120:
                assert process.poll() is None, f'Runtime exited {process.returncode}'
                try:
                    with urllib.request.urlopen(url + '/health', timeout=1) as response:
                        if json.load(response).get('ok'):
                            break
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError('Isolated runtime health timeout')
            while time.monotonic() - start < 150:
                result = subprocess.check_output(['node', str(package / 'dist/bb.js'), 'plugin', 'list', '--json'], env=env, timeout=20)
                states = {p['id']: p['status'] for p in json.loads(result)['plugins']}
                if all(states.get(p) == 'running' for p in ['provider-codex', 'bb--provider-usage']):
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError(f'Plugin readiness timeout: {states}')
            hosts = json.loads(subprocess.check_output(['node', str(package / 'dist/bb.js'), 'machine', 'list', '--json'], env=env, timeout=20))
            version = subprocess.check_output(['node', str(package / 'dist/bb.js'), '--version'], env=env, text=True).strip()
            assert version == '0.49.0', version
            report = {'health': True, 'version': version, 'pluginStates': states,
                      'daemonConnected': any(h['status'] == 'connected' for h in hosts),
                      'elapsedSeconds': round(time.monotonic() - start, 3),
                      'freshDatabase': True, 'productionDataMasked': True, 'networkNamespace': os.readlink('/proc/self/ns/net')}
            assert report['daemonConnected'], hosts
            (logs / 'release-smoke-result.json').write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report))
        finally:
            subprocess.run(['node', str(package / 'dist/bb-app.js'), '--data-dir', str(data), 'stop'], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=30)
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
