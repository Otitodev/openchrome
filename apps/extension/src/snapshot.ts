// Extension snapshot: CDP Accessibility.getFullAXTree -> buildSnapshot -> ref map per tab+generation.
import { buildSnapshot, lookupRef, type AXNode } from "../../../packages/browser-model/src/snapshot.js";
import type { ElementReference } from "../../../packages/browser-model/src/elements.js";
import { attach } from "./debugger.js";
import { assertAllowed } from "./tabs.js";

interface TabState {
  generation: number;
  refs: ElementReference[];
}

const tabState = new Map<number, TabState>();

export function getGeneration(tabId: number): number {
  return tabState.get(tabId)?.generation ?? 0;
}

export function bumpGeneration(tabId: number): number {
  const g = getGeneration(tabId) + 1;
  tabState.set(tabId, { generation: g, refs: [] });
  return g;
}

export function resolveRef(tabId: number, ref: string): ElementReference {
  const st = tabState.get(tabId);
  if (!st) {
    const err: any = new Error(`no snapshot for tab ${tabId}. Request browser_snapshot first.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  return lookupRef(st.refs, ref, st.generation);
}

function sendCmd(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result: any) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

export async function snapshotTab(tabId: number): Promise<{ text: string; pageGeneration: number; truncated: boolean }> {
  await assertAllowed(tabId);
  await attach(tabId);
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  const title = tab.title ?? "";

  // Enable domains (idempotent)
  await sendCmd(tabId, "Accessibility.enable").catch(() => {});
  await sendCmd(tabId, "DOM.enable").catch(() => {});

  const ax = await sendCmd(tabId, "Accessibility.getFullAXTree", { depth: 50 }).catch((e: Error) => {
    const err: any = new Error(`snapshot failed: ${e.message}`);
    err.code = "NAVIGATION_FAILED";
    throw err;
  });
  const nodes: AXNode[] = (ax?.nodes ?? []).map((n: any) => ({
    nodeId: String(n.nodeId),
    role: n.role,
    name: n.name,
    backendDOMNodeIds: n.backendDOMNodeIds,
    frameId: n.frameId,
    hidden: n.hidden,
    disabled: n.disabled,
  }));

  // Fresh generation per snapshot would invalidate refs taken just before click.
  // Keep current generation unless navigation happened (bumpGeneration called on nav events).
  const generation = getGeneration(tabId);
  const { text, refs, truncated } = buildSnapshot(nodes, { url, title, pageGeneration: generation });
  tabState.set(tabId, { generation, refs });
  return { text, pageGeneration: generation, truncated };
}

// Navigation bumps generation (called from tabs navigation hooks via webNavigation if wired later).
chrome.webNavigation?.onCommitted?.addListener((details: any) => {
  if (details.frameId === 0 && typeof details.tabId === "number") bumpGeneration(details.tabId);
});
