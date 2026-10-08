// Save a page.screenshot to disk via daemon (avoids shuttling base64 through tools).
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const [, , outFile, tabIdStr, format] = process.argv;
const tabId = Number(tabIdStr);
let token;
try { token = fs.readFileSync(path.join(os.homedir(), ".openchrome", "token"), "utf8").trim(); }
catch { token = "oc_dev_token"; }

const ws = new WebSocket("ws://127.0.0.1:18721");
const id = crypto.randomUUID();
ws.on("open", () => ws.send(JSON.stringify({ id: crypto.randomUUID(), type: "register", token, role: "mcp-shim" })));
ws.on("message", (raw) => {
  const m = JSON.parse(String(raw));
  if (m.id !== id && m.success && m.result && m.result.ok) {
    ws.send(JSON.stringify({ id, type: "command", method: "page.screenshot", params: { tabId, format: format || "png" } }));
    return;
  }
  if (m.id !== id) return;
  if (!m.success) { console.error("FAIL " + m.error.code + ": " + m.error.message); process.exit(1); }
  fs.writeFileSync(outFile, Buffer.from(m.result.data, "base64"));
  console.log("saved " + outFile + " (" + m.result.data.length + " b64 chars)");
  ws.close();
  process.exit(0);
});
ws.on("error", (e) => { console.error("WS-ERR " + e.message); process.exit(1); });
