// DebuggerManager: attach on demand, detach on revoke/close/denied-nav/idle 60s.
// One debugger per tab; fails with DEBUGGER_ATTACH_FAILED if user DevTools open.
const attached = new Set<number>();
const idleTimers = new Map<number, number>();

const IDLE_MS = 60000;

function clearIdle(tabId: number): void {
  const t = idleTimers.get(tabId);
  if (t !== undefined) {
    clearTimeout(t);
    idleTimers.delete(tabId);
  }
}

function armIdle(tabId: number): void {
  clearIdle(tabId);
  const t = setTimeout(() => detach(tabId).catch(() => {}), IDLE_MS) as unknown as number;
  idleTimers.set(tabId, t);
}

export async function attach(tabId: number): Promise<void> {
  if (attached.has(tabId)) {
    armIdle(tabId);
    return;
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
    armIdle(tabId);
  } catch (e) {
    const err: any = new Error(`debugger attach failed for tab ${tabId}. Close DevTools and retry.`);
    err.code = "DEBUGGER_ATTACH_FAILED";
    throw err;
  }
}

export async function detach(tabId: number): Promise<void> {
  clearIdle(tabId);
  if (!attached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // ignore already-detached
  }
  attached.delete(tabId);
}

export function detachAll(): Promise<void[]> {
  return Promise.all([...attached].map((t) => detach(t)));
}

// Auto-detach on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  detach(tabId).catch(() => {});
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== undefined) {
    attached.delete(source.tabId);
    clearIdle(source.tabId);
  }
});
