// Console buffer: Runtime + Log via debugger events. Seq-cursor polling.
import { attach } from "./debugger.js";
import { assertAllowed } from "./tabs.js";
import { redactMessage, truncate } from "./redact.js";

export interface ConsoleEntry {
  seq: number;
  level: "log" | "warn" | "error";
  message: string;
  timestamp: number;
  source?: string;
}

const buffers = new Map<number, ConsoleEntry[]>();
const seqByTab = new Map<number, number>();
const enabled = new Set<number>();
const MAX = 500;

function push(tabId: number, level: ConsoleEntry["level"], message: string, source?: string): void {
  const seq = (seqByTab.get(tabId) ?? 0) + 1;
  seqByTab.set(tabId, seq);
  const buf = buffers.get(tabId) ?? [];
  buf.push({ seq, level, message: truncate(redactMessage(message)), timestamp: Date.now(), source });
  while (buf.length > MAX) buf.shift();
  buffers.set(tabId, buf);
}

function sendCmd(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result: any) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

export async function ensureConsole(tabId: number): Promise<void> {
  if (enabled.has(tabId)) return;
  await attach(tabId);
  await sendCmd(tabId, "Runtime.enable").catch(() => {});
  await sendCmd(tabId, "Log.enable").catch(() => {});
  enabled.add(tabId);
}

// Debugger events -> buffer. Module imported by offscreen so listener registers.
chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  if (method === "Runtime.consoleAPICalled") {
    const level = params?.type === "warning" ? "warn" : params?.type === "error" ? "error" : "log";
    const text = (params?.args ?? []).map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    push(tabId, level, text || "(console call)", "console");
  } else if (method === "Runtime.exceptionThrown") {
    push(tabId, "error", params?.exceptionDetails?.text ?? params?.exceptionDetails?.exception?.description ?? "uncaught exception", "exception");
  } else if (method === "Log.entryAdded") {
    const e = params?.entry;
    push(tabId, e?.level === "warning" ? "warn" : e?.level === "error" ? "error" : "log", `${e?.text ?? ""} (${e?.url ?? ""})`, e?.source);
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) enabled.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers.delete(tabId);
  seqByTab.delete(tabId);
  enabled.delete(tabId);
});

export async function getConsole(
  tabId: number,
  opts: { level?: string; sinceSeq?: number; limit?: number },
): Promise<{ entries: ConsoleEntry[]; nextSeq: number }> {
  await assertAllowed(tabId);
  await ensureConsole(tabId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const since = opts.sinceSeq ?? 0;
  const buf = buffers.get(tabId) ?? [];
  let out = buf.filter((e) => e.seq > since);
  if (opts.level) out = out.filter((e) => e.level === opts.level);
  out = out.slice(-limit);
  return { entries: out, nextSeq: seqByTab.get(tabId) ?? 0 };
}
