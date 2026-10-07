# OpenChrome — Task List

## Phase 0 — Scaffold
- [x] 0.1 Init pnpm workspace (`package.json`, `pnpm-workspace.yaml`, `tsconfig.json`)
- [x] 0.2 Create `packages/shared` (types, errors, constants)
- [x] 0.3 Create `packages/protocol` (messages, commands, events)
- [x] 0.4 Create `packages/browser-model` (snapshot, elements)
- [x] 0.5 Scaffold `apps/daemon` (ws-server, token-store, tab-registry)
- [x] 0.6 Scaffold `apps/mcp-server` (index, server, tools, browser-client)
- [x] 0.7 Scaffold `apps/extension` (background SW, offscreen WS, popup UI, manifest)
- [x] 0.8 Scaffold `examples/test-app` routes
- [x] 0.9 Verify `tsc --noEmit` passes

## Phase 1 — Transport
- [x] 1.1 Daemon WS server on 127.0.0.1:18721 + configurable port
- [x] 1.2 Token generate/store/rotate + `register` auth
- [x] 1.3 Ping/pong 5s/15s + reconnect backoff
- [x] 1.4 Command/response correlation + timeout + cancel
- [x] 1.5 MCP shim stdio + `browser_status`
- [x] 1.6 Extension offscreen WS + SW relay + alarms
- [x] 1.7 Pairing UI + `openchrome init` / `daemon` CLI
- [x] 1.8 Verify browser_status e2e

## Phase 2 — Tab control
- [x] 2.1 TabManager list/select/open/back/forward/reload
- [x] 2.2 Debugger attach/detach lifecycle + idle 60s
- [x] 2.3 Permission filter (allowed-only tabs, TAB_NOT_ALLOWED)
- [ ] 2.4 Verify via OpenCode

## Phase 3 — Snapshot
- [x] 3.1 AX+DOM merge, frames, budget caps
- [x] 3.2 Ref map + pageGeneration + STALE handling
- [x] 3.3 browser_snapshot tool

## Phase 4 — Interaction
- [x] 4.1 Click/type/press pipeline + retry
- [x] 4.2 Tools wiring

## Phase 5 — Inspection
- [x] 5.1 Console buffer + tool
- [x] 5.2 Network buffer + tool
- [x] 5.3 Screenshot image block
- [x] 5.4 Redaction rules

## Phase 6 — Permissions + UX
- [x] 6.1 Popup + settings UI
- [x] 6.2 NEEDS_APPROVAL flow
- [x] 6.3 init e2e + MVP acceptance test
