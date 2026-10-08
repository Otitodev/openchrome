// OpenChrome build: bundles daemon + MCP shim to dist/, extension SW/offscreen to .js.
// Run: node build.mjs
import { buildSync } from "esbuild";
import { execSync } from "node:child_process";

console.log("typecheck (node)...");
execSync("node node_modules/typescript/bin/tsc --noEmit --skipLibCheck", { stdio: "inherit", shell: true });
console.log("typecheck (extension)...");
execSync("node node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p apps/extension/tsconfig.json", { stdio: "inherit", shell: true });

console.log("bundle daemon...");
buildSync({
  entryPoints: ["apps/daemon/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "apps/daemon/dist/index.cjs",
  logLevel: "warning",
});

console.log("bundle mcp-server...");
buildSync({
  entryPoints: ["apps/mcp-server/src/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "apps/mcp-server/dist/index.cjs",
  logLevel: "warning",
});

console.log("bundle extension...");
buildSync({
  entryPoints: ["apps/extension/src/background.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "apps/extension/background.js",
  logLevel: "warning",
});
buildSync({
  entryPoints: ["apps/extension/src/offscreen.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "apps/extension/offscreen.js",
  logLevel: "warning",
});

console.log("build ok: apps/daemon/dist, apps/mcp-server/dist, apps/extension/*.js");
