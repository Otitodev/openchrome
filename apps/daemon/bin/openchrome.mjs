#!/usr/bin/env node
// opc CLI: daemon | init | reset-token | status. Self-contained (no TS imports).
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const cmd = process.argv[2] ?? "help";
const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.OPENCHROME_PORT ?? 18721);

function tokenPath() {
  const dir = process.env.OPENCHROME_CONFIG_DIR ?? join(homedir(), ".openchrome");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, "token");
}
function loadOrCreateToken() {
  if (process.env.OPENCHROME_TOKEN) return process.env.OPENCHROME_TOKEN;
  const p = tokenPath();
  if (existsSync(p)) {
    const t = readFileSync(p, "utf8").trim();
    if (t.startsWith("oc_")) return t;
  }
  const t = "oc_" + randomBytes(16).toString("hex");
  writeFileSync(p, t + "\n", { mode: 0o600 });
  return t;
}

if (cmd === "daemon") {
  const dist = join(here, "../dist/index.cjs");
  const args = process.argv.slice(3);
  if (existsSync(dist)) {
    const child = spawn(process.execPath, [dist, ...args], { stdio: "inherit" });
    child.on("exit", (c) => process.exit(c ?? 0));
  } else {
    console.error("dist missing; run `npm run build` first (or use tsx dev: node ./node_modules/tsx/dist/cli.mjs apps/daemon/src/index.ts)");
    process.exit(1);
  }
} else if (cmd === "init") {
  const token = loadOrCreateToken();
  console.log(`OpenChrome\n\nDaemon token (paste into extension popup Pairing field):\n  ${token}\n\nDaemon endpoint: ws://127.0.0.1:${port}\n\nNext:\n  1. run: opchrm daemon (or npm run daemon)\n  2. load apps/extension in chrome://extensions (Developer mode)\n  3. paste token into popup -> Pair\n  4. run: opchrm status`);
} else if (cmd === "reset-token") {
  const t = "oc_" + randomBytes(16).toString("hex");
  writeFileSync(tokenPath(), t + "\n", { mode: 0o600 });
  console.log(t);
} else if (cmd === "status") {
  const token = loadOrCreateToken();
  const { default: WebSocket } = await import("ws").catch(() => ({ default: null }));
  if (!WebSocket) {
    // fallback: raw TCP probe won't speak WS; just report daemon port state
    const net = await import("node:net");
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => { console.log(JSON.stringify({ daemonPort: port, reachable: true }, null, 2)); process.exit(0); });
    s.on("error", () => { console.error("daemon not reachable on " + port); process.exit(1); });
  } else {
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
  }
} else {
  console.log(`usage: opchrm <daemon|init|reset-token|status> [--port N]`);
}
