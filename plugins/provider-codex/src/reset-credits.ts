import { z } from "zod";
import { readCodexAuthCredentials } from "./ai/codex-auth.js";
import { fetchChatGpt } from "./ai/chatgpt-fetch.js";
import type { resetCreditsSchema } from "./usage-contract.js";

const detailsSchema = z.object({
  available_count: z.number().int().nonnegative(),
  credits: z
    .array(
      z.object({
        id: z.string().min(1),
        reset_type: z.string(),
        status: z.string(),
        expires_at: z.iso.datetime({ offset: true }).nullable(),
      }),
    )
    .max(200),
});

export function normalizeResetCredits(
  value: unknown,
): z.infer<typeof resetCreditsSchema> {
  const details = detailsSchema.parse(value);
  return {
    status: "ok",
    availableCount: details.available_count,
    credits: details.credits
      .filter(
        (credit) =>
          credit.status === "available" &&
          credit.reset_type === "codex_rate_limits",
      )
      .map((credit) => ({ id: credit.id, expiresAt: credit.expires_at })),
  };
}

export async function readCodexResetCredits(
  signal: AbortSignal,
): Promise<z.infer<typeof resetCreditsSchema>> {
  try {
    const auth = await readCodexAuthCredentials();
    if (auth.type !== "chatgpt") throw new Error("ChatGPT sign-in required");
    const response = await fetchChatGpt({
      url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
      init: (headers) => {
        headers.set("Authorization", `Bearer ${auth.accessToken}`);
        headers.set("ChatGPT-Account-Id", auth.accountId);
        return {
          headers,
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        };
      },
    });
    if (!response.ok) throw new Error("Reset credits request failed");
    return normalizeResetCredits(await response.json());
  } catch {
    signal.throwIfAborted();
    return { status: "error", message: "Could not refresh reset credits." };
  }
}
