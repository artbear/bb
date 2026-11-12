import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MARKER, methodsSource } from "./turn-usage.mjs";

export const VERSION = "2026.11.11-b912975";
const FILE_NAME = "6136.index.js";
const TEMP_NAME = ".bb-cursor-usage-patch.check.js";

const sendUpdateAnchor =
  'sendUpdate:async(e,t)=>{this.claimTaskToolCall(t,s),this.noteWatchedShell(t),await this.presenter.presentInteractionUpdate(t)}';
const sendUpdateReplacement =
  'sendUpdate:async(e,t)=>{this.claimTaskToolCall(t,s),this.noteWatchedShell(t),this.bbNoteTurnEnded(t),await this.presenter.presentInteractionUpdate(t)}';
const sessionUpdateAnchor =
  'async sendSessionUpdate(e){await this.presenter.sendSessionUpdate(e)}';
const handlePromptAnchor = 'async handlePrompt(e){this.pendingPromptCancel?.();';
const handlePromptReplacement = 'async handlePrompt(e){this.bbResetPrompt();this.pendingPromptCancel?.();';
const returnAnchor =
  'return t.canceled?(n&&(r(),a=this.subagentPublisher?.whenAllTerminal({turn:o,timeoutMs:W})),await a,{stopReason:"cancelled"}):{stopReason:"end_turn"}';
const returnReplacement =
  'return t.canceled?(n&&(r(),a=this.subagentPublisher?.whenAllTerminal({turn:o,timeoutMs:W})),await a,{stopReason:"cancelled",...this.bbPromptUsage()}):{stopReason:"end_turn",...this.bbPromptUsage()}';
const runAnchor = 'await q(f),this.lastRequestId=M.d.getLastParentAgentRequestId()';
const runReplacement =
  'await q(f),await this.bbSendContextUsage(),this.lastRequestId=M.d.getLastParentAgentRequestId()';

const anchors = [
  sendUpdateAnchor,
  sessionUpdateAnchor,
  handlePromptAnchor,
  returnAnchor,
  runAnchor,
];

function count(text, needle) {
  return text.split(needle).length - 1;
}

export function defaultCheck(file) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || "node --check failed");
  }
}

export function transform(original) {
  if (original.includes(MARKER)) return { status: "unchanged", text: original };
  for (const anchor of anchors) {
    const seen = count(original, anchor);
    if (seen !== 1) {
      throw new Error(`anchor count ${seen} for ${anchor.slice(0, 48)}`);
    }
  }
  let text = original;
  text = text.replace(sendUpdateAnchor, sendUpdateReplacement);
  text = text.replace(sessionUpdateAnchor, sessionUpdateAnchor + methodsSource);
  text = text.replace(handlePromptAnchor, handlePromptReplacement);
  text = text.replace(returnAnchor, returnReplacement);
  text = text.replace(runAnchor, runReplacement);
  if (!text.includes(MARKER) || !text.includes("bbNoteTurnEnded(t)") || !text.includes('stopReason:"cancelled",...this.bbPromptUsage()') || !text.includes('stopReason:"end_turn",...this.bbPromptUsage()')) {
    throw new Error("patch did not land on the root sendUpdate and both returns");
  }
  return { status: "patched", text };
}

export function applyPatch({ versionsRoot, check = defaultCheck }) {
  const directory = join(versionsRoot, VERSION);
  const file = join(directory, FILE_NAME);
  const temp = join(directory, TEMP_NAME);
  if (/^\d+\.index\.js$/.test(TEMP_NAME)) {
    throw new Error("temporary file must not be a chunk name");
  }
  if (!existsSync(file)) {
    throw new Error(`missing ${file}`);
  }
  const original = readFileSync(file, "utf8");
  const transformed = transform(original);
  if (transformed.status === "unchanged") return { status: "unchanged", file };
  writeFileSync(temp, transformed.text);
  try {
    check(temp);
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp);
    throw error;
  }
  renameSync(temp, file);
  return { status: "patched", file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootFlag = process.argv.indexOf("--versions-root");
  const versionsRoot = rootFlag === -1
    ? "/home/hermes/.local/share/cursor-agent/versions"
    : process.argv[rootFlag + 1];
  try {
    const result = applyPatch({ versionsRoot });
    process.stdout.write(`${result.status} ${result.file}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
