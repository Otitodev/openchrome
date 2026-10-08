// Pack the extension for sideload/store. Run: node scripts/pack-extension.mjs
// Output: dist/openchrome-extension.zip
import { mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const files = [
  "manifest.json",
  "background.js",
  "offscreen.html",
  "offscreen.js",
  "popup.html",
  "popup.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/icon.svg",
];
for (const f of files) {
  if (!existsSync(`apps/extension/${f}`)) throw new Error(`missing apps/extension/${f} — run npm run build first`);
}
mkdirSync("dist", { recursive: true });
// Prefer PowerShell Compress-Archive on Windows, zip elsewhere.
try {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Force -Path ${files.map((f) => `apps/extension/${f}`).join(",")} -DestinationPath dist/openchrome-extension.zip"`,
    { stdio: "inherit" },
  );
} catch {
  execSync(`zip -j dist/openchrome-extension.zip ${files.map((f) => `apps/extension/${f}`).join(" ")}`, { stdio: "inherit", cwd: "apps/extension" });
}
console.log("packed: dist/openchrome-extension.zip");
