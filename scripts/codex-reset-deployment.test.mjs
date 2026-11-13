import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

const artifacts = [
  ...["server.js", "server.meta.json", "host.js", "host.meta.json"].map(
    (name) => ["provider-codex", name],
  ),
  ...[
    "server.js",
    "server.meta.json",
    "app.js",
    "app.css",
    "app.meta.json",
  ].map((name) => ["provider-usage", name]),
];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bb-reset-deployment-test-"));
  const source = join(root, "source");
  const data = join(root, "data");
  const installed = join(
    root,
    "installed",
    "server",
    "dist",
    "builtin-plugins",
  );
  const put = (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  put(
    join(source, "packages/bb-app/package.json"),
    JSON.stringify({ version: "0.49.0" }),
  );
  put(
    join(data, "bb-app-runtime.json"),
    JSON.stringify({
      version: "0.49.0",
      entryPath: join(root, "installed", "dist", "bb-app.js"),
    }),
  );
  for (const path of [
    "plugins/provider-codex/src/host.ts",
    "plugins/provider-codex/src/usage-contract.ts",
    "plugins/provider-codex/src/usage-source.ts",
    "plugins/provider-codex/src/reset-credits-contract.ts",
    "plugins/provider-codex/src/reset-credits.ts",
    "plugins/provider-usage/app.tsx",
    "plugins/provider-usage/settings.tsx",
    "plugins/provider-usage/server.ts",
    "plugins/provider-usage/usage-schema.ts",
    "plugins/provider-usage/usage-source-contract.ts",
    "plugins/provider-usage/reset-credits.tsx",
  ])
    put(join(source, path), "export {};\n");
  for (const [plugin, name] of artifacts) {
    put(join(source, "plugins", plugin, "dist", name), `new:${plugin}/${name}`);
    put(join(installed, plugin, "dist", name), `old:${plugin}/${name}`);
  }
  const checker = join(source, "scripts/verify-codex-reset-ui.mjs");
  put(
    checker,
    `import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.BB_DATA_DIR, "ui-observation.json"), JSON.stringify({
  recordExists: existsSync(join(process.env.BB_DATA_DIR, "codex-reset-deployment.json")),
}));
if (process.env.BB_TEST_UI_FAILURE === "1") throw new Error("UI validation failed");
`,
  );
  const cli = join(root, "bb-fixture");
  put(cli, "#!/usr/bin/env node\nprocess.stdout.write('{}');\n");
  chmodSync(cli, 0o755);
  const helper = join(source, "scripts/codex-reset-deployment.mjs");
  copyFileSync(
    new URL("./codex-reset-deployment.mjs", import.meta.url),
    helper,
  );
  const run = (arg, extra = {}) =>
    execFileSync(process.execPath, [helper, arg], {
      env: { ...process.env, BB_DATA_DIR: data, BB_CLI: cli, ...extra },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });
  return { root, data, installed, run };
}

test("failed UI verification restores installed files and leaves the deployment record absent", () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.run("--deploy", { BB_TEST_UI_FAILURE: "1" }),
      /UI validation failed/,
    );
    assert.equal(
      existsSync(join(f.data, "codex-reset-deployment.json")),
      false,
    );
    for (const [plugin, name] of artifacts) {
      assert.equal(
        readFileSync(join(f.installed, plugin, "dist", name), "utf8"),
        `old:${plugin}/${name}`,
      );
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a successful deployment records hashes only after the installed UI passes", () => {
  const f = fixture();
  try {
    f.run("--deploy");
    const observation = JSON.parse(
      readFileSync(join(f.data, "ui-observation.json"), "utf8"),
    );
    assert.equal(observation.recordExists, false);
    const state = JSON.parse(
      readFileSync(join(f.data, "codex-reset-deployment.json"), "utf8"),
    );
    assert.equal(state.version, "0.49.0");
    assert.equal(Object.keys(state.artifacts).length, artifacts.length);
    f.run("--check");
    assert.equal(
      JSON.parse(readFileSync(join(f.data, "ui-observation.json"), "utf8"))
        .recordExists,
      true,
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test("a stale deployment is rejected before the UI or provider is contacted", () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.data, "codex-reset-deployment.json"),
      JSON.stringify({
        version: "0.48.1",
        entryPath: "/previous-release/dist/bb-app.js",
      }),
    );
    assert.throws(() => f.run("--check"), /adapt and redeploy/);
    assert.equal(existsSync(join(f.data, "ui-observation.json")), false);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
