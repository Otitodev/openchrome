// Offscreen Document: owns ONLY the WebSocket. No chrome.tabs/debugger/storage here
// (unavailable in offscreen context). Token comes from the SW via messaging.
const PORT = Number((globalThis as any).OPENCHROME_PORT ?? 18721);
let ws: WebSocket | null = null;
let backoff = 250;
let cachedToken: string | null = null;

function send(obj: unknown): void {
  ws?.send(JSON.stringify(obj));
}

async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  try {
    const res = await chrome.runtime.sendMessage({ type: "oc-get-token" });
    if (res?.token) cachedToken = res.token;
    return cachedToken;
  } catch {
    return null;
  }
}

async function onDaemonCommand(msg: any): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ type: "oc-cmd", msg });
    send(res);
  } catch (e: any) {
    send({ id: msg.id, type: "response", success: false, error: { code: "CHROME_NOT_CONNECTED", message: String(e?.message ?? e) } });
  }
}

async function connect(): Promise<void> {
  const ocToken = await getToken();
  if (!ocToken) {
    setTimeout(connect, 2000);
    return;
  }
  ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
  (ws as any).onopen = () => {
    backoff = 250;
    send({ id: crypto.randomUUID(), type: "register", token: ocToken, role: "extension" });
  };
  (ws as any).onmessage = (ev: MessageEvent) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "command") void onDaemonCommand(msg);
    } catch {}
  };
  (ws as any).onclose = () => {
    ws = null;
    backoff = Math.min(backoff * 2, 5000);
    setTimeout(connect, backoff);
  };
  (ws as any).onerror = () => {
    try { ws?.close(); } catch {}
  };
}

void connect();
