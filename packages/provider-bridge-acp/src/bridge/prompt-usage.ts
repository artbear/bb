import type { ThreadEventTokenUsageBreakdown } from "@bb/domain";
import { basename } from "node:path";
import { isJsonObject } from "../session/decode.js";

export type PromptUsageSnapshot = ThreadEventTokenUsageBreakdown;

export type PromptUsageEvent = {
  kind: "usage";
  total: PromptUsageSnapshot;
  last: PromptUsageSnapshot;
  modelContextWindow: number | null;
};

export type PromptUsageResult =
  | { status: "event"; event: PromptUsageEvent; snapshot: PromptUsageSnapshot }
  | { status: "baseline"; snapshot: PromptUsageSnapshot }
  | { status: "ignore"; reason: string };

type PromptUsageLog = (entry: { reason: string; command: string }) => void;

type Count =
  | { state: "missing" }
  | { state: "null" }
  | { state: "value"; value: number }
  | { state: "invalid" };

const CUMULATIVE_COMMANDS = new Set(["hermes"]);

function defaultLog(entry: { reason: string; command: string }): void {
  const level = (process.env.BB_LOG_LEVEL ?? "debug").toLowerCase();
  if (level !== "debug" && level !== "trace") return;
  process.stderr.write(
    `${JSON.stringify({
      component: "provider-bridge-acp",
      level: "debug",
      msg: "prompt usage",
      ...entry,
    })}\n`,
  );
}

function commandName(command: string): string {
  return basename(command.replaceAll("\\", "/")).replace(/\.exe$/i, "");
}

function count(
  usage: Record<string, unknown>,
  snake: string,
  camel: string,
): Count {
  const hasSnake = Object.hasOwn(usage, snake);
  const hasCamel = Object.hasOwn(usage, camel);
  if (hasSnake && hasCamel && usage[snake] !== usage[camel]) {
    return { state: "invalid" };
  }
  if (!hasSnake && !hasCamel) return { state: "missing" };
  const value = hasSnake ? usage[snake] : usage[camel];
  if (value === null) return { state: "null" };
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return { state: "value", value };
  }
  return { state: "invalid" };
}

function ignore(
  reason: string,
  command: string,
  log: PromptUsageLog,
): PromptUsageResult {
  log({ reason, command });
  return { status: "ignore", reason };
}

function optionalCache(
  value: Count,
): { present: boolean; value: number } | undefined {
  if (value.state === "invalid") return undefined;
  if (value.state === "value") return { present: true, value: value.value };
  return { present: false, value: 0 };
}

function splitDelta(
  current: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (current === undefined && previous === undefined) return undefined;
  return (current ?? 0) - (previous ?? 0);
}

function nonnegative(snapshot: PromptUsageSnapshot): boolean {
  const values = [
    snapshot.inputTokens,
    snapshot.outputTokens,
    snapshot.totalTokens,
    snapshot.cachedInputTokens,
    snapshot.reasoningOutputTokens,
    snapshot.cacheReadInputTokens,
    snapshot.cacheWriteInputTokens,
  ];
  return values.every(
    (value) =>
      value === undefined || (Number.isSafeInteger(value) && value >= 0),
  );
}

function delta(
  current: PromptUsageSnapshot,
  previous: PromptUsageSnapshot,
): PromptUsageSnapshot | undefined {
  const last: PromptUsageSnapshot = {
    inputTokens: current.inputTokens - previous.inputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    reasoningOutputTokens:
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
  };
  const read = splitDelta(
    current.cacheReadInputTokens,
    previous.cacheReadInputTokens,
  );
  const write = splitDelta(
    current.cacheWriteInputTokens,
    previous.cacheWriteInputTokens,
  );
  if (read !== undefined) last.cacheReadInputTokens = read;
  if (write !== undefined) last.cacheWriteInputTokens = write;
  return nonnegative(last) ? last : undefined;
}

export function promptUsageFromResult(
  result: unknown,
  command: string,
  previous: PromptUsageSnapshot | undefined,
  modelContextWindow: number | null,
  resumed = false,
  log: PromptUsageLog = defaultLog,
): PromptUsageResult {
  if (!isJsonObject(result) || !isJsonObject(result["usage"])) {
    return { status: "ignore", reason: "absent-usage" };
  }
  if (!CUMULATIVE_COMMANDS.has(commandName(command))) {
    return ignore("command-not-allowlisted", command, log);
  }
  const usage = result["usage"];
  const input = count(usage, "input_tokens", "inputTokens");
  const output = count(usage, "output_tokens", "outputTokens");
  const read = optionalCache(count(usage, "cached_read_tokens", "cachedReadTokens"));
  const write = optionalCache(
    count(usage, "cached_write_tokens", "cachedWriteTokens"),
  );
  const thought = count(usage, "thought_tokens", "thoughtTokens");
  const reported = count(usage, "total_tokens", "totalTokens");
  if (input.state !== "value") {
    return ignore("missing-input", command, log);
  }
  if (output.state !== "value") {
    return ignore("missing-output", command, log);
  }
  if (
    read === undefined ||
    write === undefined ||
    thought.state === "invalid" ||
    reported.state === "invalid"
  ) {
    return ignore("invalid-counter", command, log);
  }
  const totalTokens = input.value + output.value;
  if (!Number.isSafeInteger(totalTokens)) {
    return ignore("invalid-counter", command, log);
  }
  if (read.value + write.value > input.value) {
    return ignore("cache-exceeds-input", command, log);
  }
  if (
    reported.state === "value" &&
    reported.value !== 0 &&
    reported.value !== totalTokens
  ) {
    log({ reason: "reported-total-differs", command });
  } else if (
    reported.state === "value" &&
    reported.value === 0 &&
    totalTokens !== 0
  ) {
    log({ reason: "reported-total-zero", command });
  }
  const snapshot: PromptUsageSnapshot = {
    inputTokens: input.value,
    outputTokens: output.value,
    totalTokens,
    cachedInputTokens: read.value + write.value,
    reasoningOutputTokens: thought.state === "value" ? thought.value : 0,
  };
  if (read.present) snapshot.cacheReadInputTokens = read.value;
  if (write.present) snapshot.cacheWriteInputTokens = write.value;
  if (resumed && previous === undefined) {
    log({ reason: "resumed-session-baseline", command });
    return { status: "baseline", snapshot };
  }
  const last = previous === undefined ? snapshot : delta(snapshot, previous);
  if (last === undefined) {
    return ignore("cumulative-regression", command, log);
  }
  return {
    status: "event",
    snapshot,
    event: { kind: "usage", total: snapshot, last, modelContextWindow },
  };
}
