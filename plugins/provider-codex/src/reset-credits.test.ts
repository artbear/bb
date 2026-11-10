import { afterEach, expect, it, vi } from "vitest";
import {
  normalizeResetCredits,
  readCodexResetCredits,
} from "./reset-credits.js";

vi.mock("./ai/codex-auth.js", () => ({
  readCodexAuthCredentials: async () => ({
    type: "chatgpt",
    accessToken: "test-token",
    accountId: "account-test",
  }),
}));

afterEach(() => vi.unstubAllGlobals());

it("keeps only available Codex resets and preserves exact expiration dates", () => {
  expect(
    normalizeResetCredits({
      available_count: 2,
      credits: [
        {
          id: "a",
          reset_type: "codex_rate_limits",
          status: "available",
          expires_at: "2026-10-30T18:45:00.123456Z",
        },
        {
          id: "b",
          reset_type: "codex_rate_limits",
          status: "available",
          expires_at: null,
        },
        {
          id: "used",
          reset_type: "codex_rate_limits",
          status: "redeemed",
          expires_at: null,
        },
        {
          id: "unknown",
          reset_type: "future_type",
          status: "available",
          expires_at: null,
        },
      ],
    }),
  ).toEqual({
    status: "ok",
    availableCount: 2,
    credits: [
      { id: "a", expiresAt: "2026-10-30T18:45:00.123456Z" },
      { id: "b", expiresAt: null },
    ],
  });
});

it("uses the read-only reset-credit endpoint with the account's credentials", async () => {
  const request = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ available_count: 0, credits: [] })),
  );
  vi.stubGlobal("fetch", request);
  expect(await readCodexResetCredits(new AbortController().signal)).toEqual({
    status: "ok",
    availableCount: 0,
    credits: [],
  });
  const [url, init] = request.mock.calls[0]!;
  expect(url).toBe(
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
  );
  const headers = new Headers(init?.headers);
  expect(headers.get("ChatGPT-Account-Id")).toBe("account-test");
  expect(headers.get("Authorization")).toBe("Bearer test-token");
  expect(init?.method ?? "GET").toBe("GET");
});

it.each([
  new Response("denied", { status: 401 }),
  new Response(
    JSON.stringify({
      available_count: 2,
      credits: [
        {
          id: "x",
          status: "available",
          reset_type: "codex_rate_limits",
          expires_at: "invalid",
        },
      ],
    }),
  ),
])(
  "reports collection failure without fabricating an empty balance",
  async (response) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    expect(await readCodexResetCredits(new AbortController().signal)).toEqual({
      status: "error",
      message: "Could not refresh reset credits.",
    });
  },
);
