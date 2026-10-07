import { truncateName, type ElementReference } from "./elements.js";
import { SNAPSHOT_MAX_NODES, SNAPSHOT_NAME_TRUNCATE } from "../../shared/src/types.js";

export interface AXNode {
  nodeId: string;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeIds?: number[];
  frameId?: string;
  hidden?: boolean;
  disabled?: boolean;
}

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio", "combobox",
  "listbox", "menuitem", "tab", "switch", "slider", "searchbox",
]);

const HEADING_ROLES = new Set(["heading", "h1", "h2", "h3", "h4", "h5", "h6"]);

function roleOf(n: AXNode): string {
  return String(n.role?.value ?? "generic").toLowerCase();
}

export interface SnapshotResult {
  text: string;
  refs: ElementReference[];
  pageGeneration: number;
  truncated: boolean;
}

export function buildSnapshot(
  nodes: AXNode[],
  opts: { url: string; title: string; pageGeneration: number; frameLabels?: Map<string, string> },
): SnapshotResult {
  const lines: string[] = [`URL: ${opts.url}`, ``, `Title: ${opts.title}`, ``];
  const refs: ElementReference[] = [];
  let counter = 0;
  let truncated = false;

  for (const n of nodes) {
    if (counter >= SNAPSHOT_MAX_NODES) { truncated = true; break; }
    if (n.hidden) continue;
    const role = roleOf(n);
    const rawName = String(n.name?.value ?? "").trim();
    if (!rawName && !INTERACTIVE_ROLES.has(role) && !HEADING_ROLES.has(role)) continue;
    // skip pure generics without names (noise)
    if (role === "generic" || role === "none" || role === "presentation") continue;

    counter++;
    const ref = `e${counter}`;
    const frameId = n.frameId && n.frameId !== "main" ? n.frameId : undefined;
    const frameSuffix = frameId ? ` in ${opts.frameLabels?.get(frameId) ?? frameId}` : "";
    const name = truncateName(rawName || role, SNAPSHOT_NAME_TRUNCATE);
    lines.push(`[${ref}${frameSuffix}] ${role} "${name}"`);
    refs.push({
      ref,
      backendNodeId: n.backendDOMNodeIds?.[0],
      role,
      name,
      frameId,
      pageGeneration: opts.pageGeneration,
      createdAt: Date.now(),
    });
  }

  if (truncated) lines.push(`... truncated to ${SNAPSHOT_MAX_NODES} nodes`);
  return { text: lines.join("\n"), refs, pageGeneration: opts.pageGeneration, truncated };
}

export function lookupRef(
  refs: ElementReference[],
  ref: string,
  pageGeneration: number,
): ElementReference {
  const found = refs.find((r) => r.ref === ref);
  if (!found) {
    const err: any = new Error(`element ${ref} not found. Request a new snapshot.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  if (found.pageGeneration !== pageGeneration) {
    const err: any = new Error(`stale ${ref}. The page changed. Request a new snapshot.`);
    err.code = "STALE_ELEMENT_REFERENCE";
    throw err;
  }
  return found;
}
