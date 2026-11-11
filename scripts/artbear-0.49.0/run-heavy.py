import json
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[2]
logs = root.parent / 'restoration-20261111'
logs.mkdir(parents=True, exist_ok=True)
lock = (logs / 'heavy.lock').open('a')
fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
label = sys.argv[1]
assert re.fullmatch(r'[a-z0-9-]+', label)
command = sys.argv[2:]
unit = f'bb-core049-{label}-{os.getpid()}.scope'
env = dict(os.environ)
env.update({
    'PATH': str(logs / 'bin') + ':' + str(root / 'node_modules/.bin') + ':' + env['PATH'],
    'NODE_OPTIONS': '--max-old-space-size=640 --max-semi-space-size=16',
    'UV_THREADPOOL_SIZE': '1',
    'MALLOC_ARENA_MAX': '2',
    'GOMAXPROCS': '1',
    'GOMEMLIMIT': '512MiB',
    'RAYON_NUM_THREADS': '1',
    'VITEST_MAX_WORKERS': '1',
    'PNPM_WORKERS': '1',
    'TURBO_TELEMETRY_DISABLED': '1',
    'DO_NOT_TRACK': '1',
    'ELECTRON_SKIP_BINARY_DOWNLOAD': '1',
})
argv = ['systemd-run', '--user', '--scope', '--unit=' + unit.removesuffix('.scope'), '--slice=bb-heavy.slice', '--', *command]
start = time.time()
peak = 0
events = {}
group = None
with (logs / (label + '.log')).open('w') as log:
    process = subprocess.Popen(argv, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
    while process.poll() is None:
        if group is None:
            probe = subprocess.run(['systemctl', '--user', 'show', unit, '--property=ControlGroup', '--value'], text=True, capture_output=True)
            if probe.returncode == 0 and probe.stdout.strip():
                group = Path('/sys/fs/cgroup' + probe.stdout.strip())
        if group is not None:
            try:
                peak = max(peak, int((group / 'memory.peak').read_text()))
                events = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
            except FileNotFoundError:
                pass
        time.sleep(0.25)
result = {
    'command': command,
    'cwd': str(root),
    'unit': unit,
    'slice': 'bb-heavy.slice',
    'exit_code': process.returncode,
    'elapsed_seconds': round(time.time() - start, 3),
    'memory_peak_sampled_bytes': peak,
    'memory_events_sampled': events,
    'bounded_environment': {key: value for key, value in env.items() if key in ['NODE_OPTIONS', 'UV_THREADPOOL_SIZE', 'MALLOC_ARENA_MAX', 'GOMAXPROCS', 'GOMEMLIMIT', 'RAYON_NUM_THREADS', 'VITEST_MAX_WORKERS']},
}
(logs / (label + '-result.json')).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
print((logs / (label + '.log')).read_text()[-4500:])
sys.exit(process.returncode)
