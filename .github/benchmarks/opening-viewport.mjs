import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const output = join(process.env.RUNNER_TEMP || tmpdir(), 'opening-viewport');
mkdirSync(output, { recursive: true });
const path = 'apps/app/src/views/thread-detail/thread-opening.model.test.tsx';
const reportPath = 'apps/app/.ci-benchmark-tests.json';
const variants = Object.fromEntries(['baseline', 'candidate'].map(name => [name, readFileSync(`.github/benchmarks/opening-${name}.txt`)]));
const order = process.env.BENCHMARK_ORDER === 'candidate-first' ? ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline'];
const command = 'pnpm exec turbo run test --filter=@bb/app --only --force --output-logs=full --concurrency=2 -- --reporter=json --outputFile=.ci-benchmark-tests.json';
const rows = [];
let expected;
try {
  for (const [index, variant] of order.entries()) {
    writeFileSync(path, variants[variant]);
    rmSync(reportPath, { force: true });
    const fd = openSync(join(output, `${index}-${variant}.log`), 'w');
    const started = performance.now();
    const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { env: process.env, stdio: ['ignore', fd, fd], timeout: 600000 });
    const seconds = (performance.now() - started) / 1000;
    closeSync(fd);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const inventory = [];
    const durations = [];
    for (const file of report.testResults) {
      const name = file.name.replaceAll('\\', '/').split('/apps/app/').at(-1);
      durations.push({ name, seconds: (file.endTime - file.startTime) / 1000, startTime: file.startTime, endTime: file.endTime });
      for (const test of file.assertionResults) {
        const title = test.fullName;
        inventory.push([name, title, test.status]);
      }
    }
    inventory.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const serialized = JSON.stringify(inventory);
    expected ??= serialized;
    const row = { variant, seconds, status: run.status, error: run.error?.message, tests: inventory.length, identical: serialized === expected, inventoryHash: createHash('sha256').update(serialized).digest('hex'), opening: durations.find(x => x.name.endsWith('/thread-opening.model.test.tsx')) };
    rows.push(row);
    writeFileSync(join(output, `${index}-${variant}-inventory.json`), JSON.stringify(inventory, null, 2));
    writeFileSync(join(output, `${index}-${variant}-durations.json`), JSON.stringify(durations, null, 2));
    writeFileSync(join(output, 'results.json'), JSON.stringify(rows, null, 2));
    console.log(JSON.stringify(row));
    if (run.status !== 0 || !row.identical || inventory.length < 500) throw new Error('App shard failed or inventory changed');
  }
} finally {
  writeFileSync(path, variants.baseline);
}
