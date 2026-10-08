const GRANT_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.storage.local.get(["ocToken", "ocEnabled", "ocRules", "ocPending"]);
  const paired = !!s.ocToken;
  const enabled = s.ocEnabled !== false;
  $("dot").className = "dot" + (paired && enabled ? " on" : "");
  $("status").textContent = !paired
    ? "Not paired — paste token from openchrome init"
    : enabled ? "Connected" : "Paused";
  $("toggle").textContent = enabled ? "Disable" : "Enable";

  const rulesEl = $("rules");
  rulesEl.innerHTML = "";
  const rules = s.ocRules?.length ? s.ocRules : [{ pattern: "localhost", policy: "allow" }];
  for (const r of rules) {
    const li = document.createElement("li");
    li.className = "site";
    const code = document.createElement("code");
    code.textContent = r.pattern;
    const pill = document.createElement("span");
    pill.className = "pill " + r.policy;
    pill.textContent = r.policy;
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.title = "Remove rule";
    x.onclick = async () => {
      const cur = (await chrome.storage.local.get("ocRules")).ocRules ?? [];
      await chrome.storage.local.set({ ocRules: cur.filter((q) => q.pattern !== r.pattern) });
      await refresh();
    };
    li.append(code, pill, x);
    rulesEl.appendChild(li);
  }

  const pendEl = $("pending");
  pendEl.innerHTML = "";
  const entries = Object.entries(s.ocPending ?? {});
  if (!entries.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No pending approvals";
    pendEl.appendChild(li);
  }
  for (const [k, v] of entries) {
    const li = document.createElement("li");
    li.className = "card approval";
    const p = document.createElement("p");
    p.textContent = v.reason;
    const row = document.createElement("div");
    row.className = "actions";
    const ok = document.createElement("button");
    ok.className = "primary";
    ok.textContent = "Approve";
    ok.onclick = async () => {
      const cur = await chrome.storage.local.get(["ocGrants", "ocPending"]);
      const grants = cur.ocGrants ?? {};
      const pending = cur.ocPending ?? {};
      grants[k] = Date.now() + GRANT_MS;
      delete pending[k];
      await chrome.storage.local.set({ ocGrants: grants, ocPending: pending });
      await refresh();
    };
    const no = document.createElement("button");
    no.className = "danger-ghost";
    no.textContent = "Deny";
    no.onclick = async () => {
      const cur = await chrome.storage.local.get("ocPending");
      const pending = cur.ocPending ?? {};
      delete pending[k];
      await chrome.storage.local.set({ ocPending: pending });
      await refresh();
    };
    row.append(ok, no);
    li.append(p, row);
    pendEl.appendChild(li);
  }
}

$("pair")?.addEventListener("click", async () => {
  const v = $("token")?.value?.trim();
  if (!v) return;
  await chrome.storage.local.set({ ocToken: v, ocEnabled: true });
  $("token").value = "";
  await refresh();
});
$("toggle")?.addEventListener("click", async () => {
  const { ocEnabled } = await chrome.storage.local.get("ocEnabled");
  await chrome.storage.local.set({ ocEnabled: ocEnabled === false });
  await refresh();
});
$("addRule")?.addEventListener("click", async () => {
  const pattern = $("pattern")?.value?.trim();
  const policy = $("policy")?.value;
  if (!pattern) return;
  const { ocRules } = await chrome.storage.local.get("ocRules");
  const rules = [...(ocRules ?? []), { pattern, policy }];
  await chrome.storage.local.set({ ocRules: rules });
  $("pattern").value = "";
  await refresh();
});
void refresh();
