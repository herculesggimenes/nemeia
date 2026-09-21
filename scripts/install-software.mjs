import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { linkSoftwareTools } from "./link-software-tools.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const version = process.versions.node.split(".").map(Number);
if (version[0] < 24 || (version[0] === 24 && version[1] < 19)) {
  throw new Error("The software composition requires Node >=24.19.0 for its local SQLite ledgers.");
}
try {
  const handoff = JSON.parse(await readFile(resolve(root, ".artifacts/qualification/current-handoff.json"), "utf8"));
  if (handoff.available === true) throw new Error("Stop the owned held composition before replacing installed dependencies.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await stat(resolve(root, "package-lock.json"));
// Eve's generated Nitro hosts resolve transitive dependencies from the project
// root, so use the standard hoisted workspace layout. Lifecycle
// hooks are omitted here because frontend prepare mutates the checkout's Git hooks.
const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", [
  "ci", "--install-strategy=hoisted", "--legacy-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund",
], { cwd: root, stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", async (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
  if (process.exitCode === 0) {
    try { await linkSoftwareTools(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
});
