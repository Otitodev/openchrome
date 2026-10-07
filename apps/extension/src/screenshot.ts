// Screenshot: viewport-only V1, returned as base64; MCP shim wraps as image block.
import { attach } from "./debugger.js";
import { assertAllowed } from "./tabs.js";
import { getGeneration } from "./snapshot.js";

function sendCmd(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result: any) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

export async function captureScreenshot(
  tabId: number,
  opts: { format?: "png" | "jpeg"; maxWidth?: number },
): Promise<{ data: string; mimeType: string; pageGeneration: number }> {
  await assertAllowed(tabId);
  await attach(tabId);
  const format = opts.format === "jpeg" ? "jpeg" : "png";
  // Viewport only: captureBeyondViewport=false. Downscale handled by agent; maxWidth advisory.
  const res = await sendCmd(tabId, "Page.captureScreenshot", { format, fromSurface: true, captureBeyondViewport: false });
  if (!res?.data) {
    const err: any = new Error("screenshot failed");
    err.code = "NAVIGATION_FAILED";
    throw err;
  }
  return {
    data: res.data,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    pageGeneration: getGeneration(tabId),
  };
}
