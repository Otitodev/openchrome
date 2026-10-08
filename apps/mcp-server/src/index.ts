// OpenChrome MCP server (stdio) -> forwards to daemon ws://127.0.0.1:18721.
// No tool arg: run MCP stdio server. With tool arg: one-shot CLI (manual testing).
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const port = Number(process.env.OPENCHROME_PORT ?? 18721);
function loadToken(): string {
  if (process.env.OPENCHROME_TOKEN) return process.env.OPENCHROME_TOKEN;
  const dir = process.env.OPENCHROME_CONFIG_DIR ?? join(homedir(), ".openchrome");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = join(dir, "token");
  if (existsSync(p)) {
    const t = readFileSync(p, "utf8").trim();
    if (t.startsWith("oc_")) return t;
  }
  const t = "oc_" + randomBytes(16).toString("hex");
  writeFileSync(p, t + "\n", { mode: 0o600 });
  return t;
}
const token = loadToken();

function rpc(method: string, params: unknown, timeoutMs = 25000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = randomUUID();
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("COMMAND_TIMEOUT")); }, timeoutMs);
    ws.on("open", () => ws.send(JSON.stringify({ id: randomUUID(), type: "register", token, role: "mcp-shim" })));
    ws.on("message", (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.id !== id) {
        if (msg.success && msg.result?.ok) ws.send(JSON.stringify({ id, type: "command", method, params }));
        else if (!msg.success && msg.id && msg.error) { clearTimeout(timer); try { ws.close(); } catch {} reject(new Error(msg.error?.code + ": " + msg.error?.message)); }
        return;
      }
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (msg.success) resolve(msg.result);
      else reject(new Error(msg.error?.code + ": " + msg.error?.message));
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const tabId = z.number().describe("Chrome tab id (see browser_tabs)");
const timeoutMs = z.number().optional().describe("Command timeout ms, default 25000, max 60000");
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

async function runMcp(): Promise<void> {
  const server = new McpServer({ name: "openchrome", version: "0.1.0" });

  server.registerTool("browser_status", { description: "Daemon/extension connection health. No input.", inputSchema: {} }, async () => text(await rpc("status.get", {})));
  server.registerTool("browser_tabs", { description: "List agent-visible tabs (allow+ask policies, deny hidden).", inputSchema: {} }, async () => text(await rpc("tabs.list", {})));
  server.registerTool("browser_select_tab", { description: "Focus a tab. Ask-policy tabs need prior approval.", inputSchema: { tabId, timeoutMs } }, async (a) => text(await rpc("tabs.select", a)));
  server.registerTool("browser_open", { description: "Navigate tab to URL (same tab) or open new tab with newTab:true. Unknown sites need approval.", inputSchema: { url: z.string(), newTab: z.boolean().optional(), tabId: z.number().optional(), timeoutMs } }, async (a) => text(await rpc("tabs.open", a)));
  server.registerTool("browser_snapshot", { description: "Semantic page snapshot with [eN] refs. Take a fresh snapshot after navigation; stale refs error.", inputSchema: { tabId, timeoutMs } }, async (a) => text(await rpc("page.snapshot", a)));
  server.registerTool("browser_click", { description: "Click element ref from the latest snapshot.", inputSchema: { tabId, ref: z.string(), timeoutMs } }, async (a) => text(await rpc("element.click", a)));
  server.registerTool("browser_type", { description: "Type text into element ref. Password/sensitive elements return NEEDS_APPROVAL; approve in popup and retry.", inputSchema: { tabId, ref: z.string(), text: z.string(), timeoutMs } }, async (a) => text(await rpc("element.type", a)));
  server.registerTool("browser_press", { description: "Press a key (Enter, Tab, Escape, Backspace, Delete, arrows).", inputSchema: { tabId, key: z.string(), ref: z.string().optional(), timeoutMs } }, async (a) => text(await rpc("input.press", a)));
  server.registerTool("browser_back", { description: "History back.", inputSchema: { tabId, timeoutMs } }, async (a) => text(await rpc("tabs.back", a)));
  server.registerTool("browser_forward", { description: "History forward.", inputSchema: { tabId, timeoutMs } }, async (a) => text(await rpc("tabs.forward", a)));
  server.registerTool("browser_reload", { description: "Reload tab (invalidates refs; snapshot again after).", inputSchema: { tabId, timeoutMs } }, async (a) => text(await rpc("tabs.reload", a)));
  server.registerTool("browser_console", { description: "Console entries with seq cursors. Poll with sinceSeq from last nextSeq.", inputSchema: { tabId, level: z.enum(["log", "warn", "error"]).optional(), limit: z.number().optional(), sinceSeq: z.number().optional(), timeoutMs } }, async (a) => text(await rpc("console.get", a)));
  server.registerTool("browser_network", { description: "Network entries (URL/method/status, no bodies). failedOnly filters 4xx/5xx+failures.", inputSchema: { tabId, limit: z.number().optional(), sinceSeq: z.number().optional(), failedOnly: z.boolean().optional(), timeoutMs } }, async (a) => text(await rpc("network.get", a)));
  server.registerTool("browser_screenshot", { description: "Viewport screenshot as image. Includes pageGeneration text to detect staleness.", inputSchema: { tabId, format: z.enum(["png", "jpeg"]).optional(), timeoutMs } }, async (a) => {
    const r: any = await rpc("page.screenshot", a);
    return { content: [{ type: "image" as const, data: r.data, mimeType: r.mimeType ?? "image/png" }, { type: "text" as const, text: `pageGeneration: ${r.pageGeneration ?? "unknown"}` }] };
  });

  await server.connect(new StdioServerTransport());
}

// --- one-shot CLI (manual testing) ---
function runCli(): void {
  const [method, rawArg, rawArg2, rawArg3] = [process.argv[2] as string, process.argv[3], process.argv[4], process.argv[5]];
  // PowerShell mangles quotes. Accept: {"tabId":1} | {\"tabId\":1} | tabId=1 | 1744950748 (bare tab id)
  const parseParams = (raw: string | undefined): Record<string, unknown> => {
    if (!raw) return {};
    let s = raw.trim();
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"') && s.includes("{"))) s = s.slice(1, -1);
    s = s.replace(/\\"/g, '"');
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === "number") return { tabId: parsed };
      return parsed;
    } catch {}
    const mTab = s.match(/tabId\s*=\s*(\d+)/) ?? s.match(/^(\d+)$/);
    if (mTab) return { tabId: Number(mTab[1]) };
    throw new Error(`invalid JSON params: ${raw}`);
  };
  const params = parseParams(rawArg);
  if (rawArg !== undefined && rawArg2 !== undefined) {
    const asNum = Number(rawArg);
    if (Number.isInteger(asNum) && !Object.prototype.hasOwnProperty.call(params, "ref") && !Object.prototype.hasOwnProperty.call(params, "key")) {
      params.tabId = asNum;
      if (method === "browser_click") params.ref = rawArg2;
      else if (method === "browser_press") {
        params.key = rawArg2;
        if (rawArg3 !== undefined) params.ref = rawArg3;
      } else if (method === "browser_type") {
        params.ref = rawArg2;
        if (rawArg3 !== undefined) params.text = rawArg3;
      }
    }
  }
  const MAP: Record<string, [string, unknown]> = {
    browser_status: ["status.get", {}],
    browser_tabs: ["tabs.list", params],
    browser_select_tab: ["tabs.select", params],
    browser_open: ["tabs.open", params],
    browser_back: ["tabs.back", params],
    browser_forward: ["tabs.forward", params],
    browser_reload: ["tabs.reload", params],
    browser_snapshot: ["page.snapshot", params],
    browser_click: ["element.click", params],
    browser_type: ["element.type", params],
    browser_press: ["input.press", params],
    browser_console: ["console.get", params],
    browser_network: ["network.get", params],
    browser_screenshot: ["page.screenshot", params],
  };
  const entry = MAP[method];
  if (!entry) {
    console.error(`unknown method ${method}`);
    process.exit(2);
  }
  rpc(entry[0], { ...((entry[1] as Record<string, unknown>) ?? {}), timeoutMs: (params as any).timeoutMs ?? 15000 }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(String(e)); process.exit(1); });
}

if (process.argv[2] === undefined) {
  runMcp().catch((e) => { console.error(String(e)); process.exit(1); });
} else {
  runCli();
}
