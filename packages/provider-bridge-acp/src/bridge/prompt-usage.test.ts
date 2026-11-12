import { describe, expect, it, vi } from "vitest";
import {
  promptUsageFromResult,
  type PromptUsageResult,
  type PromptUsageSnapshot,
} from "./prompt-usage.js";

const fields = [
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["total_tokens", "totalTokens"],
  ["cached_read_tokens", "cachedReadTokens"],
  ["cached_write_tokens", "cachedWriteTokens"],
  ["thought_tokens", "thoughtTokens"],
] as const;
const first = {
  input_tokens: 100,
  output_tokens: 20,
  total_tokens: 120,
  cached_read_tokens: 40,
  cached_write_tokens: 10,
  thought_tokens: 5,
};
const second = {
  input_tokens: 160,
  output_tokens: 35,
  total_tokens: 195,
  cached_read_tokens: 60,
  cached_write_tokens: 15,
  thought_tokens: 8,
};
const firstSnapshot: PromptUsageSnapshot = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  cachedInputTokens: 50,
  cacheReadInputTokens: 40,
  cacheWriteInputTokens: 10,
  reasoningOutputTokens: 5,
};
const secondSnapshot: PromptUsageSnapshot = {
  inputTokens: 160,
  outputTokens: 35,
  totalTokens: 195,
  cachedInputTokens: 75,
  cacheReadInputTokens: 60,
  cacheWriteInputTokens: 15,
  reasoningOutputTokens: 8,
};
const parse = (
  usage: unknown,
  command = "hermes",
  previous?: PromptUsageSnapshot,
  resumed = false,
  log?: (entry: { reason: string; command: string }) => void,
) =>
  promptUsageFromResult(
    { usage },
    command,
    previous,
    null,
    resumed,
    log ?? (() => undefined),
  );
const event = (result: PromptUsageResult) =>
  result.status === "event" ? result.event : undefined;

describe("PromptResponse usage", () => {
  it.each(["snake_case", "camelCase"])(
    "uses cumulative Hermes %s snapshots and nonnegative last deltas",
    (spelling) => {
      const encode = (u: typeof first) =>
        spelling === "snake_case"
          ? u
          : Object.fromEntries(fields.map(([snake, camel]) => [camel, u[snake]]));
      const a = parse(encode(first));
      expect(event(a)).toEqual({
        kind: "usage",
        total: firstSnapshot,
        last: firstSnapshot,
        modelContextWindow: null,
      });
      expect(a.status === "event" ? a.snapshot : undefined).toEqual(
        firstSnapshot,
      );
      const b = parse(encode(second), "hermes", firstSnapshot);
      expect(event(b)).toEqual({
        kind: "usage",
        total: secondSnapshot,
        modelContextWindow: null,
        last: {
          inputTokens: 60,
          outputTokens: 15,
          totalTokens: 75,
          cachedInputTokens: 25,
          cacheReadInputTokens: 20,
          cacheWriteInputTokens: 5,
          reasoningOutputTokens: 3,
        },
      });
    },
  );

  it.each([
    "hermes",
    "/opt/bin/hermes",
    "/opt/bin/hermes.exe",
    "C:\\agents\\hermes.exe",
  ])("recognizes command basename %s without .exe", (command) => {
    expect(parse(second, command, firstSnapshot).status).toBe("event");
  });

  it("attributes the first snapshot of a new session to that turn", () => {
    const started = parse(second);
    expect(event(started)?.last).toEqual(secondSnapshot);
    expect(event(started)?.total).toEqual(secondSnapshot);
  });

  it("stores the first snapshot of a resumed session without emitting it", () => {
    const reasons: string[] = [];
    const baseline = parse(second, "hermes", undefined, true, (entry) =>
      reasons.push(entry.reason),
    );
    expect(baseline).toEqual({ status: "baseline", snapshot: secondSnapshot });
    expect(reasons).toEqual(["resumed-session-baseline"]);
    expect(
      event(parse(second, "hermes", secondSnapshot, true))?.last,
    ).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  it.each(["cursor-agent", "/opt/bin/copilot.exe", "acp", "/opt/hermes/node"])(
    "emits nothing for a command outside the allowlist %s",
    (command) => {
      const reasons: string[] = [];
      expect(
        parse(first, command, undefined, false, (entry) =>
          reasons.push(entry.reason),
        ),
      ).toEqual({ status: "ignore", reason: "command-not-allowlisted" });
      expect(reasons).toEqual(["command-not-allowlisted"]);
      expect(parse(second, command, firstSnapshot).status).toBe("ignore");
    },
  );

  it("keeps two session chains independent", () => {
    const left = parse(first);
    const right = parse(second);
    expect(event(left)?.total).toEqual(firstSnapshot);
    expect(event(right)?.last).toEqual(secondSnapshot);
    expect(event(parse(second, "hermes", firstSnapshot))?.last.inputTokens).toBe(
      60,
    );
  });

  it.each(fields.filter(([snake]) => snake !== "total_tokens"))(
    "rejects regression of %s without changing accepted state",
    (snake) => {
      const usage = { ...second, [snake]: first[snake] - 1 };
      usage.total_tokens = usage.input_tokens + usage.output_tokens;
      const reasons: string[] = [];
      expect(
        parse(usage, "hermes", firstSnapshot, false, (entry) =>
          reasons.push(entry.reason),
        ),
      ).toEqual({ status: "ignore", reason: "cumulative-regression" });
      expect(reasons).toEqual(["cumulative-regression"]);
      expect(event(parse(second, "hermes", firstSnapshot))?.total).toEqual(
        secondSnapshot,
      );
    },
  );

  it.each([undefined, null, [], 1, "usage"])(
    "ignores absent or non-object usage %s without logging",
    (usage) => {
      const reasons: string[] = [];
      expect(
        promptUsageFromResult(
          { usage },
          "hermes",
          undefined,
          null,
          false,
          (entry) => reasons.push(entry.reason),
        ),
      ).toEqual({ status: "ignore", reason: "absent-usage" });
      expect(reasons).toEqual([]);
    },
  );

  it("ignores a result without usage", () => {
    expect(
      promptUsageFromResult({ stopReason: "end_turn" }, "hermes", undefined, null),
    ).toEqual({ status: "ignore", reason: "absent-usage" });
  });

  it.each(["input_tokens", "output_tokens"] as const)(
    "requires %s",
    (field) => {
      const usage: Record<string, number> = { ...first };
      delete usage[field];
      expect(parse(usage).status).toBe("ignore");
    },
  );

  it("omits absent cache fields, treats null as zero, and keeps an explicit zero", () => {
    const hermesRead = parse({
      input_tokens: 100,
      output_tokens: 20,
      cached_read_tokens: 40,
    });
    expect(hermesRead.status === "event" ? hermesRead.snapshot : undefined).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 40,
      cacheReadInputTokens: 40,
      reasoningOutputTokens: 0,
    });
    const absent = parse({ input_tokens: 100, output_tokens: 20 });
    expect(absent.status === "event" ? absent.snapshot : undefined).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    });
    const nulled = parse({
      input_tokens: 100,
      output_tokens: 20,
      cached_read_tokens: null,
      cached_write_tokens: null,
      thought_tokens: null,
    });
    expect(nulled.status === "event" ? nulled.snapshot : undefined).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    });
    const zero = parse({
      input_tokens: 100,
      output_tokens: 20,
      cached_read_tokens: 0,
      cached_write_tokens: 0,
    });
    expect(zero.status === "event" ? zero.snapshot : undefined).toMatchObject({
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it("uses input plus output when the reported total is missing, null, zero, or different", () => {
    const reasons: string[] = [];
    const log = (entry: { reason: string }) => reasons.push(entry.reason);
    expect(
      event(parse({ input_tokens: 100, output_tokens: 20 }, "hermes", undefined, false, log))
        ?.total.totalTokens,
    ).toBe(120);
    expect(
      event(
        parse(
          { input_tokens: 100, output_tokens: 20, total_tokens: null },
          "hermes",
          undefined,
          false,
          log,
        ),
      )?.total.totalTokens,
    ).toBe(120);
    expect(
      event(parse({ ...first, total_tokens: 0 }, "hermes", undefined, false, log))
        ?.total.totalTokens,
    ).toBe(120);
    expect(
      event(parse({ ...first, total_tokens: 1 }, "hermes", undefined, false, log))
        ?.total.totalTokens,
    ).toBe(120);
    expect(reasons).toEqual(["reported-total-zero", "reported-total-differs"]);
  });

  it.each(fields)(
    "rejects conflicting %s/%s but accepts equal aliases",
    (snake, camel) => {
      expect(parse({ ...first, [camel]: first[snake] + 1 }).status).toBe("ignore");
      expect(event(parse({ ...first, [camel]: first[snake] }))?.total).toEqual(
        firstSnapshot,
      );
    },
  );

  it.each(fields)("rejects invalid numeric values of %s/%s", (snake, camel) => {
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(parse({ ...first, [snake]: invalid }).status).toBe("ignore");
      const usage: Record<string, unknown> = { ...first };
      delete usage[snake];
      expect(parse({ ...usage, [camel]: invalid }).status).toBe("ignore");
    }
  });

  it("accepts null thought and cache counters", () => {
    for (const field of [
      "thought_tokens",
      "cached_read_tokens",
      "cached_write_tokens",
      "total_tokens",
    ]) {
      expect(parse({ ...first, [field]: null }).status).toBe("event");
    }
    expect(parse({ ...first, input_tokens: null }).status).toBe("ignore");
    expect(parse({ ...first, output_tokens: null }).status).toBe("ignore");
  });

  it("keeps cache inside input and does not reject reasoning above output", () => {
    const result = parse({
      input_tokens: 22869,
      output_tokens: 4,
      cached_read_tokens: 22865,
      cached_write_tokens: 0,
      thought_tokens: 9,
    });
    expect(result.status === "event" ? result.snapshot : undefined).toEqual({
      inputTokens: 22869,
      outputTokens: 4,
      totalTokens: 22873,
      cachedInputTokens: 22865,
      cacheReadInputTokens: 22865,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 9,
    });
  });

  it("rejects cache exceeding input", () => {
    expect(parse({ ...first, cached_read_tokens: 101 }).status).toBe("ignore");
    expect(parse({ ...first, cached_read_tokens: 95 }).status).toBe("ignore");
  });

  it("rejects a snapshot whose input and output overflow a safe integer", () => {
    expect(
      parse({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 }).status,
    ).toBe("ignore");
  });

  it("carries a measured context window and leaves null as an event field only", () => {
    expect(
      promptUsageFromResult({ usage: first }, "hermes", undefined, 8192, false, () =>
        undefined,
      ),
    ).toMatchObject({ status: "event", event: { modelContextWindow: 8192 } });
    const empty = parse(first);
    expect(event(empty)?.modelContextWindow).toBeNull();
    expect(empty.status === "event" ? Object.keys(empty.event) : []).toEqual([
      "kind",
      "total",
      "last",
      "modelContextWindow",
    ]);
  });

  it("writes a debug refusal when no logger is injected", () => {
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    promptUsageFromResult(
      { usage: { output_tokens: 1 } },
      "hermes",
      undefined,
      null,
    );
    expect(spy).toHaveBeenCalled();
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("missing-input");
    spy.mockRestore();
  });
});
