export type OpenChromeErrorCode =
  | "CHROME_NOT_CONNECTED"
  | "TAB_NOT_FOUND"
  | "TAB_NOT_ALLOWED"
  | "SESSION_BUSY"
  | "AUTH_FAILED"
  | "DEBUGGER_ATTACH_FAILED"
  | "ELEMENT_NOT_FOUND"
  | "STALE_ELEMENT_REFERENCE"
  | "NAVIGATION_FAILED"
  | "COMMAND_TIMEOUT"
  | "NEEDS_APPROVAL";

export interface OpenChromeError {
  code: OpenChromeErrorCode;
  message: string;
  reason?: string;
}

export interface SitePermission {
  pattern: string;
  policy: "allow" | "ask" | "deny";
}

export const DEFAULT_PORT = 18721;
export const DEFAULT_TIMEOUT_MS = 15000;
export const MAX_TIMEOUT_MS = 60000;
export const HEARTBEAT_PING_MS = 5000;
export const HEARTBEAT_DEAD_MS = 15000;
export const DEBUGGER_IDLE_DETACH_MS = 60000;
export const SNAPSHOT_MAX_NODES = 500;
export const SNAPSHOT_NAME_TRUNCATE = 80;
