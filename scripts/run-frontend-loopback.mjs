import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const child = spawn("npm", ["--prefix", "frontend", "run", "dev", "--", "-H", "127.0.0.1"], {
  cwd: root,
  stdio: "inherit",
  detached: true
});
let cleaned = false;
function cleanup() {
  if (cleaned || !child.pid) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}
child.on("exit", (code, signal) => {
  cleanup();
  process.exitCode = signal ? 1 : (code ?? 1);
});
child.on("error", error => {
  cleanup();
  console.error(`frontend loopback entrypoint failed: ${error.message}`);
  process.exitCode = 1;
});
