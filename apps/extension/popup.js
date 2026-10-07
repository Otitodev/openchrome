const statusEl = document.getElementById("status");
const tokenEl = document.getElementById("token");
async function refresh() {
  const s = await chrome.storage.local.get(["ocToken", "ocEnabled", "ocRules", "ocPending"]);
  if (statusEl) statusEl.textContent = s.ocToken ? `Paired (${s.ocEnabled === false ? "disabled" : "enabled"})` : "Not paired — paste token from `openchrome init`";
  const rulesEl = document.getElementById("rules");
  if (rulesEl) {
    rulesEl.innerHTML = "";
    for (const r of (s.ocRules ?? [{ pattern: "localhost", policy: "allow" }])) {
      const li = document.createElement("li");
      li.textContent = `${r.pattern} — ${r.policy}`;
      rulesEl.appendChild(li);
    }
  }
  const pendEl = document.getElementById("pending");
  if (pendEl) {
    pendEl.innerHTML = "";
    for (const [k, v] of Object.entries((s.ocPending ?? {}))) {
      const li = document.createElement("li");
      li.textContent = v.reason + " ";
      const btn = document.createElement("button");
      btn.textContent = "Approve";
      btn.onclick = async () => {
        const cur = await chrome.storage.local.get(["ocGrants", "ocPending"]);
        const grants = cur.ocGrants ?? {};
        const pending = cur.ocPending ?? {};
        grants[k] = Date.now() + 5 * 60 * 1000;
        delete pending[k];
        await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
        await refresh();
      };
      li.appendChild(btn);
      pendEl.appendChild(li);
    }
    if (Object.keys(s.ocPending ?? {}).length === 0) pendEl.innerHTML = "<li>none</li>";
  }
}
document.getElementById("pair")?.addEventListener("click", async () => {
  const v = document.getElementById("token")?.value?.trim();
  if (!v) return;
  await chrome.storage.local.set({ ocToken: v, ocEnabled: true });
  await refresh();
});
document.getElementById("toggle")?.addEventListener("click", async () => {
  const { ocEnabled } = await chrome.storage.local.get("ocEnabled");
  await chrome.storage.local.set({ ocEnabled: ocEnabled === false ? true : false });
  await refresh();
});
document.getElementById("addRule")?.addEventListener("click", async () => {
  const pattern = document.getElementById("pattern")?.value?.trim();
  const policy = document.getElementById("policy")?.value;
  if (!pattern) return;
  const { ocRules } = await chrome.storage.local.get("ocRules");
  const rules = [...(ocRules ?? []), { pattern, policy }];
  await chrome.storage.local.set({ ocRules: rules });
  await refresh();
});
void refresh();
