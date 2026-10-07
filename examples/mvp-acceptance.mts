// MVP acceptance: full agent loop against a fake extension.
// Usage: node ./node_modules/tsx/dist/cli.mjs examples/mvp-acceptance.mts
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PORT = Number(process.env.OPENCHROME_PORT ?? 18721);
let token = process.env.OPENCHROME_TOKEN;
if (!token) {
  try { token = readFileSync(join(homedir(), ".openchrome", "token"), "utf8").trim(); }
  catch { token = "oc_dev_token"; }
}

const daemon = spawn(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "apps/daemon/src/index.ts"], { stdio: ["ignore", "pipe", "pipe"] });
daemon.on("error", () => {});
daemon.stderr?.on("data", () => {});
// wait until port accepts (daemon ready) instead of fixed sleep
async function waitForPort(tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = new WebSocket(`ws://127.0.0.1:${PORT}`);
        s.on("open", () => { s.close(); resolve(); });
        s.on("error", reject);
      });
      return;
    } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  throw new Error("daemon did not start");
}
await waitForPort();

// fake extension: answers every method with plausible payloads
const ext = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise<void>((resolve, reject) => {
  ext.on("open", () => ext.send(JSON.stringify({ id: "reg", type: "register", token, role: "extension" })));
  ext.on("message", (raw) => {
    const m: any = JSON.parse(String(raw));
    if (m.id === "reg" && m.success) resolve();
  });
  ext.on("error", reject);
});
ext.on("message", (raw) => {
  const m: any = JSON.parse(String(raw));
  if (m.type !== "command") return;
  const ok = (result: unknown) => ext.send(JSON.stringify({ id: m.id, type: "response", success: true, result }));
  switch (m.method) {
    case "tabs.list": return ok({ tabs: [{ id: 42, title: "Signup", url: "http://localhost:3000/signup", active: true, policy: "allow" }], activeTab: 42 });
    case "page.snapshot": return ok({ text: '[e1] textbox "Email"\n[e2] textbox "Password"\n[e3] button "Create account"', pageGeneration: 1, truncated: false });
    case "element.click": return ok({ tabId: 42, ref: m.params.ref, clicked: true });
    case "element.type": return ok({ tabId: 42, ref: m.params.ref, typed: String(m.params.text).length });
    case "input.press": return ok({ tabId: 42, key: m.params.key });
    case "console.get": return ok({ entries: [], nextSeq: 3 });
    case "network.get": return ok({ entries: [{ seq: 1, requestId: "1", url: "http://localhost:3000/api/users", method: "POST", status: 200, startedAt: Date.now() }], nextSeq: 1 });
    case "tabs.reload": return ok({ tabId: 42 });
    case "status.get": return ok({ extension: true });
    default: ext.send(JSON.stringify({ id: m.id, type: "response", success: false, error: { code: "NAVIGATION_FAILED", message: "unexpected " + m.method } }));
  }
});

// shim client
const shim = new WebSocket(`ws://127.0.0.1:${PORT}`);
await new Promise<void>((resolve, reject) => {
  shim.on("open", () => shim.send(JSON.stringify({ id: "reg2", type: "register", token, role: "mcp-shim" })));
  shim.on("message", (raw) => {
    const m: any = JSON.parse(String(raw));
    if (m.id === "reg2" && m.success) resolve();
  });
  shim.on("error", reject);
});

function cmd(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => reject(new Error("timeout " + method)), 8000);
    const onMsg = (raw: any) => {
      const m: any = JSON.parse(String(raw));
      if (m.id !== id) return;
      clearTimeout(timer);
      shim.off("message", onMsg);
      if (m.success) resolve(m.result);
      else reject(new Error(m.error.code + ": " + m.error.message));
    };
    shim.on("message", onMsg);
    shim.send(JSON.stringify({ id, type: "command", method, params }));
  });
}

const checks: Array<[string, () => Promise<void>]> = [
  ["status", async () => { await cmd("status.get", {}); }],
  ["tabs", async () => {
    const r: any = await cmd("tabs.list", {});
    if (r.tabs?.[0]?.id !== 42) throw new Error("tabs mismatch");
  }],
  ["snapshot", async () => {
    const r: any = await cmd("page.snapshot", { tabId: 42 });
    if (!r.text.includes("Create account")) throw new Error("snapshot mismatch");
  }],
  ["fill+submit", async () => {
    await cmd("element.type", { tabId: 42, ref: "e1", text: "test@example.com" });
    await cmd("element.type", { tabId: 42, ref: "e2", text: "Password123" });
    await cmd("element.click", { tabId: 42, ref: "e3" });
    await cmd("input.press", { tabId: 42, key: "Enter" });
  }],
  ["inspect", async () => {
    const c: any = await cmd("console.get", { tabId: 42, limit: 50 });
    const n: any = await cmd("network.get", { tabId: 42, limit: 100 });
    if (c.nextSeq === undefined || n.entries?.[0]?.status !== 200) throw new Error("inspect mismatch");
  }],
  ["reload+verify", async () => {
    await cmd("tabs.reload", { tabId: 42 });
    const r: any = await cmd("page.snapshot", { tabId: 42 });
    if (!r.text.includes("e1")) throw new Error("verify mismatch");
  }],
];

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${String(e)}`); }
}
shim.close();
ext.close();
daemon.kill();
process.exit(failed ? 1 : 0);
