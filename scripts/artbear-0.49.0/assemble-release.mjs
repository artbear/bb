import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [baseArg, outputArg] = process.argv.slice(2);
if (!baseArg || !outputArg || process.argv.length !== 4) {
  throw new Error(
    "Usage: node scripts/artbear-0.49.0/assemble-release.mjs <official-install> <new-release-directory>",
  );
}
const base = resolve(baseArg);
const output = resolve(outputArg);
const sourcePackage = join(root, "packages/bb-app");
const basePackage = join(base, "node_modules/bb-app");
const source = JSON.parse(
  await readFile(join(sourcePackage, "package.json"), "utf8"),
);
const official = JSON.parse(
  await readFile(join(basePackage, "package.json"), "utf8"),
);
if (source.version !== "0.49.0" || official.version !== source.version) {
  throw new Error("The source and official base must both be BB 0.49.0.");
}
try {
  await access(output);
  throw new Error("The output directory must not exist.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=normal")) {
  throw new Error("Commit the source changes before assembling a release.");
}
const commit = git("rev-parse", "HEAD");
const directories = ["dist", "app", "server", "host-daemon"];
const builtinStage = join(root, "packages/bundled-plugins/dist");
for (const name of ["provider-codex", "provider-usage", "provider-acp"]) {
  await access(join(root, "plugins", name, "dist/server.js"));
}
await rm(builtinStage, { recursive: true, force: true });
await cp(join(basePackage, "server/dist/builtin-plugins"), builtinStage, {
  recursive: true,
  verbatimSymlinks: true,
});
for (const name of ["provider-codex", "provider-usage", "provider-acp"]) {
  const target = join(builtinStage, name, "dist");
  await rm(target, { recursive: true, force: true });
  await cp(join(root, "plugins", name, "dist"), target, { recursive: true });
}
execFileSync(
  "pnpm",
  [
    "exec",
    "turbo",
    "run",
    "build",
    "--filter=bb-app",
    "--only",
    "--force",
    "--concurrency=1",
    "--env-mode=loose",
    "--output-logs=errors-only",
    "--summarize=false",
  ],
  { cwd: root, stdio: "inherit" },
);
for (const name of directories) await access(join(sourcePackage, name));
await mkdir(dirname(output), { recursive: true });
await cp(base, output, { recursive: true, verbatimSymlinks: true });
for (const name of directories) {
  const target = join(output, "node_modules/bb-app", name);
  await rm(target, { recursive: true, force: true });
  await cp(join(sourcePackage, name), target, { recursive: true });
}
const files = {};
async function recordFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await recordFiles(path);
    else if (entry.isFile()) {
      files[relative(join(output, "node_modules/bb-app"), path)] = createHash(
        "sha256",
      )
        .update(await readFile(path))
        .digest("hex");
    }
  }
}
for (const name of directories)
  await recordFiles(join(output, "node_modules/bb-app", name));
const manifest = {
  baseVersion: source.version,
  baseGitHead: "7b26cae79ec978fafd0a5db0e8517e94f12eb8f4",
  sourceCommit: commit,
  sourceBranch: git("branch", "--show-current"),
  source: root,
  officialInstall: base,
  sdkVersion: JSON.parse(
    await readFile(join(root, "packages/plugin-sdk/package.json"), "utf8"),
  ).version,
  assembly:
    "Official npm runtime dependencies with source-built app, server, CLI, host daemon, launcher and rebuilt provider-codex, provider-usage and provider-acp; other builtin payloads retained from the same official release.",
  packageLockSha256: createHash("sha256")
    .update(await readFile(join(base, "package-lock.json")))
    .digest("hex"),
  files,
};
await writeFile(
  join(output, "artbear-build.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
process.stdout.write(
  JSON.stringify({
    output,
    sourceCommit: commit,
    files: Object.keys(files).length,
  }) + "\n",
);
