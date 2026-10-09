const GRANT_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

function feedback(text) {
  $("feedback-text").textContent = text;
}

function friendlyReason(reason, actionKey) {
  // Backend reasons look like: needs approval: sensitive element "Password" (actionKey=...).
  // Surface action + scope; keep raw reason as fallback.
  const m = /sensitive element "([^"]+)"/.exec(reason || "");
  const tab = /element\.type\|(\d+)/.exec(actionKey || "");
  if (m) return `Your agent wants to fill the “${m[1]}” field${tab ? ` (tab ${tab[1]})` : ""}.`;
  const nav = /navigation to (\S+)/.exec(reason || "");
  if (nav) return `Your agent wants to open ${nav[1]}.`;
  const ask = /tab (\d+) \(([^)]+)\) requires approval/.exec(reason || "");
  if (ask) return `Your agent wants to act on ${ask[2]} (tab ${ask[1]}).`;
  return reason || "Your agent is requesting approval.";
}

async function refresh() {
  const s = await chrome.storage.local.get(["ocToken", "ocEnabled", "ocRules", "ocPending"]);
  const paired = !!s.ocToken;
  const enabled = s.ocEnabled !== false;

  $("paired-content").hidden = !paired;
  $("pairing").hidden = paired;

  const badge = $("badge");
  badge.classList.toggle("neutral", !(paired && enabled));
  $("badge-label").textContent = !paired ? "Unpaired" : enabled ? "Connected" : "Paused";
  $("conn-title").textContent = !paired ? "Pairing required" : enabled ? "Agent connected" : "Agent access paused";
  $("conn-detail").textContent = !paired
    ? "Pair below to begin."
    : enabled ? "Ready for permitted browser actions." : "Resume when you’re ready. Configuration is preserved.";
  $("pause").textContent = enabled ? "Pause" : "Resume";

  const entries = Object.entries(s.ocPending ?? {});
  $("approval-count").textContent = String(entries.length);
  const pendEl = $("pending");
  pendEl.innerHTML = "";
  $("approval-empty").hidden = entries.length > 0;
  for (const [k, v] of entries) {
    const card = document.createElement("div");
    card.className = "approval";
    const head = document.createElement("div");
    head.className = "approval-head";
    head.textContent = "Permission needed";
    const p = document.createElement("p");
    p.textContent = friendlyReason(v.reason, k);
    const scope = document.createElement("p");
    scope.className = "approval-note";
    scope.textContent = "This decision applies to this request only.";
    const row = document.createElement("div");
    row.className = "approval-actions";
    const ok = document.createElement("button");
    ok.className = "button primary";
    ok.textContent = "Allow once";
    ok.onclick = async () => {
      const cur = await chrome.storage.local.get(["ocGrants", "ocPending"]);
      const grants = cur.ocGrants ?? {};
      const pending = cur.ocPending ?? {};
      grants[k] = Date.now() + GRANT_MS;
      delete pending[k];
      await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
      await refresh();
      feedback("Allowed once. Site rules are unchanged.");
    };
    const no = document.createElement("button");
    no.className = "button";
    no.textContent = "Deny";
    no.onclick = async () => {
      const cur = await chrome.storage.local.get("ocPending");
      const pending = cur.ocPending ?? {};
      delete pending[k];
      await chrome.storage.local.set({ ocPending: pending });
      await refresh();
      feedback("This request was denied. Site rules are unchanged.");
    };
    row.append(ok, no);
    card.append(head, p, scope, row);
    pendEl.appendChild(card);
  }

  const rulesEl = $("rules");
  rulesEl.innerHTML = "";
  const rules = s.ocRules?.length ? s.ocRules : [{ pattern: "localhost", policy: "allow" }];
  for (const r of rules) {
    const row = document.createElement("div");
    row.className = "site-row";
    const code = document.createElement("code");
    code.textContent = r.pattern;
    const sel = document.createElement("select");
    sel.className = "policy " + r.policy;
    sel.setAttribute("aria-label", "Permission for " + r.pattern);
    for (const opt of ["allow", "ask", "deny"]) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt[0].toUpperCase() + opt.slice(1);
      if (r.policy === opt) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = async () => {
      const cur = (await chrome.storage.local.get("ocRules")).ocRules ?? [];
      const next = cur.map((q) => (q.pattern === r.pattern ? { pattern: q.pattern, policy: sel.value } : q));
      await chrome.storage.local.set({ ocRules: next });
      await refresh();
      feedback(`${r.pattern}: policy set to ${sel.value}.`);
    };
    row.append(code, sel);
    rulesEl.appendChild(row);
  }
}

$("pause")?.addEventListener("click", async () => {
  const { ocEnabled } = await chrome.storage.local.get("ocEnabled");
  const next = ocEnabled === false;
  await chrome.storage.local.set({ ocEnabled: next });
  await refresh();
  feedback(next ? "Agent access resumed." : "Agent access paused. Your connection is preserved.");
});
$("disconnect")?.addEventListener("click", async () => {
  await chrome.storage.local.remove(["ocToken", "ocGrants", "ocPending"]);
  await chrome.storage.local.set({ ocEnabled: true });
  await refresh();
  feedback("Disconnected. Pair again to reconnect.");
});
$("pairing")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("pair-token")?.value?.trim() ?? "";
  const bad = !v.startsWith("oc_");
  $("pair-token").setAttribute("aria-invalid", String(bad));
  $("pair-error").hidden = !bad;
  if (bad) {
    feedback("Pairing token needs correction.");
    $("pair-token").focus();
    return;
  }
  await chrome.storage.local.set({ ocToken: v, ocEnabled: true });
  $("pair-token").value = "";
  await refresh();
  feedback("Agent connected. You’re ready to browse.");
});
$("addRule")?.addEventListener("click", async () => {
  const pattern = $("pattern")?.value?.trim();
  const policy = $("policy")?.value ?? "ask";
  if (!pattern) return;
  const { ocRules } = await chrome.storage.local.get("ocRules");
  await chrome.storage.local.set({ ocRules: [...(ocRules ?? []), { pattern, policy }] });
  $("pattern").value = "";
  await refresh();
  feedback(`${pattern}: policy set to ${policy}.`);
});
void refresh();
