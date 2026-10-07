// Background SW: relays between popup and Offscreen WS client. No sockets here.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("oc-heartbeat", { periodInMinutes: 0.083 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "oc-heartbeat") chrome.runtime.sendMessage({ type: "oc-ping" }).catch(() => {});
});
