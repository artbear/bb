import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyPatch, transform, VERSION } from "./apply-patch.mjs";
import { MARKER, createSession } from "./turn-usage.mjs";

const fixture = `"use strict";
class Session {
  async sendSessionUpdate(e){await this.presenter.sendSessionUpdate(e)}
  async handlePrompt(e){this.pendingPromptCancel?.();
    const t={canceled:false},n=!1,a=null,r=()=>{},o=0,W=0;
    return t.canceled?(n&&(r(),a=this.subagentPublisher?.whenAllTerminal({turn:o,timeoutMs:W})),await a,{stopReason:"cancelled"}):{stopReason:"end_turn"}
  }
  async processPrompt(){
    const s=0,f=0,M={d:{getLastParentAgentRequestId(){return 0}}};
    const R={sendUpdate:async(e,t)=>{this.claimTaskToolCall(t,s),this.noteWatchedShell(t),await this.presenter.presentInteractionUpdate(t)},query:async(e,t)=>{}};
    const q=async()=>{};
    await q(f),this.lastRequestId=M.d.getLastParentAgentRequestId()
  }
}
`;

function ended(value) {
  return { message: { case: "turnEnded", value } };
}

test("sums distinct turnEnded values and keeps an explicit zero cache", () => {
  const session = createSession();
  const first = { inputTokens: 5n, outputTokens: 1n, cacheReadTokens: 0n, cacheWriteTokens: 2n, reasoningTokens: 1n };
  const sameNumbers = { inputTokens: 5n, outputTokens: 1n, cacheReadTokens: 0n, cacheWriteTokens: 2n, reasoningTokens: 1n };
  session.bbNoteTurnEnded(ended(first));
  session.bbNoteTurnEnded(ended(first));
  session.bbNoteTurnEnded(ended(sameNumbers));
  assert.deepEqual(session.bbPromptUsage(), {
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      cachedReadTokens: 0,
      cachedWriteTokens: 4,
      thoughtTokens: 2,
    },
  });
});

test("omits absent cache, ignores empty and model calls, and cancels a bad input", () => {
  const session = createSession();
  session.bbNoteTurnEnded(ended({}));
  session.bbNoteTurnEnded({ message: { case: "modelCallCompleted", value: { inputTokens: 9n, outputTokens: 9n } } });
  session.bbNoteTurnEnded(ended({ inputTokens: 10n, outputTokens: 2n }));
  assert.deepEqual(session.bbPromptUsage().usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
  session.bbNoteTurnEnded(ended({ inputTokens: 4n, outputTokens: 1n }));
  session.bbNoteTurnEnded(ended({ inputTokens: 1.5, outputTokens: 1n }));
  assert.deepEqual(session.bbPromptUsage(), {});
  session.bbNoteTurnEnded(ended({ inputTokens: 3n, outputTokens: 1n, cacheReadTokens: "nope" }));
  assert.deepEqual(session.bbPromptUsage().usage, { inputTokens: 13, outputTokens: 3, totalTokens: 16 });
});

test("both finishes share one session total and a prompt with no tokens sends no usage", () => {
  const session = createSession();
  session.bbNoteTurnEnded(ended({ inputTokens: 8n, outputTokens: 2n }));
  const endedTurn = session.bbPromptUsage();
  assert.equal(endedTurn.usage.totalTokens, 10);
  assert.deepEqual(session.bbPromptUsage(), {});
  session.bbNoteTurnEnded(ended({ inputTokens: 1n, outputTokens: 1n }));
  assert.equal(session.bbPromptUsage().usage.inputTokens, 9);
});

test("context update requires a positive integer window", async () => {
  const sent = [];
  const session = createSession();
  session.sendSessionUpdate = async (payload) => { sent.push(payload); };
  session.agentStore = { getConversationStateStructure: () => ({ tokenDetails: { usedTokens: 12, maxTokens: 0 } }) };
  await session.bbSendContextUsage();
  session.agentStore = { getConversationStateStructure: () => ({}) };
  await session.bbSendContextUsage();
  session.agentStore = { getConversationStateStructure: () => ({ tokenDetails: { usedTokens: 12, maxTokens: 256 } }) };
  await session.bbSendContextUsage();
  assert.deepEqual(sent, [{ sessionUpdate: "usage_update", used: 12, size: 256 }]);
});

test("patch touches the root callback and both returns, then becomes a no-op", () => {
  const root = mkdtempSync(join(tmpdir(), "cursor-usage-"));
  const directory = join(root, VERSION);
  mkdirSync(directory);
  const file = join(directory, "6136.index.js");
  writeFileSync(file, fixture);
  const first = applyPatch({ versionsRoot: root });
  assert.equal(first.status, "patched");
  const patched = readFileSync(file, "utf8");
  assert.equal(patched.includes(MARKER), true);
  assert.equal(patched.includes("this.bbNoteTurnEnded(t),await this.presenter.presentInteractionUpdate(t)"), true);
  assert.equal(patched.includes('stopReason:"cancelled",...this.bbPromptUsage()'), true);
  assert.equal(patched.includes('stopReason:"end_turn",...this.bbPromptUsage()'), true);
  assert.equal(existsSync(join(directory, ".bb-cursor-usage-patch.check.js")), false);
  const second = applyPatch({ versionsRoot: root });
  assert.equal(second.status, "unchanged");
  assert.equal(readFileSync(file, "utf8"), patched);
  rmSync(root, { recursive: true, force: true });
});

test("a missing anchor or a failed check leaves the installed bytes untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "cursor-usage-"));
  const directory = join(root, VERSION);
  mkdirSync(directory);
  const file = join(directory, "6136.index.js");
  const broken = fixture.replace("sendUpdate:async", "sendUpdate:missing");
  writeFileSync(file, broken);
  assert.throws(() => applyPatch({ versionsRoot: root }));
  assert.equal(readFileSync(file, "utf8"), broken);
  assert.equal(existsSync(join(directory, ".bb-cursor-usage-patch.check.js")), false);
  writeFileSync(file, fixture);
  assert.throws(() => applyPatch({ versionsRoot: root, check() { throw new Error("check failed"); } }));
  assert.equal(readFileSync(file, "utf8"), fixture);
  assert.equal(readFileSync(file, "utf8").includes(MARKER), false);
  const other = join(root, "2026.01.01-other", "6136.index.js");
  mkdirSync(join(root, "2026.01.01-other"));
  writeFileSync(other, fixture);
  rmSync(directory, { recursive: true, force: true });
  assert.throws(() => applyPatch({ versionsRoot: root }));
  assert.equal(readFileSync(other, "utf8"), fixture);
  rmSync(root, { recursive: true, force: true });
});

test("transform refuses a foreign anchor without inventing a marker", () => {
  assert.throws(() => transform("not the agent"));
  assert.equal("not the agent".includes(MARKER), false);
});
