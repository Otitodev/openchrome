# OpenChrome — Build Plan (V1)

Source of truth: PRD + TRD in this folder (updated for daemon+shim split, 18721, Offscreen WS, seq cursors).

## Architecture

```text
Agent -> MCP shim (stdio, ephemeral) -> Daemon (127.0.0.1:18721, long-lived, token) -> Extension (Offscreen WS client) -> Chrome (CDP via chrome.debugger)
```

## Phase 0 — Scaffold (current)
- [x] PRD/TRD updated
- [ ] pnpm monorepo: apps/daemon, apps/mcp-server, apps/extension, packages/protocol, packages/browser-model, packages/shared, examples/test-app
- [ ] Shared TS types: CommandMessage, CommandResponse, ElementReference, OpenChromeError, SitePermission
- [ ] tsconfig + lint + unit harness

## Phase 1 — Transport
- Daemon WS host, token store `oc_...`, register, ping/pong 5s/15s, pendingCommands timeout 15s + cancel on tab close, SESSION_BUSY
- MCP shim stdio forwarder, validates tabId?/timeoutMs?
- Extension Offscreen WS + SW relay + alarms heartbeat, backoff 250ms->5s
- Pairing: `openchrome daemon`, `openchrome init` prints token, popup paste -> storage.local
- Tool: `browser_status`
- Verify: init shows extensionConnected, daemon survives agent restart

## Phase 2 — Tab control
- TabManager allowed-only filter, select_tab + lazy debugger attach, open {url,newTab?}, back/forward/reload, browser_status
- localhost allow default, deny -> TAB_NOT_ALLOWED without attach
- Detach on revoke/tabClose/denied-nav/idle 60s, DEBUGGER_ATTACH_FAILED hint
- Verify via OpenCode on localhost:3000

## Phase 3 — Snapshot
- AX + DOM merge, [eN] + [eN in f2], skip hidden, truncate 80 chars, cap 500 nodes, pageGeneration bump on nav/reload
- Ref map per tab+generation, STALE_ELEMENT_REFERENCE
- Verify on /login,/iframe,/shadow-dom <500ms

## Phase 4 — Interaction
- resolve -> scrollIntoViewIfNeeded -> getBoxModel -> Input.dispatch*, press {key,ref?}, 1x retry after fresh snapshot
- Tools: click, type, press
- Verify: signup fill + submit clicks visibly

## Phase 5 — Inspection
- Console Runtime+Log.enable buffer {seq,level,msg 1000cap}, browser_console {level?,sinceSeq?,limit?}
- Network Network.enable buffer 500/tab {seq,url,method,status,statusText,mimeType,errorText}, browser_network {sinceSeq?,limit?}
- Screenshot viewport-only maxWidth 1280 as MCP image block + pageGeneration
- Redact passwords/cookies/Authorization/?token=
- Verify: JS error + 500 API visible via tools

## Phase 6 — Permissions + UX
- Popup: dot, active tab+generation, attach indicator, pairing, Enable/Disable, Approve for NEEDS_APPROVAL
- Settings allowlist, enforcement in TabManager, NEEDS_APPROVAL for POST non-localhost/destructive
- `openchrome init` e2e check
- MVP acceptance: open localhost:3000, fill signup, check console/network, fix, reload, verify — no manual browser use

## Risks
- MV3 socket survival (prove in Phase 1)
- Debugger infobar / single-debugger conflict
- AX <500ms on heavy SPAs (budget enforced)
