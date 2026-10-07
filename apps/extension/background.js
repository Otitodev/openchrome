// apps/extension/src/background.ts
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WEB_SOCKET"],
    justification: "Persistent WebSocket to local OpenChrome daemon (MV3 SW cannot hold sockets)."
  });
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
