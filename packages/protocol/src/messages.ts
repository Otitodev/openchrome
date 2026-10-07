import type { OpenChromeError } from "../../shared/src/types.js";

export interface CommandMessage {
  id: string;
  type: "command";
  method: string;
  params: unknown;
}

export interface CommandResponse {
  id: string;
  type: "response";
  success: boolean;
  result?: unknown;
  error?: OpenChromeError;
}

export interface RegisterMessage {
  id: string;
  type: "register";
  token: string;
  role: "extension" | "mcp-shim";
}

export type BrowserCommand =
  | "status.get"
  | "tabs.list"
  | "tabs.select"
  | "tabs.open"
  | "tabs.back"
  | "tabs.forward"
  | "tabs.reload"
  | "page.snapshot"
  | "element.click"
  | "element.type"
  | "input.press"
  | "page.screenshot"
  | "console.get"
  | "network.get";
