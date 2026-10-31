// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CodexResetCredits, formatCodexResetDate } from "./reset-credits.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows the two earliest unexpired resets, with dates in Moscow time", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T18:00:00Z"));
  const view = render(
    <CodexResetCredits
      value={{
        status: "ok",
        availableCount: 4,
        credits: [
          { id: "late", expiresAt: "2026-12-01T00:00:00Z" },
          { id: "second", expiresAt: "2026-11-07T23:15:00.654321Z" },
          { id: "expired", expiresAt: "2026-10-27T00:00:00Z" },
          { id: "first", expiresAt: "2026-10-30T18:45:00.123456Z" },
          { id: "forever", expiresAt: null },
        ],
      }}
    />,
  );
  const dates = [...view.container.querySelectorAll("time")];
  expect(dates.map((date) => date.dateTime)).toEqual([
    "2026-10-30T18:45:00.123456Z",
    "2026-11-07T23:15:00.654321Z",
  ]);
  expect(dates.map((date) => date.textContent)).toEqual([
    "30.10.2026, 21:45 МСК",
    "08.11.2026, 02:15 МСК",
  ]);
  expect(view.getByText("Дополнительные сбросы: 4")).toBeTruthy();
  expect(view.container.textContent).toContain("использовать до");
});

it("distinguishes missing data, failure, zero resets, and no expiration", () => {
  const view = render(<CodexResetCredits value={null} />);
  expect(view.container.textContent).toBe("");
  view.rerender(
    <CodexResetCredits value={{ status: "error", message: "Unavailable" }} />,
  );
  expect(view.container.textContent).toContain("не удалось обновить");
  view.rerender(
    <CodexResetCredits
      value={{ status: "ok", availableCount: 0, credits: [] }}
    />,
  );
  expect(view.container.textContent).toBe("Дополнительные сбросы: 0");
  view.rerender(
    <CodexResetCredits
      value={{
        status: "ok",
        availableCount: 1,
        credits: [{ id: "no-expiry", expiresAt: null }],
      }}
    />,
  );
  expect(view.container.textContent).toContain("без срока действия");
});

it("formats the regular quota reset using the same explicit timezone", () => {
  expect(formatCodexResetDate("2026-11-05T07:00:00Z")).toBe(
    "05.11.2026, 10:00 МСК",
  );
});
