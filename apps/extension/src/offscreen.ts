// Offscreen Document owns the persistent WebSocket to the daemon.
// Service worker cannot hold sockets (suspends after ~30s).
import { listAllowedTabs, selectTab, openUrl, goBack, goForward, reloadTab } from "./tabs.js";
import { attach } from "./debugger.js";
import { snapshotTab, bumpGeneration } from "./snapshot.js";
import { clickRef, typeRef, pressKey } from "./interaction.js";
import { getConsole } from "./console.js";
import { getNetwork } from "./network.js";
import { captureScreenshot } from "./screenshot.js";

const PORT = Number((globalThis as any).OPENCHROME_PORT ?? 18721);
let ws: WebSocket | null = null;
let backoff = 250;

function send(obj: unknown): void {
  ws?.send(JSON.stringify(obj));
}

async function handleCommand(msg: any): Promise<void> {
  const { id, method, params } = msg;
  try {
    let result: unknown;
    switch (method) {
      case "tabs.list": {
        result = await listAllowedTabs();
        break;
      }
      case "tabs.select": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        await attach(params.tabId);
        result = await selectTab(params.tabId);
        break;
      }
      case "tabs.open": {
        if (typeof params?.url !== "string") throw Object.assign(new Error("url required"), { code: "NAVIGATION_FAILED" });
        result = await openUrl(params.url, !!params.newTab, params.tabId);
        break;
      }
      case "tabs.back": {
        result = await goBack(params.tabId);
        break;
      }
      case "tabs.forward": {
        result = await goForward(params.tabId);
        break;
      }
      case "tabs.reload": {
        result = await reloadTab(params.tabId);
        bumpGeneration(params.tabId);
        break;
      }
      case "page.snapshot": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        const snap = await snapshotTab(params.tabId);
        result = snap;
        break;
      }
      case "element.click": {
        if (typeof params?.tabId !== "number" || typeof params?.ref !== "string") throw Object.assign(new Error("tabId + ref required"), { code: "ELEMENT_NOT_FOUND" });
        result = await clickRef(params.tabId, params.ref);
        break;
      }
      case "element.type": {
        if (typeof params?.tabId !== "number" || typeof params?.ref !== "string") throw Object.assign(new Error("tabId + ref required"), { code: "ELEMENT_NOT_FOUND" });
        result = await typeRef(params.tabId, params.ref, String(params.text ?? ""));
        break;
      }
      case "input.press": {
        if (typeof params?.tabId !== "number" || typeof params?.key !== "string") throw Object.assign(new Error("tabId + key required"), { code: "TAB_NOT_FOUND" });
        result = await pressKey(params.tabId, params.key, typeof params.ref === "string" ? params.ref : undefined);
        break;
      }
      case "console.get": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        result = await getConsole(params.tabId, { level: params.level, sinceSeq: params.sinceSeq, limit: params.limit });
        break;
      }
      case "network.get": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        result = await getNetwork(params.tabId, { sinceSeq: params.sinceSeq, limit: params.limit, failedOnly: params.failedOnly });
        break;
      }
      case "page.screenshot": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        result = await captureScreenshot(params.tabId, { format: params.format, maxWidth: params.maxWidth });
        break;
      }
      case "status.get": {
        const tabs = await listAllowedTabs().catch(() => ({ tabs: [], activeTab: undefined }));
        result = { extension: true, ...tabs };
        break;
      }
      default:
        throw Object.assign(new Error(`unsupported in V1 tab-control: ${method}`), { code: "NAVIGATION_FAILED" });
    }
    send({ id, type: "response", success: true, result });
  } catch (e: any) {
    send({ id, type: "response", success: false, error: { code: e.code ?? "TAB_NOT_FOUND", message: String(e.message ?? e) } });
  }
}

async function connect(): Promise<void> {
  const { ocToken } = await chrome.storage.local.get("ocToken");
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
      if (msg.type === "command") void handleCommand(msg);
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

// heartbeat from SW alarms keeps offscreen alive
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "oc-ping" && (!ws || (ws as any).readyState !== 1)) void connect();
});

void connect();
