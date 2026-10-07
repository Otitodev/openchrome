export interface ElementReference {
  ref: string;
  backendNodeId?: number;
  nodeId?: number;
  role?: string;
  name?: string;
  frameId?: string;
  pageGeneration: number;
  createdAt: number;
}

export function formatRef(ref: string, frameId?: string): string {
  if (!frameId || frameId === "main") return `[${ref}]`;
  return `[${ref} in ${frameId}]`;
}

export function truncateName(name: string, max = 80): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}
