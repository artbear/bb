import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.BB_DATA_DIR ?? "/data";
const statePath = join(dataDir, "codex-reset-deployment.json");
const runtime = JSON.parse(
  readFileSync(join(dataDir, "bb-app-runtime.json"), "utf8"),
);
const installed = resolve(
  dirname(runtime.entryPath),
  "../server/dist/builtin-plugins",
);
const files = [
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
const sources = [
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
  "scripts/verify-codex-reset-ui.mjs",
];
const sha = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceHashes = () =>
  Object.fromEntries(sources.map((path) => [path, sha(join(root, path))]));
const bb = (args) =>
  execFileSync(process.env.BB_CLI ?? "bb", args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });

if (process.argv[2] === "--deploy") {
  const sourceVersion = JSON.parse(
    readFileSync(join(root, "packages/bb-app/package.json"), "utf8"),
  ).version;
  if (sourceVersion !== runtime.version)
    throw new Error(
      "Adapt the fork to the installed BB release before deployment.",
    );
  const payloads = files.map(([plugin, name]) => ({
    plugin,
    name,
    content: readFileSync(join(root, "plugins", plugin, "dist", name)),
  }));
  const backup = join(
    dataDir,
    "codex-reset-backups",
    new Date().toISOString().replaceAll(":", "-"),
  );
  mkdirSync(backup, { recursive: true, mode: 0o700 });
  for (const { plugin, name } of payloads) {
    const target = join(backup, plugin, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(installed, plugin, "dist", name), target);
  }
  try {
    for (const { plugin, name, content } of payloads) {
      const target = join(installed, plugin, "dist", name);
      writeFileSync(target + ".codex-reset-tmp", content);
      renameSync(target + ".codex-reset-tmp", target);
    }
    for (const plugin of ["provider-codex", "bb--provider-usage"])
      bb(["plugin", "reload", plugin, "--json"]);
    writeFileSync(
      statePath,
      JSON.stringify(
        {
          version: runtime.version,
          entryPath: runtime.entryPath,
          deployedAt: new Date().toISOString(),
          sources: sourceHashes(),
          artifacts: Object.fromEntries(
            files.map(([plugin, name]) => {
              const path = join(plugin, "dist", name);
              return [path, sha(join(installed, path))];
            }),
          ),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({ deployed: true, version: runtime.version, backup }),
    );
  } catch (error) {
    for (const { plugin, name } of payloads)
      copyFileSync(
        join(backup, plugin, name),
        join(installed, plugin, "dist", name),
      );
    for (const plugin of ["provider-codex", "bb--provider-usage"])
      bb(["plugin", "reload", plugin, "--json"]);
    throw error;
  }
} else if (process.argv[2] !== "--check") {
  throw new Error("Use --deploy or --check.");
}

if (!existsSync(statePath))
  throw new Error("Codex reset deployment record is missing.");
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (runtime.entryPath !== state.entryPath || runtime.version !== state.version)
  throw new Error("BB was updated; adapt and redeploy the source patch.");
for (const [path, hash] of Object.entries(state.sources))
  if (sha(join(root, path)) !== hash)
    throw new Error(`Source patch changed or is missing: ${path}`);
for (const [path, hash] of Object.entries(state.artifacts))
  if (sha(join(installed, path)) !== hash)
    throw new Error(`Installed patch changed or is missing: ${path}`);
execFileSync(
  process.execPath,
  [join(root, "scripts/verify-codex-reset-ui.mjs")],
  { stdio: "inherit", timeout: 90_000 },
);
