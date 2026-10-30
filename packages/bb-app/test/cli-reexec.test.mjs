import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildNodeEsmEntry } from "../../../scripts/build-utils.mjs";
import { renderCliLauncher } from "../src/cli-launcher.js";

const execFileAsync = promisify(execFile);
let root;
let entry;
let launcher;
let alias;
let override;
let guard;
let legacyLauncher;

describe.skipIf(process.platform === "win32")("installed CLI hand-off", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-cli-reexec-"));
    entry = join(root, "dist", "bb.js");
    launcher = join(root, "data", "bin", "bb");
    alias = join(root, "bb-alias");
    override = join(root, "bb-override");
    guard = join(root, "guard.mjs");
    legacyLauncher = join(root, "legacy-launcher.mjs");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ type: "module", version: "1.0.0" }),
    );
    await buildNodeEsmEntry({
      cleanDist: false,
      entryPoint: fileURLToPath(new URL("../src/bin/bb.ts", import.meta.url)),
      executable: true,
      outfile: entry,
      packageRoot: root,
      sourcemap: false,
    });
    const bundleDir = join(root, "host-daemon", "dist");
    await mkdir(join(bundleDir, "bb-chunks"), { recursive: true });
    for (const name of [
      "daemon-bundle.mjs",
      "bb-chunks/fixture.js",
      "bb-provider-bridge-worker.mjs",
      "bb-parcel-watcher-child.mjs",
      "bb-plugin-host-worker.mjs",
    ]) {
      await writeFile(join(bundleDir, name), "");
    }
    for (const [target, label] of [
      [join(bundleDir, "bb"), "bundled"],
      [override, "override"],
    ]) {
      await writeFile(
        target,
        `#!/usr/bin/env node
console.log(JSON.stringify({
  target: ${JSON.stringify(label)},
  argv: process.argv.slice(2),
  handoff: process.env.BB_CLI_REEXEC,
  starts: Number(process.env.BB_TEST_CLI_STARTS),
}));
`,
        { mode: 0o755 },
      );
    }
    await mkdir(join(root, "data", "bin"), { recursive: true });
    await writeFile(
      launcher,
      renderCliLauncher({
        dataDir: join(root, "data"),
        platform: process.platform,
        target: {
          electron: false,
          entryPath: entry,
          kind: "direct",
          runtimePath: process.execPath,
        },
      }),
      { mode: 0o755 },
    );
    await symlink(launcher, alias);
    await writeFile(
      legacyLauncher,
      `#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const target = process.env.BB_CLI;
const result = spawnSync(
  target ?? process.execPath,
  target ? process.argv.slice(2) : [${JSON.stringify(join(bundleDir, "bb"))}, ...process.argv.slice(2)],
  { env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
`,
      { mode: 0o755 },
    );
    await writeFile(
      guard,
      `const starts = Number(process.env.BB_TEST_CLI_STARTS ?? 0) + 1;
if (starts > 3) {
  process.stderr.write("Recursive CLI hand-off detected\\n");
  process.exit(93);
}
process.env.BB_TEST_CLI_STARTS = String(starts);
`,
    );
  }, 30_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  async function run(env) {
    const result = await execFileAsync(
      process.execPath,
      [entry, "machine", "list", "--json"],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("BB_"),
            ),
          ),
          BB_DATA_DIR: join(root, "data"),
          NODE_OPTIONS: `--import=${pathToFileURL(guard).href}`,
          ...env,
        },
        timeout: 5_000,
      },
    );
    return JSON.parse(result.stdout);
  }

  it.for(["launcher", "symlink", "entrypoint"])(
    "reaches the bundled CLI when BB_CLI points to the %s",
    async (target) => {
      const paths = { launcher, symlink: alias, entrypoint: entry };
      expect(await run({ BB_CLI: paths[target] })).toEqual({
        target: "bundled",
        argv: ["machine", "list", "--json"],
        handoff: "1",
        starts: 3,
      });
    },
  );

  it("does not follow an override again after a CLI hand-off", async () => {
    expect(await run({ BB_CLI: launcher, BB_CLI_REEXEC: "1" })).toEqual({
      target: "bundled",
      argv: ["machine", "list", "--json"],
      handoff: "1",
      starts: 2,
    });
  });

  it("preserves a custom CLI override and marks its hand-off", async () => {
    expect(await run({ BB_CLI: override })).toEqual({
      target: "override",
      argv: ["machine", "list", "--json"],
      handoff: "1",
      starts: 2,
    });
  });

  it("reaches the bundled CLI through a legacy launcher that ignores the hand-off marker", async () => {
    expect(await run({ BB_CLI: legacyLauncher })).toEqual({
      target: "bundled",
      argv: ["machine", "list", "--json"],
      handoff: "1",
      starts: 3,
    });
  });
});
