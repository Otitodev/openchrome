// apps/extension/src/offscreen.ts
var PORT = Number(globalThis.OPENCHROME_PORT ?? 18721);
var ws = null;
var backoff = 250;
var cachedToken = null;
function send(obj) {
  ws?.send(JSON.stringify(obj));
}
async function getToken() {
  if (cachedToken) return cachedToken;
  try {
    const res = await chrome.runtime.sendMessage({ type: "oc-get-token" });
    if (res?.token) cachedToken = res.token;
    return cachedToken;
  } catch {
    return null;
  }
}
async function onDaemonCommand(msg) {
  try {
    const res = await chrome.runtime.sendMessage({ type: "oc-cmd", msg });
    send(res);
  } catch (e) {
    send({ id: msg.id, type: "response", success: false, error: { code: "CHROME_NOT_CONNECTED", message: String(e?.message ?? e) } });
  }
}
async function connect() {
  const ocToken = await getToken();
  if (!ocToken) {
    setTimeout(connect, 2e3);
    return;
  }
  ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  ws.onopen = () => {
    backoff = 250;
    send({ id: crypto.randomUUID(), type: "register", token: ocToken, role: "extension" });
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "command") void onDaemonCommand(msg);
    } catch {
    }
  };
  ws.onclose = () => {
    ws = null;
    backoff = Math.min(backoff * 2, 5e3);
    setTimeout(connect, backoff);
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
    }
  };
}
void connect();
