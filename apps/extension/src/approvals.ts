// Approval flow: ask-policy tabs + sensitive actions return NEEDS_APPROVAL.
// Popup grants actionKey for 5 min; agent retries after user approves.
const GRANT_MS = 5 * 60 * 1000;

function key(method: string, tabId?: number, ref?: string, url?: string): string {
  return [method, tabId ?? "", ref ?? "", url ?? ""].join("|");
}

async function getStore(): Promise<{ grants: Record<string, number>; pending: Record<string, { reason: string; createdAt: number }> }> {
  const s = await chrome.storage.local.get(["ocGrants", "ocPending"]);
  return { grants: (s.ocGrants as any) ?? {}, pending: (s.ocPending as any) ?? {} };
}

export async function isGranted(actionKey: string): Promise<boolean> {
  const { grants } = await getStore();
  return (grants[actionKey] ?? 0) > Date.now();
}

export async function grant(actionKey: string): Promise<void> {
  const { grants, pending } = await getStore();
  grants[actionKey] = Date.now() + GRANT_MS;
  delete pending[actionKey];
  await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
}

export function actionKeyFor(method: string, tabId?: number, ref?: string, url?: string): string {
  return key(method, tabId, ref, url);
}

/** Throw NEEDS_APPROVAL unless granted. Records pending for popup display. */
export async function requireApproval(actionKey: string, reason: string): Promise<void> {
  if (await isGranted(actionKey)) return;
  const { grants, pending } = await getStore();
  pending[actionKey] = { reason, createdAt: Date.now() };
  await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
  const err: any = new Error(`needs approval: ${reason} (actionKey=${actionKey}). Ask user to Approve in popup, then retry.`);
  err.code = "NEEDS_APPROVAL";
  err.actionKey = actionKey;
  throw err;
}

const SENSITIVE_REF = /pay|checkout|delete|password|send|publish|subscribe/i;

export function sensitiveRefReason(refName?: string): string | null {
  if (refName && SENSITIVE_REF.test(refName)) return `sensitive element "${refName}"`;
  return null;
}
