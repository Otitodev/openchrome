// Network buffer: Network domain events. No bodies in V1 (status/mime/error only).
import { attach } from "./debugger.js";
import { assertAllowed } from "./tabs.js";
import { redactUrl } from "./redact.js";

export interface NetworkEntry {
  seq: number;
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  resourceType?: string;
  failed?: boolean;
  errorText?: string;
  startedAt: number;
}

const buffers = new Map<number, NetworkEntry[]>();
const byRequest = new Map<number, Map<string, NetworkEntry>>();
const seqByTab = new Map<number, number>();
const enabled = new Set<number>();
const MAX = 500;

function nextSeq(tabId: number): number {
  const s = (seqByTab.get(tabId) ?? 0) + 1;
  seqByTab.set(tabId, s);
  return s;
}

function store(tabId: number, entry: NetworkEntry): void {
  const buf = buffers.get(tabId) ?? [];
  const idx = buf.findIndex((e) => e.requestId === entry.requestId);
  if (idx >= 0) buf[idx] = entry;
  else buf.push(entry);
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

export async function ensureNetwork(tabId: number): Promise<void> {
  if (enabled.has(tabId)) return;
  await attach(tabId);
  await sendCmd(tabId, "Network.enable").catch(() => {});
  enabled.add(tabId);
}

chrome.debugger.onEvent.addListener((source, method, params: any) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  if (method === "Network.requestWillBeSent") {
    const map = byRequest.get(tabId) ?? new Map();
    const entry: NetworkEntry = {
      seq: nextSeq(tabId),
      requestId: String(params?.requestId ?? ""),
      url: redactUrl(String(params?.request?.url ?? "")),
      method: String(params?.request?.method ?? ""),
      resourceType: params?.type,
      startedAt: Date.now(),
    };
    map.set(entry.requestId, entry);
    byRequest.set(tabId, map);
    store(tabId, entry);
  } else if (method === "Network.responseReceived") {
    const map = byRequest.get(tabId);
    const prev = map?.get(String(params?.requestId));
    if (prev) {
      prev.status = params?.response?.status;
      prev.statusText = params?.response?.statusText;
      prev.mimeType = params?.response?.mimeType;
      store(tabId, prev);
    }
  } else if (method === "Network.loadingFailed") {
    const map = byRequest.get(tabId);
    const prev = map?.get(String(params?.requestId));
    if (prev) {
      prev.failed = true;
      prev.errorText = String(params?.errorText ?? "failed").slice(0, 300);
      store(tabId, prev);
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) enabled.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers.delete(tabId);
  byRequest.delete(tabId);
  seqByTab.delete(tabId);
  enabled.delete(tabId);
});

export async function getNetwork(
  tabId: number,
  opts: { sinceSeq?: number; limit?: number; failedOnly?: boolean },
): Promise<{ entries: NetworkEntry[]; nextSeq: number }> {
  await assertAllowed(tabId);
  await ensureNetwork(tabId);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const since = opts.sinceSeq ?? 0;
  let out = (buffers.get(tabId) ?? []).filter((e) => e.seq > since);
  if (opts.failedOnly) out = out.filter((e) => e.failed || (e.status !== undefined && e.status >= 400));
  out = out.slice(-limit);
  return { entries: out, nextSeq: seqByTab.get(tabId) ?? 0 };
}
