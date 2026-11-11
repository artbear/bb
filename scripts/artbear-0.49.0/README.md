# Personal BB 0.49.0 release

This recipe restores the active 0.48.1 features on upstream
`7b26cae79ec978fafd0a5db0e8517e94f12eb8f4`. It does not include historical
`SplitThreadArea` WIP. Run from this checkout. Production activation belongs to
the infrastructure executor; these commands only build a separate release.

## Dependencies

Use Node 22.23.2 and pnpm 9.15.0. Obtain pnpm with
`npm exec --yes --package=pnpm@9.15.0 -- pnpm --version` if necessary, then pass
its `bin/pnpm.cjs` path to the installer. On the original builder that path was
`/tmp/bb-0490-npm-cache/_npx/3d41f72c9dd7981b/node_modules/pnpm/bin/pnpm.cjs`.

```sh
python3 scripts/artbear-0.49.0/install-selected.py /path/to/pnpm/bin/pnpm.cjs
```

The installer uses the frozen lockfile, ignores lifecycle scripts, selects 66
of 117 workspace projects and limits CPU architecture to the current machine
while installing. It restores the original package.json bytes in `finally`.
Mobile, web, EAS and unrelated plugins are outside the selected graph. The
Claude and ACP provider packages are required by the server's first-party
provider test harness. Electron binary downloads are disabled.

`run-heavy.py` puts each command in the existing `bb-heavy.slice`; its limit
is not changed. Commands use one Turbo task, one test worker, Node heap640,
GOMAXPROCS1 and GOMEMLIMIT512MiB. It stores commands, logs and measured results
in the sibling `restoration-20261111` directory. These outputs are not source.
Only one operator may use the machine's heavy-command window at a time.

## Published SDK declarations and generated prerequisites

The SDK source is unchanged from upstream 0.6.132. Use the published
`@get-bb/plugin-sdk@0.6.132` tarball, obtained with `npm pack` into a temporary
directory. Its SHA-256 is
`3bbc7f5dfd68bdbddedd470e68cde4468d85356c36f31c130ea140aec49d9d18`.
The preparation script verifies that hash and both package versions, then
copies exactly 22 bundled declarations. It does not run the SDK's type
generator, which explicitly requests a 4GiB heap. SDK runtime code is built
from this checkout.

```sh
python3 scripts/artbear-0.49.0/prepare-sdk-types.py /tmp/get-bb-plugin-sdk-0.6.132.tgz
python3 scripts/artbear-0.49.0/run-heavy.py native node scripts/ensure-native-modules.mjs
python3 scripts/artbear-0.49.0/run-heavy.py generators pnpm exec turbo run generate:templates generate:plugin-scaffold generate generate:bb-official-marketplace generate:profile-worker --filter=@bb/templates --filter=@bb/plugin-build --filter=@bb/server --filter=@bb/process-utils --concurrency=1 --env-mode=loose --output-logs=errors-only --summarize=false
python3 scripts/artbear-0.49.0/run-heavy.py sdk pnpm exec turbo run build --filter=@get-bb/plugin-sdk --concurrency=1 --env-mode=loose --output-logs=errors-only --summarize=false
python3 scripts/artbear-0.49.0/run-heavy.py bridges pnpm exec turbo run generate:test-bridges --filter=@bb/agent-runtime --concurrency=1 --env-mode=loose --output-logs=errors-only --summarize=false
```

## Focused verification

The direct Turbo tasks use `--only` after the explicit prerequisites above.
Published declarations satisfy the type input; `build:types` is not claimed as
having run. The native check uses a real temporary in-memory SQLite database.

```sh
python3 scripts/artbear-0.49.0/run-heavy.py domain pnpm exec turbo run test --filter=@bb/domain --only --concurrency=1 --env-mode=loose -- host-path.test.ts
python3 scripts/artbear-0.49.0/run-heavy.py providers pnpm exec turbo run test --filter=bb-plugin-provider-codex --filter=bb-plugin-bb--provider-usage --only --concurrency=1 --env-mode=loose -- reset-credits.test usage-source.test server.test settings.test
python3 scripts/artbear-0.49.0/run-heavy.py routes pnpm exec turbo run test --filter=@bb/server --only --concurrency=1 --env-mode=loose -- absolute-path-host.test.ts file-content-routes.test.ts app-keybindings.test.ts
python3 scripts/artbear-0.49.0/run-heavy.py interface pnpm exec turbo run test --filter=@bb/app --filter=@bb/desktop --filter=bb-app --filter=@bb/cli --only --concurrency=1 --env-mode=loose -- AppCommandProvider.test CommandPalette.test keyboard-shortcut-settings.test plugin-command-keybindings.test file-content-urls.test desktop-browser-shortcuts.test desktop-reload-shortcut.test cli-reexec.test command-output/settings.test
python3 scripts/artbear-0.49.0/run-heavy.py types pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/app --filter=@bb/server --filter=@bb/cli --filter=@bb/desktop --filter=bb-app --filter=bb-plugin-provider-codex --filter=bb-plugin-bb--provider-usage --only --concurrency=1 --env-mode=loose --output-logs=errors-only
python3 scripts/artbear-0.49.0/run-heavy.py helpers node --test scripts/codex-reset-maintenance.test.mjs scripts/codex-reset-deployment.test.mjs
python3 -B -m unittest discover -s scripts/automations -p 'test_*.py' -v
```

The route tests use the official new UNC URL encoding and exercise the Hono
route and actual host-RPC responder, including opposite-OS routing and an
unavailable target. Reset-credit tests use mocked GET responses and preserve
normal quota/error behavior. Helper tests use isolated temporary files and
verify rollback and that the deployment record follows successful UI checks.

## Source builds and assembly

Commit source changes before the final builds so embedded commit metadata and
the release manifest identify the same source. The official base must be a
complete, already installed `bb-app@0.49.0`, including its native dependencies.

```sh
python3 scripts/artbear-0.49.0/run-heavy.py components pnpm exec turbo run build --filter=@bb/app --filter=@bb/server --filter=@bb/cli --filter=@bb/host-daemon --filter=@bb/plugin-build --concurrency=1 --env-mode=loose --output-logs=errors-only --summarize=false
python3 scripts/artbear-0.49.0/run-heavy.py codex env BB_DATA_DIR=/tmp/artbear-0490-build-data bb plugin build plugins/provider-codex
python3 scripts/artbear-0.49.0/run-heavy.py usage env BB_DATA_DIR=/tmp/artbear-0490-build-data bb plugin build plugins/provider-usage
python3 scripts/artbear-0.49.0/run-heavy.py assemble node scripts/artbear-0.49.0/assemble-release.mjs /path/to/official-install /path/to/new-release
```

The assembler retains unchanged builtin payloads from the same official base,
overlays the two source-built plugin dist directories in an ignored staging
directory, and runs the upstream `bb-app` packager. It copies the official
installation into a new directory, replaces its code directories with those
packaged outputs, preserves relative symlinks and writes `artbear-build.json`
with the source commit and SHA-256 of every code/resource file. The official
base and its dependencies remain untouched. Native Electron distribution and
updates of other machines are outside this server-release recipe.

## Helpers and activation

Codex helper data defaults to `~/.bb`; an explicit `BB_DATA_DIR` is supported.
The private deployment record is written only after installed UI validation.
The new release must pass cutover and runtime checks before a production
deployment/check helper is run; no helper is executed against production
during this build. A real authenticated UI check remains part of activation.

The copied Hermes release-review source matches the active stored script:
Cursor `default`, permission `full`, daily19:27 Moscow tick, every-four-day
review gate. Its cron and stored script are not changed by this recipe.
Codex maintenance source and its three-day gate are retained. No matching
automation was found in the BB or Personal projects or user crontab during the
11November check, so this build does not create or modify its schedule.
