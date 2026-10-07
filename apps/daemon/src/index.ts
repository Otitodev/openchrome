import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_PORT, DEFAULT_TIMEOUT_MS } from "../../../packages/shared/src/types.js";
import { loadOrCreateToken, resetToken } from "./token-store.js";
import { TabRegistry } from "./tab-registry.js";

const args = process.argv.slice(2);
if (args.includes("--reset-token")) {
  console.log(resetToken());
  process.exit(0);
}
let port = Number(process.env.OPENCHROME_PORT ?? DEFAULT_PORT);
const portFlag = args.indexOf("--port");
if (portFlag >= 0 && args[portFlag + 1]) port = Number(args[portFlag + 1]);

const token = loadOrCreateToken();
const registry = new TabRegistry();
const server = createServer();
const wss = new WebSocketServer({ server });
let activeShim: WebSocket | null = null;
let extensionSock: WebSocket | null = null;

// pending id -> { resolve, reject, timer, owner }
const pending = new Map<string, { timer: NodeJS.Timeout; owner: WebSocket }>();

function send(ws: WebSocket, obj: unknown): void {
  ws.send(JSON.stringify(obj));
}

function forwardToExtension(id: string, method: string, params: unknown, owner: WebSocket, timeoutMs: number): void {
  if (!extensionSock || extensionSock.readyState !== WebSocket.OPEN) {
    send(owner, { id, type: "response", success: false, error: { code: "CHROME_NOT_CONNECTED", message: "extension not connected. Pair token and open Chrome." } });
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(id);
    send(owner, { id, type: "response", success: false, error: { code: "COMMAND_TIMEOUT", message: `extension did not respond in ${timeoutMs}ms` } });
  }, timeoutMs);
  pending.set(id, { timer, owner });
  send(extensionSock, { id, type: "command", method, params });
}

wss.on("connection", (ws: WebSocket) => {
  let authed = false;
  let role: string | null = null;
  const heartbeat = setInterval(() => { try { ws.ping(); } catch {} }, 5000);
  let dead = setTimeout(() => ws.terminate(), 15000);
  ws.on("pong", () => {
    clearTimeout(dead);
    dead = setTimeout(() => ws.terminate(), 15000);
  });
  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === "register") {
      if (msg.token !== token) {
        send(ws, { id: msg.id, type: "response", success: false, error: { code: "AUTH_FAILED", message: "bad token" } });
        ws.close();
        return;
      }
      if (msg.role === "mcp-shim") {
        if (activeShim && activeShim !== ws && (activeShim as WebSocket).readyState === WebSocket.OPEN) {
          send(ws, { id: msg.id, type: "response", success: false, error: { code: "SESSION_BUSY", message: "daemon already bound to another agent" } });
          ws.close();
          return;
        }
        activeShim = ws;
      }
      if (msg.role === "extension") {
        extensionSock = ws;
        registry.extensionConnected = true;
      }
      authed = true;
      role = msg.role;
      send(ws, { id: msg.id, type: "response", success: true, result: { ok: true } });
      return;
    }
    if (!authed) {
      send(ws, { id: msg.id, type: "response", success: false, error: { code: "AUTH_FAILED", message: "register first" } });
      return;
    }
    if (msg.type === "response") {
      // from extension -> route back to shim owner
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id);
        send(p.owner, msg);
        // track generation bumps + active tab
        if (msg.success && msg.result && typeof msg.result === "object") {
          const r: any = msg.result;
          if (typeof r.activeTab === "number") registry.activeTab = r.activeTab;
          if (typeof r.tabId === "number" && (msg as any).method?.includes("reload") ) registry.bumpGeneration(r.tabId);
        }
      }
      return;
    }
    if (msg.type === "command") {
      const timeoutMs = Math.min(Number(msg.params?.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 60000);
      if (msg.method === "status.get") {
        send(ws, { id: msg.id, type: "response", success: true, result: { extensionConnected: registry.extensionConnected, daemonVersion: "0.1.0", activeTab: registry.activeTab, uptimeMs: Math.round(process.uptime() * 1000) } });
        return;
      }
      // shim -> extension forwarding for tab commands + future page commands
      if (role === "mcp-shim" && (msg.method.startsWith("tabs.") || msg.method.startsWith("page.") || msg.method.startsWith("element.") || msg.method.startsWith("input.") || msg.method.startsWith("console.") || msg.method.startsWith("network."))) {
        forwardToExtension(msg.id ?? randomUUID(), msg.method, msg.params ?? {}, ws, timeoutMs);
        return;
      }
      send(ws, { id: msg.id, type: "response", success: false, error: { code: "CHROME_NOT_CONNECTED", message: `no handler for ${msg.method} (role=${role})` } });
      return;
    }
    if (msg.type === "event" && role === "extension" && msg.name === "tabs.changed") {
      registry.extensionConnected = true;
      return;
    }
  });
  ws.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(dead);
    if (activeShim === ws) activeShim = null;
    if (extensionSock === ws) {
      extensionSock = null;
      registry.extensionConnected = false;
    }
    // cancel pending owned by this socket
    for (const [id, p] of pending) {
      if (p.owner === ws) {
        clearTimeout(p.timer);
        pending.delete(id);
      }
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`openchrome daemon on ws://127.0.0.1:${port}`);
});
