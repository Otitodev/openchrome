# Chrome Web Store listing — OpenChrome

## Short description (≤132 chars)

Let your AI coding agent use the Chrome you're already using — test and verify its own work.

## Full description

OpenChrome connects AI coding agents (OpenCode, Claude Code, Codex CLI, Cursor) to the Chrome browser you're already using — your tabs, your sessions, your logins.

The agent can list tabs, navigate, read pages, click buttons, fill forms, take screenshots, and inspect console logs and network requests. The loop it unlocks:

1. Agent writes code and starts your dev server
2. It opens localhost, fills your signup form, submits
3. It reads console errors and failed API calls
4. It fixes the code, reloads, and verifies — without you touching the browser

You stay in control: localhost is allowed by default, other sites ask for approval first, denied sites are hidden from the agent. Password fields and sensitive actions require explicit approval in the popup. Everything runs locally — the bridge binds to 127.0.0.1 only, and no browsing data ever leaves your machine.

Requires the free command-line tools (`npm install -g opchrm`) which host the local bridge the extension pairs with.

## Category

Developer Tools

## Screenshots needed (1280×800)

1. Popup: connected state with pending approval card
2. Agent filling the signup form on localhost (before/after)
3. Console error surfaced to the agent
