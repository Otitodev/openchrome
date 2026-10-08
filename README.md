# OpenChrome

Let your coding agent use the Chrome browser you're already using. OpenChrome connects MCP-compatible agents (OpenCode, Claude Code, Codex, Cursor) to your existing Chrome session — tabs, navigation, snapshots, clicks, typing, console, network, screenshots — so the agent can test and verify its own work.

```text
Agent --MCP(stdio)--> openchrome-mcp --WS(127.0.0.1:18721)--> daemon <--WS--> Chrome extension --> your tabs
```

## Install

Requires Node.js 22+ and Chrome.

```bash
npm install -g openchrome
openchrome daemon        # start the local bridge (leave running)
```

Load the extension once: `chrome://extensions` → Developer mode → Load unpacked → select the `extension/` folder from this repo (or unzip `dist/openchrome-extension.zip`).

```bash
openchrome init          # prints a pairing token
```

Paste the token into the extension popup → Pair. Verify:

```bash
openchrome status        # extensionConnected: true
```

## Use with OpenCode

```json
{
  "mcp": {
    "openchrome": {
      "type": "local",
      "command": ["openchrome-mcp"],
      "enabled": true
    }
  }
}
```

Then prompt: `Open localhost:3000/signup, fill the form, submit, and tell me whether it works.`

## Tools

14 MCP tools: `browser_status`, `browser_tabs`, `browser_select_tab`, `browser_open`, `browser_snapshot`, `browser_screenshot` (image), `browser_click`, `browser_type`, `browser_press`, `browser_back`, `browser_forward`, `browser_reload`, `browser_console`, `browser_network`.

Snapshots return `[eN]` refs; refs go stale on navigation (`STALE_ELEMENT_REFERENCE` → snapshot again). Sensitive actions (password fields, non-allowlisted sites) return `NEEDS_APPROVAL` — approve in the popup, retry.

## Permissions

Default: `localhost` allowed, unknown sites ask, explicit rules in the popup (Allow/Ask/Deny per pattern). Denied tabs are hidden from the agent. Secrets (cookies, passwords, tokens) are never exposed; URLs are redacted in logs.

## Develop

```bash
npm install
npm run build          # typecheck + dist bundles for daemon, MCP server, extension
npm run daemon         # run daemon from dist
npm run mcp            # run MCP server from dist (stdio)
npm run test-app       # deterministic test app on :3000 (/signup, /login, /js-error, /api-error…)
npm run pack:extension # zip the extension for sideload/store
```

CLI manual mode (no MCP client needed): `node apps/mcp-server/dist/index.cjs browser_tabs`.

## License

MIT — see LICENSE.
