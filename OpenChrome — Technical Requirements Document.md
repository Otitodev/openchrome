# OpenChrome — Technical Requirements Document

## 1. System Overview

OpenChrome consists of four logical components. The local daemon is long-lived and owns the WebSocket bridge. The MCP server is a thin stdio shim spawned by the agent that forwards to the daemon:

```text
┌───────────────────────────────┐
│        Coding Agent           │
│                               │
│ OpenCode / Codex / Claude     │
└───────────────┬───────────────┘
                │
                │ MCP (stdio)
                ▼
┌───────────────────────────────┐
│     OpenChrome MCP Shim       │
│        TypeScript/Node        │
│  thin forwarder, no WS host   │
└───────────────┬───────────────┘
                │
                │ Local WebSocket (daemon client)
                ▼
┌───────────────────────────────┐
│     OpenChrome Daemon         │
│   127.0.0.1 WS host + token   │
│   tab registry, permissions   │
└───────────────┬───────────────┘
                │
                │ Local WebSocket (extension client)
                ▼
┌───────────────────────────────┐
│     OpenChrome Extension      │
│                               │
│ Chrome Extension Manifest V3  │
│ + Offscreen Document for WS   │
└───────────────┬───────────────┘
                │
                │ Chrome APIs / CDP
                ▼
┌───────────────────────────────┐
│            Chrome             │
│                               │
│ Tabs / DOM / DevTools         │
└───────────────────────────────┘
```

Single-agent V1: daemon accepts one active agent session at a time and rejects additional MCP shim connections with `SESSION_BUSY`. Multi-agent tab groups are Phase 3.

---

# 2. Technology Stack

## Language

TypeScript.

Use TypeScript across both:

```text
MCP shim (stdio, spawned by agent)
local daemon (long-lived WebSocket host)
Chrome extension
shared protocol
```

This enables shared types between all components.

---

## Runtime

```text
Node.js 22+
```

---

## Package Manager

Recommended:

```text
pnpm
```

---

## Chrome Extension

```text
Manifest V3
```

---

## Protocol

### Agent → OpenChrome

```text
Model Context Protocol
```

Transport for initial implementation:

```text
stdio
```

---

### Server → Extension

Recommended:

```text
WebSocket
```

Bound only to:

```text
127.0.0.1
```

---

# 3. Repository Architecture

Recommended monorepo:

```text
openchrome/

  apps/

    extension/
      src/
        background/
        offscreen/      # Offscreen Document owns persistent WebSocket; SW relays via chrome.runtime ports
        debugger/
        browser/
        permissions/
        websocket/
        ui/

      manifest.json
      offscreen.html

    daemon/
      src/
        index.ts
        ws-server.ts
        token-store.ts
        tab-registry.ts
        permissions.ts

    mcp-server/
      src/
        index.ts
        server.ts
        tools/
        sessions/
        browser-client/

  packages/

    protocol/
      src/
        messages.ts
        commands.ts
        events.ts

    browser-model/
      src/
        snapshot.ts
        elements.ts

    shared/
      src/
        types.ts
        errors.ts
        constants.ts

  docs/

  examples/

  package.json
  pnpm-workspace.yaml
  tsconfig.json
```

---

# 4. Core Components

## 4.1 MCP Shim (stdio)

Thin process spawned by the agent. Responsible for:

- registering MCP tools
- validating input (including `tabId?` default = active tab, `timeoutMs?` default = 15000)
- forwarding commands to daemon over loopback WebSocket
- waiting for daemon/extension response with timeout
- mapping extension errors
- rejecting with `SESSION_BUSY` if daemon already has an active agent

It does NOT host the WebSocket server. That is the daemon's job, so the bridge survives agent restarts.

Example:

```text
browser_click({
    tabId: 23,
    ref: "e12"
})
```

becomes:

```json
{
  "type": "command",
  "id": "cmd_123",
  "method": "element.click",
  "params": {
    "tabId": 23,
    "ref": "e12"
  }
}
```

---

# 4.2 WebSocket Bridge (hosted by Daemon)

Daemon endpoint (default, configurable via `openchrome daemon --port` and `OPENCHROME_PORT`):

```text
ws://127.0.0.1:18721
```

Do NOT use 9223 (collides with Chrome remote-debugging). Port must be configurable from day one.

Responsibilities:

- extension registration
- connection health
- command routing
- request correlation
- reconnect handling
- agent-to-browser event propagation

---

# 4.3 Chrome Extension

The extension performs actual browser actions. WebSocket lives in the Offscreen Document, NOT the MV3 service worker (SW suspends after ~30s idle and cannot hold sockets reliably). SW relays via `chrome.runtime.connect` ports and uses `chrome.alarms` for heartbeat.

Primary modules:

```text
ConnectionManager
TabManager
DebuggerManager
SnapshotManager
InteractionManager
NetworkMonitor
ConsoleMonitor
PermissionManager
```

---

# 5. Chrome APIs

## Required APIs

```text
chrome.tabs
chrome.debugger
chrome.scripting
chrome.storage
chrome.runtime
```

Potentially:

```text
chrome.webNavigation
```

---

# 6. Extension Manifest

Initial conceptual manifest:

```json
{
  "manifest_version": 3,
  "name": "OpenChrome",
  "version": "0.1.0",

  "permissions": [
    "tabs",
    "activeTab",
    "debugger",
    "scripting",
    "storage",
    "alarms",
    "offscreen"
  ],

  "host_permissions": [
    "<all_urls>"
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "action": {
    "default_popup": "popup.html"
  }
}
```

The implementation should later minimize requested permissions where practical.

---

# 7. Chrome DevTools Protocol

OpenChrome should use:

```text
chrome.debugger.sendCommand()
```

to access Chrome DevTools Protocol domains.

---

# 8. Required CDP Domains

## Page

Used for:

```text
navigation
reload
screenshots
page lifecycle
```

Commands may include:

```text
Page.enable
Page.navigate
Page.reload
Page.captureScreenshot
```

---

## Runtime

Used for:

```text
JavaScript execution
runtime exceptions
object inspection
```

Potential commands:

```text
Runtime.enable
Runtime.evaluate
```

---

## DOM

Used for:

```text
DOM tree inspection
element lookup
node metadata
```

Potential commands:

```text
DOM.enable
DOM.getDocument
DOM.querySelector
DOM.describeNode
```

---

## Accessibility

Used for semantic page snapshots.

Potential command:

```text
Accessibility.getFullAXTree
```

This should be a major source for agent-readable page structure.

---

## Network

Used for:

```text
request monitoring
response monitoring
failed requests
status codes
```

Commands/events:

```text
Network.enable

Network.requestWillBeSent
Network.responseReceived
Network.loadingFailed
```

---

## Log / Runtime

Used for:

```text
console logs
JavaScript exceptions
browser errors
```

---

## Input

Can be used for lower-level mouse and keyboard interaction.

Potential commands:

```text
Input.dispatchMouseEvent
Input.dispatchKeyEvent
Input.insertText
```

---

# 9. Browser Snapshot Engine

This is one of the most important OpenChrome subsystems.

Goal:

Convert complex browser state into compact agent-readable output.

Input:

```text
Accessibility tree
DOM
page metadata
```

Budget (required to hit <500ms target):

```text
max 500 nodes per snapshot
truncate accessible names at 80 chars
skip hidden:true / disabled presentation nodes unless interactive
flatten iframes as [frame f2] prefix, e.g. [e12 in f2] button "Buy"
omit shadow-DOM internals unless host is interactive; expose host with has-children marker
include pageGeneration int; any nav/reload/cross-document bumps it
```

Output:

```text
URL: http://localhost:3000/signup

Title: Create Account

[e1] heading "Create Account"
[e2] textbox "Email"
[e3] textbox "Password"
[e4] checkbox "Remember me"
[e5] button "Create account"
[e6] link "Sign in"
```

---

# 10. Element References

Each interactive element should receive a reference:

```text
e1
e2
e3
```

Internal structure:

```typescript
interface ElementReference {
  ref: string

  backendNodeId?: number

  nodeId?: number

  role?: string

  name?: string

  frameId?: string

  createdAt: number
}
```

The element map should exist per:

```text
tab
page generation
```

---

# 11. Reference Invalidation

Element references should become invalid when:

- navigation occurs
- major document replacement occurs
- page reload occurs

OpenChrome should detect stale references and return:

```text
STALE_ELEMENT_REFERENCE
```

The agent should then request another snapshot.

---

# 12. Interaction Strategy

OpenChrome should support multiple interaction strategies.

Primary click/type pipeline (AX is for discovery only):

```text
1. resolve ref -> backendNodeId + frameId (fail with ELEMENT_NOT_FOUND or STALE_ELEMENT_REFERENCE)
2. DOM.scrollIntoViewIfNeeded
3. DOM.getBoxModel -> viewport coords
4. Input.dispatchMouseEvent (click) or focus + Input.insertText (type)
5. on ELEMENT_NOT_FOUND retry once after fresh snapshot
```

Coordinate-based clicking is the execution mechanism, not just a fallback. Semantic AX provides discovery.

Applies to: `click`, `type`, `press key` (target = focused element unless `ref` given), `scroll`, `focus`.

---

# 13. Screenshot Pipeline

Flow:

```text
Agent
  ↓
browser_screenshot
  ↓
MCP shim
  ↓
daemon
  ↓
extension
  ↓
Page.captureScreenshot
  ↓
base64 PNG
  ↓
daemon -> MCP shim (as MCP image block)
  ↓
agent
```

Potential options:

```typescript
interface ScreenshotOptions {
  fullPage?: boolean // V1: viewport only, must be false/omitted
  format?: "png" | "jpeg"
  maxWidth?: number // default 1280, downscale via CDP captureBeyondViewport=false + resize
}
```

V1 may only support viewport screenshots.

MCP return: MUST be an MCP `image` content block (`mimeType: image/png|image/jpeg`, base64 `data`), NOT a JSON string. Include `pageGeneration` as accompanying text block so the agent can detect staleness.

---

# 14. Console Monitoring

When debugger attaches:

```text
Runtime.enable
Log.enable
```

Capture:

```text
console.log
console.warn
console.error
exceptions
```

Internal representation:

```typescript
interface ConsoleEntry {
  seq: number // monotonic per tab, used for `sinceSeq` polling
  level: "log" | "warn" | "error"

  message: string // truncated to 1000 chars

  timestamp: number

  source?: string
}
```

MCP tool:

```text
browser_console()
```

Parameters:

```text
tabId? (default = active tab)
level? (filter)
limit? (default 50, max 200)
sinceSeq? (return only seq > sinceSeq; response includes nextSeq)
```

---

# 15. Network Monitoring

Enable:

```text
Network.enable
```

Store a bounded in-memory request buffer.

Example:

```typescript
interface NetworkEntry {
  seq: number
  requestId: string
  url: string
  method: string
  status?: number
  statusText?: string
  mimeType?: string
  resourceType?: string
  failed?: boolean
  errorText?: string
  startedAt: number
}
```

MCP tool `browser_network` params: `tabId?, limit? (default 100, max 200), sinceSeq?`. Response includes `nextSeq`. Bodies are Phase 2; V1 must still capture `statusText/mimeType/errorText` so API-failure triage works without bodies.

Default buffer:

```text
500 requests per tab
```

Old entries should be evicted.

---

# 16. MCP Tool Definitions

All tools accept optional `tabId?` (default = active tab) and `timeoutMs?` (default 15000, max 60000). Tab-close cancels pending commands.

## browser_status

No input. Returns `{ extensionConnected, daemonVersion, activeTab?, uptimeMs }`. Used by `openchrome init` health check.

## browser_tabs

Returns available permitted tabs.

Response:

```json
{
  "tabs": [
    {
      "id": 21,
      "title": "Dashboard",
      "url": "http://localhost:3000",
      "active": true
    }
  ]
}
```

---

# browser_select_tab

Input:

```json
{
  "tabId": 21
}
```

---

# browser_open

Input:

```json
{
  "url": "http://localhost:3000",
  "newTab": false,
  "tabId": 21
}
```

Semantics: if `newTab=true`, open new tab and select it. Else navigate `tabId` (or active tab). Never navigate a denied URL — return `TAB_NOT_ALLOWED`.

---

# browser_back

Input: `{ "tabId": 21 }`. History back in that tab.

---

# browser_forward

Input: `{ "tabId": 21 }`. History forward in that tab.

---

# browser_snapshot

Input:

```json
{
  "tabId": 21
}
```

Response:

```text
[e1] heading "Dashboard"
[e2] button "Create"
[e3] link "Settings"
```

---

# browser_click

Input:

```json
{
  "tabId": 21,
  "ref": "e2"
}
```

---

# browser_type

Input:

```json
{
  "tabId": 21,
  "ref": "e3",
  "text": "hello@example.com"
}
```

---

# browser_press

Input:

```json
{
  "tabId": 21,
  "key": "Enter"
}
```

---

# browser_screenshot

Input:

```json
{
  "tabId": 21
}
```

---

# browser_console

Input:

```json
{
  "tabId": 21,
  "limit": 50
}
```

---

# browser_network

Input:

```json
{
  "tabId": 21,
  "limit": 100
}
```

---

# browser_reload

Input:

```json
{
  "tabId": 21
}
```

---

# 17. Internal Protocol

Shared TypeScript definitions:

```typescript
type BrowserCommand =
  | NavigateCommand
  | SnapshotCommand
  | ClickCommand
  | TypeCommand
  | ScreenshotCommand
  | ConsoleCommand
  | NetworkCommand
```

Message example:

```typescript
interface CommandMessage {
  id: string
  type: "command"
  method: string
  params: unknown
}
```

Response:

```typescript
interface CommandResponse {
  id: string
  type: "response"
  success: boolean
  result?: unknown
  error?: OpenChromeError
}
```

---

# 18. Error Model

Common errors:

```text
CHROME_NOT_CONNECTED

TAB_NOT_FOUND (tab does not exist)

TAB_NOT_ALLOWED (URL matched deny policy, or not in allowlist — permission system)

SESSION_BUSY (daemon already bound to another agent, V1 single-session)

DEBUGGER_ATTACH_FAILED (e.g. user DevTools open — only one debugger per tab)

ELEMENT_NOT_FOUND

STALE_ELEMENT_REFERENCE

NAVIGATION_FAILED

COMMAND_TIMEOUT (default 15s, override via timeoutMs)

NEEDS_APPROVAL (dangerous action gated; agent must surface to user, user approves in popup)
```

Do NOT use generic `PERMISSION_DENIED` for tab gating — use `TAB_NOT_ALLOWED` so the agent can distinguish from system errors.

Example:

```json
{
  "success": false,
  "error": {
    "code": "STALE_ELEMENT_REFERENCE",
    "message": "The page has changed. Request a new browser snapshot."
  }
}
```

---

# 19. Browser Debugger Lifecycle

OpenChrome should avoid unnecessarily attaching DevTools to every browser tab. Attaching shows a "is being debugged" infobar and detaches the user's own DevTools (Chrome allows one debugger per tab).

Attach when:

```text
Agent selects tab for snapshot/click/type/console/network
```

Detach when:

```text
User revokes permission

Tab closes

Tab navigates to denied URL

OpenChrome disconnects

Session idle >60s (configurable)
```

On `DEBUGGER_ATTACH_FAILED`, surface "Close DevTools or detach other debugger" hint. Popup must show attached-tab indicator.

---

# 20. Permission Model

Enforcement point: extension `TabManager` (+ daemon `tab-registry` mirror). `browser_tabs` returns ONLY allowed tabs. Any command targeting a denied tab/URL returns `TAB_NOT_ALLOWED` without attaching debugger or navigating.

Recommended internal representation:

```typescript
interface SitePermission {
  pattern: string

  policy:
    | "allow"
    | "ask"
    | "deny"
}
```

Examples:

```text
localhost         allow
*.myapp.com       allow
github.com        ask
stripe.com        deny
```

---

# 21. Sensitive Data Handling

OpenChrome must not expose by default:

```text
browser passwords
raw cookies
Authorization headers
credit-card autofill
password-manager data
type=password field contents
token query params (?token=, ?code=)
```

Access to:

```text
localStorage
sessionStorage
cookies
```

should be implemented separately and protected by stronger permission controls.

---

# 22. Connection Authentication

Even though the connection is local, the extension and daemon should authenticate each other. The MCP shim inherits trust from loopback + token passed from daemon at spawn.

Pairing flow (V1):

```text
1. `openchrome daemon` generates random session token oc_... on first run, stores in OS user config dir
2. `openchrome init` prints token + copies to clipboard
3. User pastes token into extension popup Pairing field -> chrome.storage.local
4. Extension sends `register { token }` on WS connect to daemon ws://127.0.0.1:18721
5. Daemon rotates token on `openchrome reset-token`; old token rejected with AUTH_FAILED
```

A QR/pairing flow may later be added.

---

# 23. Connection Heartbeats

WebSocket connection (owned by Offscreen Document, supervised by SW via chrome.alarms) should use a heartbeat.

Example:

```text
ping every 5 seconds
```

Declare disconnected after:

```text
15 seconds
```

---

# 24. Reconnection

Extension should automatically reconnect using exponential backoff.

Example:

```text
250 ms

500 ms

1 sec

2 sec

5 sec
```

Maximum:

```text
5 seconds
```

---

# 25. Daemon + Shim State

Example:

```typescript
interface OpenChromeDaemonState {
  extensionConnected: boolean

  activeTab?: number
  pageGenerationByTab: Map<number, number>

  sessions: Map<string, BrowserSession> // V1: max 1 active, else SESSION_BUSY

  pendingCommands:
    Map<string, PendingCommand> // timeoutMs default 15000, cancel on tab close
}
```

---

# 26. Session Model

OpenChrome V1 may use a single default agent session.

Later:

```typescript
interface BrowserSession {
  id: string

  agent: string

  tabIds: Set<number>

  activeTab?: number

  createdAt: number
}
```

This enables multi-agent support later.

---

# 27. Performance Targets

## Snapshot

Target:

```text
<500 ms
```

for typical application pages.

---

## Interaction

Bridge overhead target:

```text
<100 ms
```

excluding browser rendering and network requests.

---

## Memory

Extension background memory should remain minimal.

Network and console buffers must be bounded.

---

# 28. Logging

Local logs:

```text
connection opened
connection closed
debugger attached
debugger detached
command execution
command failures
```

Do not log:

```text
password fields
cookie values
Authorization headers
sensitive form contents
browser_type text for type=password or credential fields
full URLs with tokens (?token=, ?code=) — redact query secrets
```

---

# 29. Testing Strategy

## Unit Tests

Test:

```text
protocol parsing
reference generation
permission resolution
error mapping
snapshot transformation
```

---

# 30. Extension Integration Tests

Verify:

```text
connect
attach debugger
navigate
snapshot
click
type
capture console
capture network
reload
```

---

# 31. Test Application

Repository should include a test web app:

```text
examples/test-app/
```

Pages:

```text
/login

/signup

/dashboard

/api-error

/js-error

/modal

/form

/slow (delayed render, tests timeoutMs)

/iframe (cross-origin iframe, tests frame refs)

/shadow-dom (tests snapshot flattening)

/auth-gated (tests TAB_NOT_ALLOWED handling)
```

This allows deterministic integration tests.

---

# 32. End-to-End Test

Example E2E test:

```text
Start test application

Start OpenChrome daemon

Start MCP shim

Connect Chrome extension

Open signup page

Request snapshot

Find email input

Enter email

Enter password

Click submit

Verify request

Verify success state
```

---

# 33. OpenCode Integration

Example configuration concept:

```json
{
  "$schema": "https://opencode.ai/config.json",

  "mcp": {
    "openchrome": {
      "type": "local",
      "command": [
        "openchrome",
        "mcp"
      ]
    }
  }
}
```

Exact configuration should follow the current OpenCode MCP configuration format.

---

# 34. Development Phases

## Phase 1 — Transport

Build:

```text
daemon WS host (127.0.0.1:18721, configurable)
MCP stdio shim + forwarder
extension Offscreen WS client + SW relay
pairing (token register)
ping/pong
command-response protocol with timeoutMs + cancellation on tab close
```

Verification:

Agent can request:

```text
browser_status
```

and receive:

```text
Chrome connected
```

---

## Phase 2 — Tab Control

Build:

```text
tabs (allowed-only filtering)
select tab (attach debugger on demand)
navigate (browser_open with newTab flag)
back / forward
reload
browser_status
```

---

## Phase 3 — Page Understanding

Build:

```text
accessibility tree
snapshot processor
element reference system
```

---

## Phase 4 — Interaction

Build:

```text
click
type
keyboard
scroll
```

---

## Phase 5 — Developer Inspection

Build:

```text
console monitoring
network monitoring
screenshots
```

---

## Phase 6 — Permissions

Build:

```text
extension popup
site allowlist
permission enforcement
connection visibility
```

---

# 35. Initial Milestone

A successful first technical milestone is:

```text
OpenCode
   ↓
browser_snapshot
   ↓
OpenChrome
   ↓
Chrome
```

and OpenCode receives:

```text
[e1] textbox "Email"
[e2] textbox "Password"
[e3] button "Login"
```

Then:

```text
browser_click(e3)
```

physically clicks the button in the user's existing Chrome tab.

---

# 36. MVP Acceptance Test

The following prompt should work:

> Start the project, open localhost:3000 in Chrome, complete the signup form, inspect any console or network failures, fix the code if necessary, reload the page, and verify that signup works.

OpenChrome succeeds when the coding agent can complete that full loop without the developer manually operating the browser.

---

# 37. Future Technical Extensions

Possible later additions:

```text
CDP performance tracing

Lighthouse integration

DOM diffing

visual regression testing

browser recording

agent action replay

multi-browser support

browser profiles

temporary sandbox sessions

Playwright backend

remote browser backend
```

---

# 38. Core Architectural Principle

OpenChrome should remain a thin browser-runtime layer.

It should not become responsible for agent reasoning.

The separation should remain:

```text
AI Agent
   │
   │ decides what to do
   ▼
OpenChrome
   │
   │ performs browser action
   ▼
Chrome
```

This makes OpenChrome compatible with any agent capable of using MCP.