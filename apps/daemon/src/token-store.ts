import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

function configDir(): string {
  const dir = process.env.OPENCHROME_CONFIG_DIR ?? join(homedir(), ".openchrome");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function tokenPath(): string {
  return join(configDir(), "token");
}

export function loadOrCreateToken(): string {
  const env = process.env.OPENCHROME_TOKEN;
  if (env) return env;
  const p = tokenPath();
  if (existsSync(p)) {
    const t = readFileSync(p, "utf8").trim();
    if (t.startsWith("oc_")) return t;
  }
  const t = "oc_" + randomBytes(16).toString("hex");
  writeFileSync(p, t + "\n", { mode: 0o600 });
  return t;
}

export function resetToken(): string {
  const p = tokenPath();
  const t = "oc_" + randomBytes(16).toString("hex");
  writeFileSync(p, t + "\n", { mode: 0o600 });
  return t;
}
