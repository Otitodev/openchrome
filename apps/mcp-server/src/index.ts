// MCP stdio shim -> forwards to daemon ws://127.0.0.1:18721.
// Phase 4: + snapshot/click/type/press. argv CLI for manual testing.
import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const port = Number(process.env.OPENCHROME_PORT ?? 18721);
const token = process.env.OPENCHROME_TOKEN ?? (await import("../../daemon/src/token-store.js").then((m: any) => m.loadOrCreateToken()).catch(() => "oc_dev_token"));

function rpc(method: string, params: unknown, timeoutMs = 15000): Promise<unknown> {
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

const [method, argJson] = [process.argv[2] ?? "browser_status", process.argv[3]];
const params = argJson ? JSON.parse(argJson) : {};
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
rpc(entry[0], { ...((entry[1] as Record<string, unknown>) ?? {}), timeoutMs: (params as any).timeoutMs }).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(String(e)); process.exit(1); });
