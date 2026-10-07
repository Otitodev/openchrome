// Background SW: owns ALL chrome.* APIs. Offscreen owns only the WebSocket and relays here.
import { handleCommand } from "./commands.js";

async function ensureOffscreen(): Promise<void> {
  try {
    const has = await (chrome.offscreen as any).hasDocument?.();
    if (has) return;
  } catch {}
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      // NOTE: WEB_SOCKET is not a valid OffscreenReason in stable Chrome; BLOBS covers network/websocket use.
      reasons: ["BLOBS" as any],
      justification: "Persistent WebSocket to local OpenChrome daemon (MV3 SW cannot hold sockets).",
    });
  } catch (e: any) {
    if (!String(e?.message ?? e).includes("single offscreen")) throw e;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("oc-heartbeat", { periodInMinutes: 0.083 });
  void ensureOffscreen();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureOffscreen();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "oc-heartbeat") {
    void ensureOffscreen();
  }
});

// Offscreen relays daemon commands here; SW executes with full chrome.* access.
chrome.runtime.onMessage.addListener((m: any, _sender: any, sendResponse: (r: any) => void) => {
  if (m?.type === "oc-get-token") {
    void chrome.storage.local.get("ocToken").then((s: any) => sendResponse({ token: s.ocToken ?? null }));
    return true; // async response
  }
  if (m?.type === "oc-cmd" && m.msg?.type === "command") {
    void handleCommand(m.msg).then(sendResponse);
    return true; // async response
  }
  if (m?.type === "oc-ping") {
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
