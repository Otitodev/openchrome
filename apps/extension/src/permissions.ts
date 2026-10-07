// Permission model: allow/ask/deny by URL pattern. Enforcement in TabManager.
export type Policy = "allow" | "ask" | "deny";

export interface SitePermission {
  pattern: string;
  policy: Policy;
}

const DEFAULTS: SitePermission[] = [
  { pattern: "localhost", policy: "allow" },
  { pattern: "127.0.0.1", policy: "allow" },
];

export function matches(url: string, pattern: string): boolean {
  try {
    const host = new URL(url).hostname;
    if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
    return host === pattern || host.includes(pattern);
  } catch {
    return url.includes(pattern);
  }
}

export function resolvePolicy(url: string, rules: SitePermission[]): Policy {
  for (const r of rules) {
    if (matches(url, r.pattern)) return r.policy;
  }
  for (const r of DEFAULTS) {
    if (matches(url, r.pattern)) return r.policy;
  }
  return "ask"; // unknown sites ask (approval-gated), explicit deny only via rules
}

export async function loadRules(): Promise<SitePermission[]> {
  const { ocRules } = await chrome.storage.local.get("ocRules");
  return (ocRules as SitePermission[]) ?? [];
}
