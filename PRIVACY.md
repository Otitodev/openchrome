# Privacy Policy — OpenChrome

Last updated: October 8, 2026.

## Summary

OpenChrome processes everything locally on your machine. We collect nothing, transmit nothing, and operate no servers.

## Data handling

- **Local-only operation.** The extension communicates exclusively with the OpenChrome bridge on `127.0.0.1` (your own computer). No browsing data, page content, credentials, or telemetry is sent to us or any third party — there is no backend to send it to.
- **Permissions used and why:**
  - `tabs`, `activeTab` — list tabs the agent may see and focus the working tab.
  - `debugger` — required for the Chrome DevTools Protocol access that powers page snapshots, interaction, console, and network inspection. Attaching shows Chrome's standard "is being debugged" indicator.
  - `scripting` — fallback in-page interaction for elements the accessibility tree doesn't expose.
  - `storage` — your pairing token, site allowlist, and approval grants.
  - `alarms`, `webNavigation` — connection heartbeat and page-generation tracking.
  - `<all_urls>` host access — the agent works on whatever site you explicitly allow (localhost by default; other sites ask first or are denied per your rules).
- **Sensitive data.** Raw cookie values are never exposed to the agent. Password fields, authorization headers, and token URL parameters are redacted from logs and tool output. Destructive or sensitive actions require your explicit approval in the popup.
- **No analytics, no ads, no tracking.** The extension contains no analytics SDKs and sets no remote connections other than the loopback bridge you run yourself.

## Contact

Open an issue at https://github.com/openchrome/openchrome for privacy questions.
