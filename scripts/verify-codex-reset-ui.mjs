import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(
  join(root, "plugins/provider-usage/package.json"),
);
const requireUi = createRequire(join(root, "packages/shared-ui/package.json"));
const dataDir = process.env.BB_DATA_DIR ?? "/data";
const runtime = JSON.parse(
  readFileSync(join(dataDir, "bb-app-runtime.json"), "utf8"),
);
const hostId = readFileSync(join(dataDir, "host-id"), "utf8").trim();
const temporary = mkdtempSync(join(tmpdir(), "bb-codex-reset-ui-"));
let snapshot;
try {
  const inputPath = join(temporary, "input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      force: true,
      machineIds: [hostId],
      providerIds: ["codex"],
      maxAgeMs: 0,
    }),
  );
  snapshot = JSON.parse(
    execFileSync(
      process.env.BB_CLI ?? "bb",
      [
        "plugin",
        "rpc",
        "call",
        "bb--provider-usage",
        "getUsage",
        "--input-file",
        inputPath,
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    ),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const machine = snapshot.machines.find((item) => item.id === hostId);
assert(machine, "Server usage must be present");
const account = machine.providers.find((item) => item.providerId === "codex");
assert.equal(
  account?.usage?.status,
  "ok",
  "Regular Codex usage must remain available",
);
assert.equal(
  account.resetCredits?.status,
  "ok",
  "Reset-credit details must be collected",
);
const expected = account.resetCredits.credits
  .filter(
    (credit) =>
      credit.expiresAt === null || Date.parse(credit.expiresAt) > Date.now(),
  )
  .sort(
    (left, right) =>
      (left.expiresAt === null ? Infinity : Date.parse(left.expiresAt)) -
      (right.expiresAt === null ? Infinity : Date.parse(right.expiresAt)),
  )
  .slice(0, 2);

const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, name, {
    value:
      typeof dom.window[name] === "function" &&
      [
        "getComputedStyle",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ].includes(name)
        ? dom.window[name].bind(dom.window)
        : dom.window[name],
    configurable: true,
  });
}
globalThis.__bbPluginRuntime = {
  react: require("react"),
  reactDom: require("react-dom"),
  jsxRuntime: require("react/jsx-runtime"),
  classVarianceAuthority: requireUi("class-variance-authority"),
  clsx: requireUi("clsx"),
  tailwindMerge: requireUi("tailwind-merge"),
  radixDropdownMenu: requireUi("@radix-ui/react-dropdown-menu"),
  radixTooltip: requireUi("@radix-ui/react-tooltip"),
  sharedUiIcon: { Icon: () => null },
};
globalThis.fetch = async () =>
  new Response(JSON.stringify({ ok: true, result: { machines: [machine] } }));
const { loadPluginApp, mountPluginContentScripts, renderSlot } = await import(
  require.resolve("@get-bb/plugin-sdk/testing/app")
);
const { waitFor, fireEvent } = require("@testing-library/react");
const bundle = resolve(
  dirname(runtime.entryPath),
  "../server/dist/builtin-plugins/provider-usage/dist/app.js",
);
const app = await loadPluginApp(() => import(pathToFileURL(bundle).href));
const mounted = await mountPluginContentScripts(app, {
  pluginId: "bb--provider-usage",
});
const item = app.experimentalSidebarFooterItems.find(
  (entry) => entry.kind === "disclosure",
);
assert(item, "Provider usage disclosure must be registered");
const view = renderSlot(
  item,
  { dismiss: () => {} },
  { pluginId: "bb--provider-usage" },
);
try {
  await waitFor(() =>
    assert(
      view.getByText(
        `Дополнительные сбросы: ${account.resetCredits.availableCount}`,
      ),
    ),
  );
  const dates = [
    ...view.container.querySelectorAll("[data-codex-reset-credits] time"),
  ];
  assert.deepEqual(
    dates.map((date) => date.dateTime),
    expected
      .filter((credit) => credit.expiresAt !== null)
      .map((credit) => credit.expiresAt),
  );
  for (const date of dates)
    assert.match(date.textContent, /\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} МСК/);
  const weekly = account.usage.windows.find((entry) =>
    /weekly/i.test(entry.label),
  );
  if (weekly?.resetsAt) {
    const row = view.getByRole("button", {
      name: new RegExp(
        "^" + weekly.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ":",
      ),
    });
    fireEvent.click(row);
    assert.match(
      row.textContent,
      /Сброс: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} МСК/,
    );
  }
  console.log(
    JSON.stringify({
      status: "ok",
      check: "installed Codex reset UI",
      availableCount: account.resetCredits.availableCount,
      shownExpirationDates: dates.map((date) => date.textContent),
    }),
  );
} finally {
  view.lifecycle.unmount();
  await mounted.lifecycle.dispose();
  dom.window.close();
}
