import assert from "node:assert/strict";
import { test } from "node:test";
import { isMaintenanceDay } from "./codex-reset-maintenance.mjs";

test("keeps exactly three days across month and year boundaries", () => {
  for (const [today, expected] of [
    ["2026-10-28", false],
    ["2026-10-29", true],
    ["2026-10-30", false],
    ["2026-10-31", false],
    ["2026-11-01", true],
    ["2026-11-04", true],
    ["2027-01-03", true],
  ]) {
    assert.equal(isMaintenanceDay(today, "2026-10-29"), expected, today);
  }
});
