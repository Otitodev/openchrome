# OpenChrome — Product Requirements Document

## 1. Product Overview

**Product Name:** OpenChrome  
**Category:** Developer Tool / AI Agent Infrastructure / Browser Automation  
**Primary Interface:** MCP-compatible local tool server + Chrome extension  
**Initial Target:** OpenCode  
**Future Targets:** Claude Code, Codex CLI, Cursor, Gemini CLI, custom coding agents

OpenChrome is a local browser-control bridge that allows AI coding agents to interact with the user's existing Chrome browser session.

Unlike traditional automation tools that launch a separate controlled browser, OpenChrome connects the agent to the browser the developer is already using.

The coding agent can:

- inspect open Chrome tabs
- navigate websites
- inspect rendered pages
- interact with buttons, fields, menus, and links
- take screenshots
- inspect browser console logs
- inspect network requests
- reload pages
- verify application behavior
- use authenticated browser sessions already available to the user

The main initial use case is allowing OpenCode to write application code, open the application in Chrome, interact with it, detect failures, fix the code, and verify the fix.

---

# 2. Problem Statement

AI coding agents are increasingly capable of generating and modifying application code, but they often operate without direct access to the actual rendered application.

Typical workflow:

```text
Developer
   ↓
AI writes code
   ↓
Developer opens browser
   ↓
Developer manually tests
   ↓
Developer reports problem
   ↓
AI modifies code
```

This creates a major gap in the agentic software-development loop.

The agent cannot independently answer questions like:

- Did the page render correctly?
- Did the button actually work?
- Did the API request succeed?
- Did a JavaScript error appear?
- Is the form behaving correctly?
- Does the UI visually match the intended design?
- Did the bug fix actually solve the problem?

Some browser automation frameworks address this using separate Chromium instances, but this creates additional friction.

Separate browser instances often lack:

- the developer's active sessions
- cookies
- local browser configuration
- authenticated dashboards
- browser extensions
- existing tabs
- the exact environment the developer is using

OpenChrome solves this by connecting the AI agent directly to the user's existing Chrome environment.

---

# 3. Product Vision

OpenChrome should become a universal browser runtime for coding agents.

```text
OpenCode ─────┐
Claude Code ──┤
Codex ────────┤
Cursor ───────┼── MCP ── OpenChrome ── Chrome
Gemini CLI ───┤
Custom Agent ─┘
```

The long-term goal is:

> Give any AI coding agent controlled access to the developer's actual Chrome browser.

OpenChrome should make the browser another execution environment available to the coding agent, similar to:

- shell
- filesystem
- Git
- databases
- API clients

---

# 4. Goals

## 4.1 Primary Goals

OpenChrome V1 should allow an MCP-compatible coding agent to:

1. Connect to the user's Chrome browser.
2. Discover available browser tabs.
3. Open and navigate tabs.
4. Understand the visible page structure.
5. Interact with page elements.
6. Enter text.
7. capture screenshots.
8. inspect browser console logs.
9. inspect network requests.
10. reload and re-test pages.
11. perform automated debugging loops.

---

# 5. Non-Goals

The first release will not attempt to be:

- a general-purpose robotic process automation platform
- a cloud browser service
- a browser hosting platform
- a replacement for Playwright
- a Selenium replacement
- a remote browser farm
- a scraping platform
- an anti-bot bypass system
- a credential management system
- a browser synchronization product

OpenChrome focuses initially on local developer browser control.

---

# 6. Target Users

## Primary User

Software developers using AI coding agents.

Examples:

- OpenCode developers
- Claude Code users
- Codex CLI users
- Cursor users
- AI-assisted frontend developers
- full-stack developers

---

## Secondary Users

OpenChrome may later support:

- QA engineers
- agent-framework developers
- AI testing agents
- autonomous coding agents
- internal developer-platform teams

---

# 7. Core Use Cases

## 7.1 Application Testing

User:

> Build the signup form and test it.

Agent:

1. writes code
2. starts development server
3. opens localhost
4. inspects the UI
5. enters test data
6. submits form
7. checks result
8. reports success or fixes errors

---

# 7.2 Debugging Frontend Errors

User:

> Figure out why the dashboard is not loading.

Agent:

1. opens dashboard
2. checks console
3. detects JavaScript exception
4. inspects source code
5. patches code
6. reloads page
7. verifies fix

---

# 7.3 API Failure Detection

Agent performs form submission.

OpenChrome detects:

```text
POST /api/users
500 Internal Server Error
```

Agent can correlate browser failure with backend source code.

---

# 7.4 Visual Verification

User:

> Make the page match the design.

Agent:

1. modifies CSS
2. reloads page
3. captures screenshot
4. visually evaluates result
5. repeats until acceptable

---

# 7.5 Authenticated Application Testing

Developer is already logged into:

```text
admin.example.com
```

OpenChrome can allow the coding agent to inspect the authenticated application without requiring the agent to perform the login process.

---

# 8. User Journey

## 8.1 Installation

User installs:

1. OpenChrome Chrome extension
2. OpenChrome npm package + long-lived local daemon

Example:

```bash
npm install -g openchrome
openchrome daemon  # hosts ws://127.0.0.1:18721, owns session token
```

The MCP shim is added to OpenCode configuration and forwards to the daemon over loopback. Pairing: `openchrome init` prints the session token, user pastes it into the extension popup once.

---

# 8.2 Connection

User opens Chrome.

The extension shows:

```text
OpenChrome

Agent connection: Connected

Current site:
localhost:3000

Allow agent access:
[ Allow this tab ]

[ Disconnect ]
```

---

# 8.3 Agent Interaction

User asks OpenCode:

> Test the signup workflow.

OpenCode requests:

```text
browser_tabs()
```

OpenChrome returns available allowed tabs.

Agent selects:

```text
localhost:3000
```

Agent requests:

```text
browser_snapshot()
```

Response:

```text
Page: Create Account

[e1] textbox "Email"
[e2] textbox "Password"
[e3] button "Create account"
```

Agent:

```text
browser_type(e1, "test@example.com")
browser_type(e2, "Password123")
browser_click(e3)
```

The browser responds normally.

---

# 9. Functional Requirements

## FR-1 Browser Connection

OpenChrome must establish communication between:

```text
Chrome Extension (Offscreen WS client)
        ↓
Local OpenChrome Daemon (127.0.0.1:18721)
        ↓
MCP Shim (stdio, spawned by agent)
        ↓
MCP Client
```

Communication must remain local by default. The daemon is long-lived; the shim is ephemeral per agent session.

---

# FR-2 Tab Discovery

Agent must be able to retrieve:

- tab ID
- tab title
- URL
- active status

Example:

```json
[
  {
    "id": 42,
    "title": "Dashboard",
    "url": "http://localhost:3000",
    "active": true
  }
]
```

---

# FR-3 Tab Selection

Agent must be able to select a tab as the current working context.

---

# FR-4 Navigation

Agent must be able to:

- navigate to URL (same tab by default, `newTab:true` opens + selects new tab)
- go back
- go forward
- reload
- never navigate to a denied URL (must return TAB_NOT_ALLOWED)

---

# FR-5 Page Snapshot

OpenChrome must provide a semantic representation of the page.

Preferred data sources:

- Chrome Accessibility Tree
- DOM information
- element metadata

Example:

```text
[e1] heading "Sign in"
[e2] textbox "Email"
[e3] textbox "Password"
[e4] button "Continue"
```

---

# FR-6 Stable Element References

Page elements should receive temporary references.

Example:

```text
e1
e2
e3
```

The agent should interact using references instead of fragile CSS selectors wherever possible.

---

# FR-7 Element Interaction

Agent must support:

```text
click
type
focus
scroll
press key
```

---

# FR-8 Screenshots

Agent must be able to request screenshots of:

- visible viewport (V1 only)
- optionally full page in later versions

Screenshots must be returned as MCP `image` content blocks (not base64 JSON strings), downscaled to maxWidth 1280 by default, in a format compatible with multimodal coding agents.

---

# FR-9 Console Inspection

Agent must be able to inspect:

- JavaScript errors
- warnings
- console messages
- uncaught exceptions

---

# FR-10 Network Inspection

Agent must be able to inspect:

- request URL
- HTTP method
- status
- resource type
- timing
- failed requests

Future versions may expose request and response bodies.

---

# FR-11 Page Reload

Agent must be able to reload the page and perform another verification cycle.

---

# FR-12 Permission Control

The user must control which browser contexts the agent can access.

Possible permission levels:

```text
Current tab only

Current domain

Localhost only

Allowed domains

All websites
```

---

# FR-13 Connection Indicator

Chrome extension should clearly indicate when an agent is connected.

Example:

```text
OpenChrome

● Connected to OpenCode

Active Tab:
localhost:3000
```

---

# FR-14 Action Visibility

Actions performed by the agent should happen visibly inside Chrome.

The user should be able to observe:

- clicks
- typing
- navigation
- reloads

---

# 10. MCP Tool API

Minimum V1 tool set:

```text
browser_status
browser_tabs
browser_select_tab
browser_open        # {url, newTab?, tabId?}
browser_snapshot
browser_screenshot  # returns MCP image block, viewport-only V1
browser_click
browser_type
browser_press
browser_back
browser_forward
browser_console     # {tabId?, level?, limit?, sinceSeq?} -> {entries, nextSeq}
browser_network     # {tabId?, limit?, sinceSeq?} -> {entries, nextSeq}
browser_reload
```

All tools accept `timeoutMs?` (default 15000). `tabId?` defaults to the active tab.

---

# 11. Future Tool API

Potential future capabilities:

```text
browser_hover
browser_scroll
browser_select
browser_upload
browser_evaluate
browser_wait_for
browser_back
browser_forward
browser_storage_get
browser_storage_set
browser_downloads
browser_inspect
browser_performance
```

---

# 12. Security Requirements

Because OpenChrome can control authenticated browser sessions, security is a core product requirement.

## 12.1 Local-Only Communication

The OpenChrome bridge should bind by default to:

```text
127.0.0.1
```

It should not expose browser control over public network interfaces.

---

## 12.2 Site Permissions

Users should explicitly control accessible sites.

Examples:

```text
Always allow localhost

Allow this domain

Allow once

Block site
```

---

## 12.3 Dangerous Action Confirmation

OpenChrome should support confirmation policies for sensitive actions.

Examples:

- payments
- account deletion
- password changes
- sending messages
- publishing content
- POST to non-localhost / non-allowlisted domains

Flow: tool returns `NEEDS_APPROVAL {reason}` instead of executing; user approves in the extension popup; agent retries after approval.

---

## 12.4 Visible Connection State

The extension should clearly show when browser control is active.

---

## 12.5 Session Secrets

OpenChrome must not expose raw cookie values by default. It must also redact `type=password` field contents, `Authorization` headers, and token query params from logs, snapshots, and tool outputs.

---

# 13. UX Requirements

The extension interface should remain extremely small.

Initial popup:

```text
OpenChrome

● Connected

Agent
OpenCode

Current Tab
localhost:3000

Agent Access
Enabled

[ Disable ]
```

Settings:

```text
Allowed Sites

localhost        Always
github.com       Ask
stripe.com       Never
```

---

# 14. Developer Experience

The ideal installation flow should eventually be:

```bash
npx openchrome init
```

The command:

1. detects supported coding agents
2. configures MCP
3. verifies extension connection
4. runs connection test

Example output:

```text
OpenChrome

✓ Chrome extension detected
✓ Browser bridge connected
✓ OpenCode MCP configured
✓ Browser tools available

Ready.
```

---

# 15. Success Metrics

## Technical

- browser action success rate >95%
- extension reconnect time <2 seconds
- snapshot generation <500ms on typical pages
- click command latency <300ms excluding page response
- no remote browser-control exposure by default

---

## Product

OpenChrome should successfully complete scenarios such as:

### Scenario A

```text
Open application
Fill registration form
Submit
Verify success message
```

### Scenario B

```text
Detect frontend console error
Modify code
Reload page
Verify error disappears
```

### Scenario C

```text
Detect failing API call
Read HTTP status
Fix backend
Retry interaction
Verify success
```

---

# 16. MVP Scope

## Required

- Chrome extension (MV3 + Offscreen WS client)
- local daemon (WS host on 127.0.0.1:18721, pairing token)
- MCP shim (stdio forwarder)
- OpenCode integration
- tab discovery (allowed-only)
- tab selection
- navigation + back/forward
- semantic page snapshot (500-node budget, frame-aware)
- click
- text entry
- keyboard actions
- screenshot (MCP image block)
- console logs (seq-cursor polling)
- network monitoring (statusText/mimeType/errorText, seq-cursor)
- reload
- domain permissions (enforced in extension)

---

## Optional

- screenshot annotations
- element highlighting
- action history
- full-page screenshots
- hover support

---

# 17. Post-MVP Roadmap

## Phase 2

Add:

- Codex support
- Claude Code support
- advanced accessibility-tree processing
- element highlighting
- better network inspection
- response bodies
- browser storage inspection

---

## Phase 3

Add agent-browser sessions:

```text
Agent A → Tab Group A
Agent B → Tab Group B
```

Add support for multiple simultaneous coding agents.

---

## Phase 4

Potential browser support:

```text
Chrome
Chromium
Edge
Brave
Arc
```

---

# 18. Positioning

OpenChrome should be positioned as:

> Browser DevTools for AI coding agents.

Alternative:

> Let your coding agent use the Chrome browser you're already using.

The core distinction from browser automation frameworks is:

```text
Traditional Browser Automation

Agent
  ↓
New browser instance
```

versus:

```text
OpenChrome

Agent
  ↓
Your existing Chrome
```

---

# 19. Open-Source Strategy

Recommended license:

```text
Apache 2.0
```

or:

```text
MIT
```

Repository structure should allow contributors to build:

- new MCP clients
- browser adapters
- custom permission systems
- additional DevTools capabilities

---

# 20. Definition of MVP Complete

The MVP is complete when a user can tell OpenCode:

> Open localhost:3000, fill the signup form, submit it, check for errors, and tell me whether it works.

OpenCode must be able to complete the workflow using OpenChrome without requiring the developer to manually inspect the browser.