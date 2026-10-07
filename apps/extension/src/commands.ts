// Runs in the service worker (has chrome.tabs/debugger). Offscreen relays WS commands here.
import { listAllowedTabs, selectTab, openUrl, goBack, goForward, reloadTab } from "./tabs.js";
import { attach } from "./debugger.js";
import { snapshotTab, bumpGeneration } from "./snapshot.js";
import { clickRef, typeRef, pressKey } from "./interaction.js";
import { getConsole } from "./console.js";
import { getNetwork } from "./network.js";
import { captureScreenshot } from "./screenshot.js";

export async function handleCommand(msg: any): Promise<{ id: string; type: "response"; success: boolean; result?: unknown; error?: { code: string; message: string } }> {
  const { id, method, params } = msg;
  try {
    let result: unknown;
    switch (method) {
      case "tabs.list": result = await listAllowedTabs(); break;
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
      case "tabs.back": result = await goBack(params.tabId); break;
      case "tabs.forward": result = await goForward(params.tabId); break;
      case "tabs.reload": result = await reloadTab(params.tabId); bumpGeneration(params.tabId); break;
      case "page.snapshot": {
        if (typeof params?.tabId !== "number") throw Object.assign(new Error("tabId required"), { code: "TAB_NOT_FOUND" });
        result = await snapshotTab(params.tabId);
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
        throw Object.assign(new Error(`unsupported method: ${method}`), { code: "NAVIGATION_FAILED" });
    }
    return { id, type: "response", success: true, result };
  } catch (e: any) {
    return { id, type: "response", success: false, error: { code: e.code ?? "TAB_NOT_FOUND", message: String(e.message ?? e) } };
  }
}
