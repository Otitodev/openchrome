// apps/extension/src/permissions.ts
var DEFAULTS = [
  { pattern: "localhost", policy: "allow" },
  { pattern: "127.0.0.1", policy: "allow" }
];
function matches(url, pattern) {
  try {
    const host = new URL(url).hostname;
    if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
    return host === pattern || host.includes(pattern);
  } catch {
    return url.includes(pattern);
  }
}
function resolvePolicy(url, rules) {
  for (const r of rules) {
    if (matches(url, r.pattern)) return r.policy;
  }
  for (const r of DEFAULTS) {
    if (matches(url, r.pattern)) return r.policy;
  }
  return "ask";
}
async function loadRules() {
  const { ocRules } = await chrome.storage.local.get("ocRules");
  return ocRules ?? [];
}

// apps/extension/src/approvals.ts
var GRANT_MS = 5 * 60 * 1e3;
function key(method, tabId, ref, url) {
  return [method, tabId ?? "", ref ?? "", url ?? ""].join("|");
}
async function getStore() {
  const s = await chrome.storage.local.get(["ocGrants", "ocPending"]);
  return { grants: s.ocGrants ?? {}, pending: s.ocPending ?? {} };
}
async function isGranted(actionKey) {
  const { grants } = await getStore();
  return (grants[actionKey] ?? 0) > Date.now();
}
function actionKeyFor(method, tabId, ref, url) {
  return key(method, tabId, ref, url);
}
async function requireApproval(actionKey, reason) {
  if (await isGranted(actionKey)) return;
  const { grants, pending } = await getStore();
  pending[actionKey] = { reason, createdAt: Date.now() };
  await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
  const err = new Error(`needs approval: ${reason} (actionKey=${actionKey}). Ask user to Approve in popup, then retry.`);
  err.code = "NEEDS_APPROVAL";
  err.actionKey = actionKey;
  throw err;
}
var SENSITIVE_REF = /pay|checkout|delete|password|send|publish|subscribe/i;
function sensitiveRefReason(refName) {
  if (refName && SENSITIVE_REF.test(refName)) return `sensitive element "${refName}"`;
  return null;
}

// apps/extension/src/tabs.ts
async function tabPolicy(tabId) {
  const rules = await loadRules();
  const tab = await chrome.tabs.get(tabId).catch(() => {
    throw Object.assign(new Error(`tab ${tabId} not found`), { code: "TAB_NOT_FOUND" });
  });
  const url = tab.url ?? "";
  return { url, policy: resolvePolicy(url, rules) };
}
async function listAllowedTabs() {
  const rules = await loadRules();
  const tabs = await chrome.tabs.query({});
  const out = [];
  let activeTab;
  for (const t of tabs) {
    if (t.id === void 0 || !t.url) continue;
    const policy = resolvePolicy(t.url, rules);
    if (policy === "deny") continue;
    out.push({ id: t.id, title: t.title ?? "", url: t.url, active: !!t.active, policy });
    if (t.active) activeTab = t.id;
  }
  return { tabs: out, activeTab };
}
async function assertVisible(tabId) {
  const { policy } = await tabPolicy(tabId);
  if (policy === "deny") {
    const err = new Error(`tab ${tabId} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
}
async function assertWritable(method, tabId, refOrUrl) {
  const { url, policy } = await tabPolicy(tabId).catch(() => ({ url: "", policy: "deny" }));
  if (policy === "deny") {
    const err = new Error(`tab ${tabId} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
  if (policy === "ask") {
    await requireApproval(actionKeyFor(method, tabId, refOrUrl, url), `tab ${tabId} (${url}) requires approval`);
  }
}
var assertAllowed = assertVisible;
async function selectTab(tabId) {
  await assertWritable("tabs.select", tabId);
  await chrome.tabs.update(tabId, { active: true });
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== void 0) await chrome.windows.update(tab.windowId, { focused: true });
  return { tabId, activeTab: tabId };
}
async function openUrl(url, newTab, tabId) {
  const rules = await loadRules();
  const policy = resolvePolicy(url, rules);
  if (policy === "deny") {
    const err = new Error(`navigation to ${url} not allowed`);
    err.code = "TAB_NOT_ALLOWED";
    throw err;
  }
  if (policy === "ask") {
    await requireApproval(actionKeyFor("tabs.open", tabId, void 0, url), `navigation to ${url} requires approval`);
  }
  if (newTab || tabId === void 0) {
    const t = await chrome.tabs.create({ url, active: true });
    return { tabId: t.id };
  }
  await chrome.tabs.update(tabId, { url });
  return { tabId };
}
async function goBack(tabId) {
  await assertWritable("tabs.back", tabId);
  await chrome.tabs.goBack(tabId);
  return { tabId };
}
async function goForward(tabId) {
  await assertWritable("tabs.forward", tabId);
  await chrome.tabs.goForward(tabId);
  return { tabId };
}
async function reloadTab(tabId) {
  await assertWritable("tabs.reload", tabId);
  await chrome.tabs.reload(tabId);
  return { tabId };
}

// apps/extension/src/debugger.ts
var attached = /* @__PURE__ */ new Set();
var idleTimers = /* @__PURE__ */ new Map();
var IDLE_MS = 6e4;
function clearIdle(tabId) {
  const t = idleTimers.get(tabId);
  if (t !== void 0) {
    clearTimeout(t);
    idleTimers.delete(tabId);
  }
}
function armIdle(tabId) {
  clearIdle(tabId);
  const t = setTimeout(() => detach(tabId).catch(() => {
  }), IDLE_MS);
  idleTimers.set(tabId, t);
}
async function attach(tabId) {
  if (attached.has(tabId)) {
    armIdle(tabId);
    return;
  }
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
    armIdle(tabId);
  } catch (e) {
    const err = new Error(`debugger attach failed for tab ${tabId}. Close DevTools and retry.`);
    err.code = "DEBUGGER_ATTACH_FAILED";
    throw err;
  }
}
async function detach(tabId) {
  clearIdle(tabId);
  if (!attached.has(tabId)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
  attached.delete(tabId);
}
chrome.tabs.onRemoved.addListener((tabId) => {
  detach(tabId).catch(() => {
  });
});
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== void 0) {
    attached.delete(source.tabId);
    clearIdle(source.tabId);
  }
});

// packages/browser-model/src/elements.ts
function truncateName(name, max = 80) {
  return name.length > max ? name.slice(0, max - 1) + "\u2026" : name;
}

// packages/shared/src/types.ts
var SNAPSHOT_MAX_NODES = 500;
var SNAPSHOT_NAME_TRUNCATE = 80;

// packages/browser-model/src/snapshot.ts
var INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "switch",
  "slider",
  "searchbox"
]);
var HEADING_ROLES = /* @__PURE__ */ new Set(["heading", "h1", "h2", "h3", "h4", "h5", "h6"]);
function roleOf(n) {
  return String(n.role?.value ?? "generic").toLowerCase();
}
function buildSnapshot(nodes, opts) {
  const lines = [`URL: ${opts.url}`, ``, `Title: ${opts.title}`, ``];
  const refs = [];
  let counter = 0;
  let truncated = false;
  for (const n of nodes) {
    if (counter >= SNAPSHOT_MAX_NODES) {
      truncated = true;
      break;
    }
    if (n.hidden) continue;
    const role = roleOf(n);
    const rawName = String(n.name?.value ?? "").trim();
    if (!rawName && !INTERACTIVE_ROLES.has(role) && !HEADING_ROLES.has(role)) continue;
    if (role === "generic" || role === "none" || role === "presentation") continue;
    counter++;
    const ref = `e${counter}`;
    const frameId = n.frameId && n.frameId !== "main" ? n.frameId : void 0;
    const frameSuffix = frameId ? ` in ${opts.frameLabels?.get(frameId) ?? frameId}` : "";
    const name = truncateName(rawName || role, SNAPSHOT_NAME_TRUNCATE);
    lines.push(`[${ref}${frameSuffix}] ${role} "${name}"`);
    refs.push({
      ref,
      backendNodeId: n.backendDOMNodeIds?.[0],
      role,
      name,
      frameId,
      pageGeneration: opts.pageGeneration,
      createdAt: Date.now()
    });
  }
  if (truncated) lines.push(`... truncated to ${SNAPSHOT_MAX_NODES} nodes`);
  return { text: lines.join("\n"), refs, pageGeneration: opts.pageGeneration, truncated };
}
function lookupRef(refs, ref, pageGeneration) {
  const found = refs.find((r) => r.ref === ref);
  if (!found) {
    const err = new Error(`element ${ref} not found. Request a new snapshot.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  if (found.pageGeneration !== pageGeneration) {
    const err = new Error(`stale ${ref}. The page changed. Request a new snapshot.`);
    err.code = "STALE_ELEMENT_REFERENCE";
    throw err;
  }
  return found;
}

// apps/extension/src/snapshot.ts
var tabState = /* @__PURE__ */ new Map();
function getGeneration(tabId) {
  return tabState.get(tabId)?.generation ?? 0;
}
function bumpGeneration(tabId) {
  const g = getGeneration(tabId) + 1;
  tabState.set(tabId, { generation: g, refs: [] });
  return g;
}
function resolveRef(tabId, ref) {
  const st = tabState.get(tabId);
  if (!st) {
    const err = new Error(`no snapshot for tab ${tabId}. Request browser_snapshot first.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  return lookupRef(st.refs, ref, st.generation);
}
function sendCmd(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
async function snapshotTab(tabId) {
  await assertAllowed(tabId);
  await attach(tabId);
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  const title = tab.title ?? "";
  await sendCmd(tabId, "Accessibility.enable").catch(() => {
  });
  await sendCmd(tabId, "DOM.enable").catch(() => {
  });
  const ax = await sendCmd(tabId, "Accessibility.getFullAXTree", { depth: 50 }).catch((e) => {
    const err = new Error(`snapshot failed: ${e.message}`);
    err.code = "NAVIGATION_FAILED";
    throw err;
  });
  const nodes = (ax?.nodes ?? []).map((n) => ({
    nodeId: String(n.nodeId),
    role: n.role,
    name: n.name,
    backendDOMNodeIds: n.backendDOMNodeIds,
    frameId: n.frameId,
    hidden: n.hidden,
    disabled: n.disabled
  }));
  const generation = getGeneration(tabId);
  const { text, refs, truncated } = buildSnapshot(nodes, { url, title, pageGeneration: generation });
  tabState.set(tabId, { generation, refs });
  return { text, pageGeneration: generation, truncated };
}
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId === 0 && typeof details.tabId === "number") bumpGeneration(details.tabId);
});

// apps/extension/src/interaction.ts
function sendCmd2(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
async function backendCenter(tabId, backendNodeId) {
  await sendCmd2(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {
  });
  const box = await sendCmd2(tabId, "DOM.getBoxModel", { backendNodeId });
  const quad = box?.model?.content ?? box?.model?.border;
  if (!quad || quad.length < 8) {
    const err = new Error("element has no visible box (hidden or detached). Request a new snapshot.");
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
function requireBackend(tabId, ref) {
  const el = resolveRef(tabId, ref);
  if (typeof el.backendNodeId !== "number") {
    const err = new Error(`element ${ref} has no DOM link. Request a new snapshot.`);
    err.code = "ELEMENT_NOT_FOUND";
    throw err;
  }
  return el.backendNodeId;
}
async function clickRef(tabId, ref) {
  await assertWritable("element.click", tabId, ref);
  await attach(tabId);
  const run = async () => {
    const backendNodeId = requireBackend(tabId, ref);
    const { x, y } = await backendCenter(tabId, backendNodeId);
    const base = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 };
    await sendCmd2(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await sendCmd2(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
  };
  try {
    await run();
  } catch (e) {
    if (e.code !== "ELEMENT_NOT_FOUND") throw e;
    await snapshotTab(tabId);
    await run();
  }
  return { tabId, ref, clicked: true };
}
async function typeRef(tabId, ref, text) {
  await assertWritable("element.type", tabId, ref);
  try {
    const el = resolveRef(tabId, ref);
    const reason = sensitiveRefReason(el.name);
    if (reason) await requireApproval(actionKeyFor("element.type", tabId, ref), reason);
  } catch (e) {
    if (e.code === "NEEDS_APPROVAL") throw e;
  }
  await attach(tabId);
  if (typeof text !== "string" || text.length === 0) {
    throw Object.assign(new Error("text required"), { code: "NAVIGATION_FAILED" });
  }
  if (text.length > 5e3) {
    throw Object.assign(new Error("text too long (max 5000 chars)"), { code: "NAVIGATION_FAILED" });
  }
  const run = async () => {
    const backendNodeId = requireBackend(tabId, ref);
    await sendCmd2(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {
    });
    await sendCmd2(tabId, "DOM.focus", { backendNodeId }).catch(async () => {
      const { x, y } = await backendCenter(tabId, backendNodeId);
      await sendCmd2(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
      await sendCmd2(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 });
    });
    await sendCmd2(tabId, "Input.insertText", { text });
  };
  try {
    await run();
  } catch (e) {
    if (e.code !== "ELEMENT_NOT_FOUND") throw e;
    await snapshotTab(tabId);
    await run();
  }
  return { tabId, ref, typed: text.length };
}
var KEY_MAP = {
  Enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter" },
  Tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
  Escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  Backspace: { windowsVirtualKeyCode: 8, key: "Backspace", code: "Backspace" },
  Delete: { windowsVirtualKeyCode: 46, key: "Delete", code: "Delete" },
  ArrowLeft: { windowsVirtualKeyCode: 37, key: "ArrowLeft", code: "ArrowLeft" },
  ArrowRight: { windowsVirtualKeyCode: 39, key: "ArrowRight", code: "ArrowRight" },
  ArrowUp: { windowsVirtualKeyCode: 38, key: "ArrowUp", code: "ArrowUp" },
  ArrowDown: { windowsVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown" }
};
async function pressKey(tabId, key2, ref) {
  await assertWritable("input.press", tabId, ref);
  await attach(tabId);
  if (ref) {
    const backendNodeId = requireBackend(tabId, ref);
    await sendCmd2(tabId, "DOM.focus", { backendNodeId }).catch(() => {
    });
  }
  const mapped = KEY_MAP[key2] ?? { windowsVirtualKeyCode: 0, key: key2, code: key2 };
  for (const type of ["rawKeyDown", "keyUp"]) {
    await sendCmd2(tabId, "Input.dispatchKeyEvent", { type, ...mapped });
  }
  return { tabId, key: key2 };
}

// apps/extension/src/redact.ts
var SECRET_QUERY = /([?&](token|code|api_key|apikey|secret|password|access_token|auth)=)[^&#]*/gi;
function redactUrl(url) {
  return url.replace(SECRET_QUERY, "$1[REDACTED]");
}
function redactMessage(msg) {
  return msg.replace(/(password\s*[:=]\s*)\S+/gi, "$1[REDACTED]").replace(/(authorization\s*[:=]\s*)(bearer\s+)?\S+/gi, "$1[REDACTED]");
}
function truncate(msg, max = 1e3) {
  return msg.length > max ? msg.slice(0, max - 1) + "\u2026" : msg;
}

// apps/extension/src/console.ts
var buffers = /* @__PURE__ */ new Map();
var seqByTab = /* @__PURE__ */ new Map();
var enabled = /* @__PURE__ */ new Set();
var MAX = 500;
function push(tabId, level, message, source) {
  const seq = (seqByTab.get(tabId) ?? 0) + 1;
  seqByTab.set(tabId, seq);
  const buf = buffers.get(tabId) ?? [];
  buf.push({ seq, level, message: truncate(redactMessage(message)), timestamp: Date.now(), source });
  while (buf.length > MAX) buf.shift();
  buffers.set(tabId, buf);
}
function sendCmd3(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
async function ensureConsole(tabId) {
  if (enabled.has(tabId)) return;
  await attach(tabId);
  await sendCmd3(tabId, "Runtime.enable").catch(() => {
  });
  await sendCmd3(tabId, "Log.enable").catch(() => {
  });
  enabled.add(tabId);
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === void 0) return;
  if (method === "Runtime.consoleAPICalled") {
    const level = params?.type === "warning" ? "warn" : params?.type === "error" ? "error" : "log";
    const text = (params?.args ?? []).map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    push(tabId, level, text || "(console call)", "console");
  } else if (method === "Runtime.exceptionThrown") {
    push(tabId, "error", params?.exceptionDetails?.text ?? params?.exceptionDetails?.exception?.description ?? "uncaught exception", "exception");
  } else if (method === "Log.entryAdded") {
    const e = params?.entry;
    push(tabId, e?.level === "warning" ? "warn" : e?.level === "error" ? "error" : "log", `${e?.text ?? ""} (${e?.url ?? ""})`, e?.source);
  }
});
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== void 0) enabled.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers.delete(tabId);
  seqByTab.delete(tabId);
  enabled.delete(tabId);
});
async function getConsole(tabId, opts) {
  await assertAllowed(tabId);
  await ensureConsole(tabId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const since = opts.sinceSeq ?? 0;
  const buf = buffers.get(tabId) ?? [];
  let out = buf.filter((e) => e.seq > since);
  if (opts.level) out = out.filter((e) => e.level === opts.level);
  out = out.slice(-limit);
  return { entries: out, nextSeq: seqByTab.get(tabId) ?? 0 };
}

// apps/extension/src/network.ts
var buffers2 = /* @__PURE__ */ new Map();
var byRequest = /* @__PURE__ */ new Map();
var seqByTab2 = /* @__PURE__ */ new Map();
var enabled2 = /* @__PURE__ */ new Set();
var MAX2 = 500;
function nextSeq(tabId) {
  const s = (seqByTab2.get(tabId) ?? 0) + 1;
  seqByTab2.set(tabId, s);
  return s;
}
function store(tabId, entry) {
  const buf = buffers2.get(tabId) ?? [];
  const idx = buf.findIndex((e) => e.requestId === entry.requestId);
  if (idx >= 0) buf[idx] = entry;
  else buf.push(entry);
  while (buf.length > MAX2) buf.shift();
  buffers2.set(tabId, buf);
}
function sendCmd4(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
async function ensureNetwork(tabId) {
  if (enabled2.has(tabId)) return;
  await attach(tabId);
  await sendCmd4(tabId, "Network.enable").catch(() => {
  });
  enabled2.add(tabId);
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === void 0) return;
  if (method === "Network.requestWillBeSent") {
    const map = byRequest.get(tabId) ?? /* @__PURE__ */ new Map();
    const entry = {
      seq: nextSeq(tabId),
      requestId: String(params?.requestId ?? ""),
      url: redactUrl(String(params?.request?.url ?? "")),
      method: String(params?.request?.method ?? ""),
      resourceType: params?.type,
      startedAt: Date.now()
    };
    map.set(entry.requestId, entry);
    byRequest.set(tabId, map);
    store(tabId, entry);
  } else if (method === "Network.responseReceived") {
    const map = byRequest.get(tabId);
    const prev = map?.get(String(params?.requestId));
    if (prev) {
      prev.status = params?.response?.status;
      prev.statusText = params?.response?.statusText;
      prev.mimeType = params?.response?.mimeType;
      store(tabId, prev);
    }
  } else if (method === "Network.loadingFailed") {
    const map = byRequest.get(tabId);
    const prev = map?.get(String(params?.requestId));
    if (prev) {
      prev.failed = true;
      prev.errorText = String(params?.errorText ?? "failed").slice(0, 300);
      store(tabId, prev);
    }
  }
});
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId !== void 0) enabled2.delete(source.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  buffers2.delete(tabId);
  byRequest.delete(tabId);
  seqByTab2.delete(tabId);
  enabled2.delete(tabId);
});
async function getNetwork(tabId, opts) {
  await assertAllowed(tabId);
  await ensureNetwork(tabId);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const since = opts.sinceSeq ?? 0;
  let out = (buffers2.get(tabId) ?? []).filter((e) => e.seq > since);
  if (opts.failedOnly) out = out.filter((e) => e.failed || e.status !== void 0 && e.status >= 400);
  out = out.slice(-limit);
  return { entries: out, nextSeq: seqByTab2.get(tabId) ?? 0 };
}

// apps/extension/src/screenshot.ts
function sendCmd5(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}
async function captureScreenshot(tabId, opts) {
  await assertAllowed(tabId);
  await attach(tabId);
  const format = opts.format === "jpeg" ? "jpeg" : "png";
  const res = await sendCmd5(tabId, "Page.captureScreenshot", { format, fromSurface: true, captureBeyondViewport: false });
  if (!res?.data) {
    const err = new Error("screenshot failed");
    err.code = "NAVIGATION_FAILED";
    throw err;
  }
  return {
    data: res.data,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    pageGeneration: getGeneration(tabId)
  };
}

// apps/extension/src/commands.ts
async function handleCommand(msg) {
  const { id, method, params } = msg;
  try {
    let result;
    switch (method) {
      case "tabs.list":
        result = await listAllowedTabs();
        break;
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
      case "tabs.back":
        result = await goBack(params.tabId);
        break;
      case "tabs.forward":
        result = await goForward(params.tabId);
        break;
      case "tabs.reload":
        result = await reloadTab(params.tabId);
        bumpGeneration(params.tabId);
        break;
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
        result = await pressKey(params.tabId, params.key, typeof params.ref === "string" ? params.ref : void 0);
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
        const tabs = await listAllowedTabs().catch(() => ({ tabs: [], activeTab: void 0 }));
        result = { extension: true, ...tabs };
        break;
      }
      default:
        throw Object.assign(new Error(`unsupported method: ${method}`), { code: "NAVIGATION_FAILED" });
    }
    return { id, type: "response", success: true, result };
  } catch (e) {
    return { id, type: "response", success: false, error: { code: e.code ?? "TAB_NOT_FOUND", message: String(e.message ?? e) } };
  }
}

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
  }
});
chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m?.type === "oc-get-token") {
    void chrome.storage.local.get("ocToken").then((s) => sendResponse({ token: s.ocToken ?? null }));
    return true;
  }
  if (m?.type === "oc-cmd" && m.msg?.type === "command") {
    void handleCommand(m.msg).then(sendResponse);
    return true;
  }
  if (m?.type === "oc-ping") {
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
