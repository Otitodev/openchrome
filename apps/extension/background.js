// apps/extension/src/background.ts
async function ensureOffscreen() {
  try {
    const has = await chrome.offscreen.hasDocument?.();
    if (has) return;
  } catch {
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      // NOTE: WEB_SOCKET is not a valid OffscreenReason in stable Chrome; BLOBS covers network/websocket use.
      reasons: ["BLOBS"],
      justification: "Persistent WebSocket to local OpenChrome daemon (MV3 SW cannot hold sockets)."
    });
  } catch (e) {
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
    chrome.runtime.sendMessage({ type: "oc-ping" }).catch(() => {
    });
  }
});
