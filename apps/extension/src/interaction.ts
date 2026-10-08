// Interaction pipeline: resolve ref -> scrollIntoView -> getBoxModel -> Input.dispatch*.
// AX is discovery only; CDP DOM+Input does the work. Retry once after fresh snapshot.
import { attach } from "./debugger.js";
import { assertWritable } from "./tabs.js";
import { resolveRef, snapshotTab } from "./snapshot.js";
import { actionKeyFor, requireApproval, sensitiveRefReason } from "./approvals.js";

function sendCmd(tabId: number, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result: any) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

async function backendCenter(tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
  await sendCmd(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
  const box = await sendCmd(tabId, "DOM.getBoxModel", { backendNodeId });
  const quad: number[] = box?.model?.content ?? box?.model?.border;
  if (!quad || quad.length < 8) {
    const err: any = new Error("element has no visible box (hidden or detached). Request a new snapshot.");
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

function requireBackend(tabId: number, ref: string): number | null {
  const el = resolveRef(tabId, ref);
  return typeof el.backendNodeId === "number" ? el.backendNodeId : null;
}

function refName(tabId: number, ref: string): string {
  try {
    return resolveRef(tabId, ref).name ?? "";
  } catch {
    return "";
  }
}

// Fallback when AX omits backendDOMNodeIds (common for links/static text):
// find a clickable element by accessible name/text in-page and click it.
async function fallbackClickByName(tabId: number, name: string): Promise<void> {
  await sendCmd(tabId, "Runtime.enable").catch(() => {});
  const expr = `(function(){const n=${JSON.stringify(name.toLowerCase())};const els=[...document.querySelectorAll('a,button,[role=button],[role=link],input[type=submit]')];const el=els.find(e=>((e.innerText||e.value||e.getAttribute('aria-label')||'').toLowerCase().includes(n)));if(!el)return 'NOTFOUND';el.scrollIntoView({block:'center'});el.click();return 'OK';})()`;
  const res = await sendCmd(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
  if (res?.result?.value !== "OK") {
    const err: any = new Error(`element not clickable by name ${JSON.stringify(name)}. Request a new snapshot.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
}

// Fallback for typing when no DOM link: find input by name/placeholder/label text.
async function fallbackTypeByName(tabId: number, name: string, text: string): Promise<void> {
  await sendCmd(tabId, "Runtime.enable").catch(() => {});
  const expr = `(function(){const n=${JSON.stringify(name.toLowerCase())};const els=[...document.querySelectorAll('input,textarea,[contenteditable=true]')];const el=els.find(e=>(((e.placeholder||e.name||e.getAttribute('aria-label')||'')+' '+(document.querySelector('label[for=\"'+e.id+'\"]')?.innerText||'')).toLowerCase().includes(n))||(!n&&e);if(!el)return 'NOTFOUND';el.scrollIntoView({block:'center'});el.focus();document.execCommand('selectAll',false,null);document.execCommand('insertText',false,${JSON.stringify(text)});return 'OK';})()`;
  const res = await sendCmd(tabId, "Runtime.evaluate", { expression: expr, returnByValue: true });
  if (res?.result?.value !== "OK") {
    const err: any = new Error(`element not typable by name ${JSON.stringify(name)}. Request a new snapshot.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
}

export async function clickRef(tabId: number, ref: string): Promise<{ tabId: number; ref: string; clicked: true }> {
  await assertWritable("element.click", tabId, ref);
  await attach(tabId);
  const run = async (): Promise<void> => {
    const backendNodeId = requireBackend(tabId, ref);
    if (backendNodeId === null) {
      await fallbackClickByName(tabId, refName(tabId, ref));
      return;
    }
    const { x, y } = await backendCenter(tabId, backendNodeId);
    const base = { x: Math.round(x), y: Math.round(y), button: "left" as const, clickCount: 1 };
    await sendCmd(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await sendCmd(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  };
  try {
    await run();
  } catch (e: any) {
    if (e.code !== "ELEMENT_NOT_FOUND") throw e;
    await snapshotTab(tabId); // refresh once
    await run(); // throw if still failing
  }
  return { tabId, ref, clicked: true };
}

export async function typeRef(tabId: number, ref: string, text: string): Promise<{ tabId: number; ref: string; typed: number }> {
  await assertWritable("element.type", tabId, ref);
  // Sensitive element names (pay/password/send) need explicit approval even on localhost.
  try {
    const el = resolveRef(tabId, ref);
    const reason = sensitiveRefReason(el.name);
    if (reason) await requireApproval(actionKeyFor("element.type", tabId, ref), reason);
  } catch (e: any) {
    if (e.code === "NEEDS_APPROVAL") throw e; // propagate; ELEMENT_NOT_FOUND falls through to run()+retry
  }
  await attach(tabId);
  if (typeof text !== "string" || text.length === 0) {
    throw Object.assign(new Error("text required"), { code: "NAVIGATION_FAILED" });
  }
  if (text.length > 5000) {
    throw Object.assign(new Error("text too long (max 5000 chars)"), { code: "NAVIGATION_FAILED" });
  }
  const run = async (): Promise<void> => {
    const backendNodeId = requireBackend(tabId, ref);
    if (backendNodeId === null) {
      await fallbackTypeByName(tabId, refName(tabId, ref), text);
      return;
    }
    await sendCmd(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
    await sendCmd(tabId, "DOM.focus", { backendNodeId }).catch(async () => {
      // fallback: click to focus then type
      const { x, y } = await backendCenter(tabId, backendNodeId);
      await sendCmd(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
      await sendCmd(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
    });
    // select-all + insert for deterministic replace on textboxes; plain insert otherwise
    await sendCmd(tabId, "Input.insertText", { text });
  };
  try {
    await run();
  } catch (e: any) {
    if (e.code !== "ELEMENT_NOT_FOUND") throw e;
    await snapshotTab(tabId);
    await run();
  }
  return { tabId, ref, typed: text.length };
}

const KEY_MAP: Record<string, { windowsVirtualKeyCode: number; key: string; code: string }> = {
  Enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter" },
  Tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
  Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  Backspace: { windowsVirtualKeyCode: 8, key: "Backspace", code: "Backspace" },
  Delete: { windowsVirtualKeyCode: 46, key: "Delete", code: "Delete" },
  ArrowLeft: { windowsVirtualKeyCode: 37, key: "ArrowLeft", code: "ArrowLeft" },
  ArrowRight: { windowsVirtualKeyCode: 39, key: "ArrowRight", code: "ArrowRight" },
  ArrowUp: { windowsVirtualKeyCode: 38, key: "ArrowUp", code: "ArrowUp" },
  ArrowDown: { windowsVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown" },
};

export async function pressKey(tabId: number, key: string, ref?: string): Promise<{ tabId: number; key: string }> {
  await assertWritable("input.press", tabId, ref);
  await attach(tabId);
  if (ref) {
    const backendNodeId = requireBackend(tabId, ref);
    await sendCmd(tabId, "DOM.focus", { backendNodeId }).catch(() => {});
  }
  const mapped = KEY_MAP[key] ?? { windowsVirtualKeyCode: 0, key, code: key };
  for (const type of ["rawKeyDown", "keyUp"] as const) {
    await sendCmd(tabId, "Input.dispatchKeyEvent", { type, ...mapped });
  }
  return { tabId, key };
}
