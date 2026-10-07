#!/usr/bin/env node
// openchrome CLI: daemon | init | reset-token | status
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const cmd = process.argv[2] ?? "help";
const here = dirname(fileURLToPath(import.meta.url));

if (cmd === "daemon") {
  const child = spawn(process.execPath, [join(here, "../dist/index.js"), ...process.argv.slice(3)], { stdio: "inherit" });
  // NOTE: dev fallback — if dist missing, use tsx
  child.on("exit", (c) => process.exit(c ?? 0));
} else if (cmd === "init") {
  const { loadOrCreateToken } = await import("../src/token-store.js").catch(() => import("../dist/token-store.js"));
  const token = loadOrCreateToken();
  const port = process.env.OPENCHROME_PORT ?? 18721;
  console.log(`OpenChrome\n\nDaemon token (paste into extension popup Pairing field):\n  ${token}\n\nDaemon endpoint: ws://127.0.0.1:${port}\n\nNext:\n  1. run: openchrome daemon\n  2. load apps/extension in chrome://extensions (Developer mode)\n  3. paste token into popup -> Pair\n  4. run: openchrome status`);
} else if (cmd === "reset-token") {
  const { resetToken } = await import("../src/token-store.js").catch(() => import("../dist/token-store.js"));
  console.log(resetToken());
} else if (cmd === "status") {
  const port = Number(process.env.OPENCHROME_PORT ?? 18721);
  const { loadOrCreateToken } = await import("../src/token-store.js").catch(() => import("../dist/token-store.js"));
  const WebSocket = (await import("ws")).default;
  const token = loadOrCreateToken();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const id = Math.random().toString(36).slice(2);
  const timer = setTimeout(() => { console.error("COMMAND_TIMEOUT"); process.exit(1); }, 8000);
  ws.on("open", () => ws.send(JSON.stringify({ id: "reg1", type: "register", token, role: "mcp-shim" })));
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id === "reg1" && msg.success) { ws.send(JSON.stringify({ id, type: "command", method: "status.get", params: {} })); return; }
    if (msg.id === id) {
      clearTimeout(timer);
      console.log(JSON.stringify(msg.success ? msg.result : msg.error, null, 2));
      ws.close();
      process.exit(msg.success ? 0 : 1);
    }
  });
} else {
  console.log(`usage: openchrome <daemon|init|reset-token|status> [--port N]`);
}
