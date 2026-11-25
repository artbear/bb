import { renderTemplate } from "@bb/templates";
import { and, eq, isNull } from "drizzle-orm";
import {
  getThread,
  listStoredTaskTurnRequestEvents,
  threads,
  updateThread,
} from "@bb/db";
import {
  removeCommandMentionsFromPromptInput,
  type PromptInput,
  type PromptMentionCommandTrigger,
  type Thread,
} from "@bb/domain";
import {
  countWords,
  displayWidth,
  truncateToWidth,
  truncateToWidthAtWordBoundary,
} from "@bb/text-utils";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { runTextAiTask, type AiTaskFailureReason } from "../ai/ai-tasks.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";
import {
  getTurnFinalOutput,
  listLatestTurnFinalAgentReplies,
} from "./thread-data.js";
import { pluginHookProvider } from "../plugins/plugin-hook-registry.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { decideWithinBox } from "./dispatch-hooks.js";
import { syncThreadTitleToProvider } from "./thread-commands.js";

const MIN_TITLE_GENERATION_WORDS = 5;
const MAX_GENERATED_TITLE_WIDTH = 48;
const MAX_TITLE_FALLBACK_WIDTH = 80;
const MAX_TITLE_PROMPT_WIDTH = 4000;
const ELLIPSIS = "...";
const MAX_BRANCH_SLUG_LENGTH = 48;
const MAX_TITLE_TASK_WIDTH = 2000;
const MAX_TITLE_FOLLOW_UP_WIDTH = 600;
const TITLE_FOLLOW_UP_LIMIT = 8;
const MAX_TITLE_AGENT_REPLY_WIDTH = 125;
const TITLE_AGENT_REPLY_LIMIT = 32;

interface ApplyGeneratedThreadTitleArgs {
  threadId: string;
  title: string;
  deferred?: boolean;
}

interface ThreadMetadataGenerationArgs {
  input: PromptInput[];
  threadId: string;
}

interface GeneratedThreadMetadata {
  title?: string;
}

type ThreadMetadataGenerationOutcomeReason =
  | "empty-input"
  | "failed"
  | "inference-unavailable"
  | "too-short"
  | "timeout";

export interface ThreadMetadataGenerationOutcome {
  durationMs: number;
  metadata: GeneratedThreadMetadata | null;
  reason?: ThreadMetadataGenerationOutcomeReason;
}

function cleanPromptText(input: PromptInput[]): string {
  return input
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function clampToWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) {
    return text;
  }
  const body = truncateToWidth(text, maxWidth - ELLIPSIS.length);
  return `${body}${ELLIPSIS}`;
}

export function shouldDeferThreadTitle(
  projectId: string,
): Promise<boolean> | boolean {
  const provider = pluginHookProvider();
  const hook = "experimental_thread.titleTiming";
  const registrations = provider?.listHooks(hook);
  if (!provider || !registrations?.length) return false;
  return decideWithinBox(async () => {
    for (const registration of registrations) {
      const result = await provider.invokeHook(registration, hook, async () =>
        registration.handler({ projectId }),
      );
      if (result.ok && result.value === "after-first-reply") return true;
    }
    return false;
  }, provider.decisionTimeoutMs).then((result) => result.ok && result.value);
}

export function deriveTitleFallback(input: PromptInput[]): string | null {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return null;
  }
  return clampToWidth(text, MAX_TITLE_FALLBACK_WIDTH);
}

const FORK_TITLE_PATTERN = /^\((\d+)\) (.+)$/s;

export function deriveForkTitle(
  source: Pick<Thread, "title" | "titleFallback">,
): string | null {
  const sourceTitle = source.title?.trim() || source.titleFallback?.trim();
  if (!sourceTitle) {
    return null;
  }
  const numbered = FORK_TITLE_PATTERN.exec(sourceTitle);
  if (numbered === null) {
    return `(1) ${sourceTitle}`;
  }
  return `(${BigInt(numbered[1]) + 1n}) ${numbered[2]}`;
}

interface InvokedPromptCommand {
  name: string;
  trigger: PromptMentionCommandTrigger;
}

export function collectInvokedPromptCommands(
  input: PromptInput[],
): InvokedPromptCommand[] {
  const seen = new Set<string>();
  return input.flatMap((part) =>
    part.type === "text"
      ? part.mentions.flatMap((mention) => {
          if (mention.resource.kind !== "command") {
            return [];
          }
          const { name, trigger } = mention.resource;
          const key = `${trigger}${name}`;
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
          return [{ name, trigger }];
        })
      : [],
  );
}

function promptTextWithoutCommands(
  input: PromptInput[],
  commands: InvokedPromptCommand[],
): string {
  return cleanPromptText(
    commands.reduce<PromptInput[]>(
      (remaining, command) =>
        removeCommandMentionsFromPromptInput(remaining, command),
      input,
    ),
  );
}

function formatInvokedCommands(commands: InvokedPromptCommand[]): string {
  return commands
    .map((command) => `${command.trigger}${command.name}`)
    .join(", ");
}

export function shouldGenerateThreadTitle(input: PromptInput[]): boolean {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return false;
  }

  if (collectInvokedPromptCommands(input).length > 0) {
    return true;
  }

  return countWords(text) >= MIN_TITLE_GENERATION_WORDS;
}

export function sanitizeGeneratedTitle(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  const title = truncateToWidthAtWordBoundary(
    normalized,
    MAX_GENERATED_TITLE_WIDTH,
  ).trim();
  return title.length > 0 ? title : null;
}

export function sanitizeGeneratedBranchSlug(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_BRANCH_SLUG_LENGTH)
    .replace(/-+$/u, "");

  return slug.length > 0 ? slug : null;
}

function titlePromptText(input: PromptInput[]): string {
  const commands = collectInvokedPromptCommands(input);
  const body = promptTextWithoutCommands(input, commands);
  return body.length > 0 ? body : cleanPromptText(input);
}

function formatListItems(
  texts: readonly string[],
  maxWidth: number,
): string | null {
  const lines = texts.flatMap((text) => {
    const normalized = text.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
      ? [`- ${clampToWidth(normalized, maxWidth)}`]
      : [];
  });
  return lines.length > 0 ? lines.join("\n") : null;
}

interface ThreadTitlePromptContext {
  agentReplies: string | null;
  currentTitle: string | null;
  followUps: string | null;
}

function renderThreadTitlePrompt(
  input: PromptInput[],
  context: ThreadTitlePromptContext,
): string | null {
  if (!cleanPromptText(input)) {
    return null;
  }
  const commands = collectInvokedPromptCommands(input);
  const hasLaterMessages =
    context.followUps !== null || context.agentReplies !== null;
  return renderTemplate("generateThreadMetadata", {
    cleanedPrompt: clampToWidth(
      titlePromptText(input),
      hasLaterMessages ? MAX_TITLE_TASK_WIDTH : MAX_TITLE_PROMPT_WIDTH,
    ),
    ...(commands.length > 0
      ? { invokedCommands: formatInvokedCommands(commands) }
      : {}),
    ...(context.followUps === null ? {} : { followUps: context.followUps }),
    ...(context.agentReplies === null
      ? {}
      : { agentReplies: context.agentReplies }),
    ...(context.currentTitle === null
      ? {}
      : { currentTitle: context.currentTitle }),
  });
}

export function buildThreadTitlePrompt(input: PromptInput[]): string | null {
  return renderThreadTitlePrompt(input, {
    agentReplies: null,
    currentTitle: null,
    followUps: null,
  });
}

interface ThreadTitleRegenerationContext {
  agentReplies: string[];
  currentTitle: string | null;
  followUps: PromptInput[][];
  task: PromptInput[];
}

function buildThreadTitleRegenerationPrompt(
  context: ThreadTitleRegenerationContext,
): string | null {
  return renderThreadTitlePrompt(context.task, {
    agentReplies: formatListItems(
      context.agentReplies,
      MAX_TITLE_AGENT_REPLY_WIDTH,
    ),
    currentTitle: context.currentTitle,
    followUps: formatListItems(
      context.followUps.map(cleanPromptText),
      MAX_TITLE_FOLLOW_UP_WIDTH,
    ),
  });
}

export async function generateThreadMetadataWithOutcome(
  deps: LoggedWorkSessionDeps,
  args: ThreadMetadataGenerationArgs,
): Promise<ThreadMetadataGenerationOutcome> {
  const startedAt = Date.now();
  const complete = (
    metadata: GeneratedThreadMetadata | null,
    reason?: ThreadMetadataGenerationOutcomeReason,
  ): ThreadMetadataGenerationOutcome => ({
    durationMs: Date.now() - startedAt,
    metadata,
    ...(reason ? { reason } : {}),
  });

  const prompt = buildThreadTitlePrompt(args.input);
  if (prompt === null) {
    return complete(null, "empty-input");
  }
  if (!shouldGenerateThreadTitle(args.input)) {
    return complete(null, "too-short");
  }

  const outcome = await runTextAiTask(deps, {
    task: "thread-title",
    label: "Thread title generation",
    logContext: { threadId: args.threadId },
    prompt,
  });
  if (!outcome.ok) {
    return complete(
      null,
      outcome.reason === "timeout"
        ? "timeout"
        : outcome.reason === "failed"
          ? "failed"
          : "inference-unavailable",
    );
  }
  const title = sanitizeGeneratedTitle(outcome.value);
  return title === null ? complete(null, "failed") : complete({ title });
}

export function applyGeneratedThreadTitle(
  deps: Pick<AppDeps, "db" | "hub">,
  args: ApplyGeneratedThreadTitleArgs,
): boolean {
  const title = args.title.trim();
  if (title.length === 0) {
    return false;
  }

  return (
    updateThread(
      deps.db,
      deps.hub,
      args.threadId,
      { title },
      args.deferred ? "deferred" : "unset",
    ) !== null
  );
}

interface RegenerateThreadTitleArgs {
  thread: Thread;
}

function visiblePromptInput(input: PromptInput[]): PromptInput[] {
  return input.filter((part) => part.visibility !== "agent-only");
}

function loadThreadTitleRegenerationContext(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
  firstReply?: { taskSequence: number; text: string },
): ThreadTitleRegenerationContext | null {
  const from = firstReply ? { fromSequence: firstReply.taskSequence } : {};
  const [taskRow] = listStoredTaskTurnRequestEvents(deps.db, {
    ...from,
    threadId: thread.id,
    order: "oldest",
    limit: 1,
  });
  if (
    taskRow === undefined ||
    (firstReply !== undefined && taskRow.sequence !== firstReply.taskSequence)
  ) {
    return null;
  }
  const followUps = listStoredTaskTurnRequestEvents(deps.db, {
    ...from,
    threadId: thread.id,
    order: "newest",
    limit: TITLE_FOLLOW_UP_LIMIT,
  })
    .filter((row) => row.sequence !== taskRow.sequence)
    .reverse()
    .map((row) => visiblePromptInput(parseStoredTurnRequestEvent(row).input));
  const agentReplies = firstReply
    ? [firstReply.text]
    : listLatestTurnFinalAgentReplies(deps.db, {
        threadId: thread.id,
        limit: TITLE_AGENT_REPLY_LIMIT,
      }).reverse();
  return {
    agentReplies,
    currentTitle: thread.title,
    followUps,
    task: visiblePromptInput(parseStoredTurnRequestEvent(taskRow).input),
  };
}

function titleRegenerationError(
  reason: AiTaskFailureReason,
  message: string,
): ApiError {
  const detail = `Could not regenerate the title, so the current title was kept: ${message}`;
  switch (reason) {
    case "off":
    case "unavailable":
      return new ApiError(501, "not_configured", detail);
    case "timeout":
      return new ApiError(504, "title_generation_timeout", detail, true);
    case "failed":
      return new ApiError(502, "provider_rpc_error", detail, true);
    case "cancelled":
      return new ApiError(400, "cancelled", detail);
  }
}

export async function regenerateThreadTitle(
  deps: CommandResultSideEffectsDeps,
  args: RegenerateThreadTitleArgs,
): Promise<Thread> {
  const context = loadThreadTitleRegenerationContext(deps, args.thread);
  const prompt =
    context === null ? null : buildThreadTitleRegenerationPrompt(context);
  if (prompt === null) {
    throw new ApiError(
      409,
      "invalid_request",
      "This thread has no task message to generate a title from",
    );
  }
  const outcome = await requestRegeneratedThreadTitle(deps, {
    threadId: args.thread.id,
    prompt,
    deferred: false,
  });
  if (!outcome.ok) {
    throw titleRegenerationError(outcome.reason, outcome.message);
  }
  const title = sanitizeGeneratedTitle(outcome.value);
  if (title === null) {
    throw titleRegenerationError(
      "failed",
      `${outcome.service.displayName} returned an empty title`,
    );
  }
  if (title === args.thread.title) {
    return args.thread;
  }
  const thread = updateThread(deps.db, deps.hub, args.thread.id, { title });
  if (thread === null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  syncThreadTitleToProvider(deps, thread);
  return thread;
}

function requestRegeneratedThreadTitle(
  deps: LoggedWorkSessionDeps,
  args: { threadId: string; prompt: string; deferred: boolean },
) {
  return runTextAiTask(deps, {
    task: "thread-title",
    label: args.deferred
      ? "Deferred thread title generation"
      : "Thread title regeneration",
    ...(args.deferred ? { singleAttempt: true } : {}),
    logContext: { threadId: args.threadId },
    prompt: args.prompt,
  });
}

export function rememberDeferredTitleTask(
  db: AppDeps["db"],
  threadId: string,
  taskSequence: number,
): void {
  db.update(threads)
    .set({ deferredTitleTaskSequence: taskSequence })
    .where(
      and(
        eq(threads.id, threadId),
        eq(threads.deferredTitleGeneration, "pending"),
        isNull(threads.deferredTitleTaskSequence),
      ),
    )
    .run();
}

export function scheduleDeferredThreadTitle(
  deps: CommandResultSideEffectsDeps,
  args: { threadId: string; turnId: string },
): void {
  const thread = getThread(deps.db, args.threadId);
  if (
    thread?.deferredTitleGeneration !== "pending" ||
    thread.deferredTitleTaskSequence === null ||
    thread.title !== null ||
    thread.deletedAt !== null
  )
    return;

  const taskSequence = thread.deferredTitleTaskSequence;
  const reply = getTurnFinalOutput(deps.db, args);
  if (reply === null) return;

  const claimed = deps.db
    .update(threads)
    .set({
      deferredTitleGeneration: "claimed",
      deferredTitleTaskSequence: null,
    })
    .where(
      and(
        eq(threads.id, thread.id),
        eq(threads.deferredTitleGeneration, "pending"),
        isNull(threads.title),
        isNull(threads.deletedAt),
      ),
    )
    .run();
  if (claimed.changes === 0) return;

  deferAfterResponse({
    config: deps.config,
    logger: deps.logger,
    name: "Deferred thread title generation",
    context: { threadId: thread.id },
    work: async () => {
      if (getThread(deps.db, thread.id)?.deferredTitleGeneration !== "claimed")
        return;
      const context = loadThreadTitleRegenerationContext(deps, thread, {
        taskSequence,
        text: reply,
      });
      const prompt =
        context === null ? null : buildThreadTitleRegenerationPrompt(context);
      if (prompt === null) return;
      const outcome = await requestRegeneratedThreadTitle(deps, {
        threadId: thread.id,
        prompt,
        deferred: true,
      });
      if (!outcome.ok) return;
      const title = sanitizeGeneratedTitle(outcome.value);
      if (
        title === null ||
        !applyGeneratedThreadTitle(deps, {
          threadId: thread.id,
          title,
          deferred: true,
        })
      )
        return;
      const renamed = getThread(deps.db, thread.id);
      if (renamed !== null) syncThreadTitleToProvider(deps, renamed);
    },
  });
}
