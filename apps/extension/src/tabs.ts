// TabManager: allow+ask visible, deny hidden. Reads gated via assertVisible,
// writes gated via assertWritable (+ NEEDS_APPROVAL for ask tabs).
import { loadRules, resolvePolicy, type Policy } from "./permissions.js";
import { actionKeyFor, requireApproval } from "./approvals.js";

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  policy: Policy;
}

export async function tabPolicy(tabId: number): Promise<{ url: string; policy: Policy }> {
  const rules = await loadRules();
  const tab = await chrome.tabs.get(tabId).catch(() => { throw Object.assign(new Error(`tab ${tabId} not found`), { code: "TAB_NOT_FOUND" }); });
  const url = tab.url ?? "";
  return { url, policy: resolvePolicy(url, rules) };
}

export async function listAllowedTabs(): Promise<{ tabs: TabInfo[]; activeTab?: number }> {
  const rules = await loadRules();
  const tabs = await chrome.tabs.query({});
  const out: TabInfo[] = [];
  let activeTab: number | undefined;
  for (const t of tabs) {
    if (t.id === undefined || !t.url) continue;
    const policy = resolvePolicy(t.url, rules);
    if (policy === "deny") continue; // deny hidden; ask visible but write-gated
    out.push({ id: t.id, title: t.title ?? "", url: t.url, active: !!t.active, policy });
    if (t.active) activeTab = t.id;
  }
  return { tabs: out, activeTab };
}

/** Reads (snapshot/console/network/screenshot/list) allowed on allow+ask. */
export async function assertVisible(tabId: number): Promise<void> {
  const { policy } = await tabPolicy(tabId);
  if (policy === "deny") {
    const err: any = new Error(`tab ${tabId} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
}

/** Writes (open/click/type/press/nav/select) need approval on ask tabs. */
export async function assertWritable(method: string, tabId: number, refOrUrl?: string): Promise<void> {
  const { url, policy } = await tabPolicy(tabId).catch(() => ({ url: "", policy: "deny" as Policy }));
  if (policy === "deny") {
    const err: any = new Error(`tab ${tabId} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
  if (policy === "ask") {
    await requireApproval(actionKeyFor(method, tabId, refOrUrl, url), `tab ${tabId} (${url}) requires approval`);
  }
}

// Back-compat: old callers used assertAllowed for reads.
export const assertAllowed = assertVisible;

export async function selectTab(tabId: number): Promise<{ tabId: number; activeTab: number }> {
  await assertWritable("tabs.select", tabId);
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  return { tabId, activeTab: tabId };
}

export async function openUrl(url: string, newTab: boolean, tabId?: number): Promise<{ tabId: number }> {
  const rules = await loadRules();
  const policy = resolvePolicy(url, rules);
  if (policy === "deny") {
    const err: any = new Error(`navigation to ${url} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
  if (policy === "ask") {
    await requireApproval(actionKeyFor("tabs.open", tabId, undefined, url), `navigation to ${url} requires approval`);
  }
  if (newTab || tabId === undefined) {
    const t = await chrome.tabs.create({ url, active: true });
    return { tabId: t.id! };
  }
  await chrome.tabs.update(tabId, { url });
  return { tabId };
}

export async function goBack(tabId: number): Promise<{ tabId: number }> {
  await assertWritable("tabs.back", tabId);
  await chrome.tabs.goBack(tabId);
  return { tabId };
}

export async function goForward(tabId: number): Promise<{ tabId: number }> {
  await assertWritable("tabs.forward", tabId);
  await chrome.tabs.goForward(tabId);
  return { tabId };
}

export async function reloadTab(tabId: number): Promise<{ tabId: number }> {
  await assertWritable("tabs.reload", tabId);
  await chrome.tabs.reload(tabId);
  return { tabId };
}
