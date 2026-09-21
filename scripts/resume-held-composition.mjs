import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { provisionSpacetimeDb } from "./provision-spacetimedb.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const handoffPath = join(root, ".artifacts/qualification/current-handoff.json");
const uiHandoffPath = join(root, ".artifacts/qualification/ui-composition/handoff.json");
const children = new Set();
let handoff;
let claimedOwnership = false;
let closing = false;
let finishHold;
const hold = new Promise((resolveHold) => { finishHold = resolveHold; });

async function jsonFile(pathname, value) {
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(pathname, 0o600);
}
async function assertFree(port) {
  const socket = net.createServer();
  await new Promise((resolveListen, reject) => { socket.once("error", reject); socket.listen(port, "127.0.0.1", resolveListen); });
  await new Promise((resolveClose, reject) => socket.close((error) => error ? reject(error) : resolveClose()));
}
async function owned(command, args, env, logfile) {
  const log = await open(logfile, "a", 0o600);
  const child = spawn(command, args, { cwd: root, env, detached: true, stdio: ["ignore", log.fd, log.fd] });
  await log.close();
  children.add(child);
  child.once("error", () => finishHold());
  child.once("exit", () => { if (!closing) finishHold(); });
  return child;
}
async function ready(child, url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("owned child exited before readiness");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok && child.exitCode === null && child.signalCode === null) return;
    } catch { /* Wait for this owned child. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("owned child readiness timed out");
}
async function cleanup() {
  if (closing) return;
  closing = true;
  if (handoff && claimedOwnership) {
    try {
      const current = JSON.parse(await readFile(handoffPath, "utf8"));
      if (current.runDirectory === handoff.runDirectory && current.ownerPid === process.pid) {
        await jsonFile(handoffPath, { ...current, available: false, phase: "closed" });
      }
      const ui = JSON.parse(await readFile(uiHandoffPath, "utf8"));
      if (ui.ownerPid === process.pid) await jsonFile(uiHandoffPath, { ...ui, available: false, phase: "closed" });
    } catch (error) {
      console.error(`handoff close update failed: ${error.message}`);
    }
  }
  for (const child of children) {
    if (!child.pid) continue;
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  const end = Date.now() + 5000;
  while ([...children].some((child) => child.exitCode === null && child.signalCode === null) && Date.now() < end) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  for (const child of children) {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => finishHold());

try {
  handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  const uri = new URL(handoff.uri);
  if (uri.hostname !== "127.0.0.1" || uri.protocol !== "http:") throw new Error("resume requires the recorded IPv4 loopback URI");
  await assertFree(Number(uri.port));
  claimedOwnership = true;
  await jsonFile(handoffPath, { ...handoff, available: false, phase: "resuming-retained-data", ownerPid: process.pid });
  const toolchain = await provisionSpacetimeDb();
  const server = await owned(toolchain.standalonePath, [
    "start", "--listen-addr", uri.host,
    "--data-dir", join(handoff.runDirectory, "spacetime-data"),
    "--jwt-key-dir", join(handoff.runDirectory, "cli-root/config"), "--non-interactive",
  ], process.env, join(handoff.runDirectory, "server-resumed.log"));
  await ready(server, `${uri.origin}/v1/ping`);
  handoff = { ...handoff, available: true, phase: "g2-held", ownerPid: process.pid };
  await jsonFile(handoffPath, handoff);
  console.log(JSON.stringify({ available: true, phase: handoff.phase, uri: handoff.uri, handoffPath }));
  const previousUi = JSON.parse(await readFile(uiHandoffPath, "utf8"));
  const uiPort = Number(new URL(previousUi.frontendUrl).port);
  await assertFree(uiPort);
  const frontend = await owned(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "dev", "frontend", "--hostname", "127.0.0.1", "--port", String(uiPort)], {
    ...process.env,
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_URI: handoff.uri,
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_DATABASE: handoff.databaseName,
    NEMEIA_SPACETIMEDB_URI: handoff.uri,
    NEMEIA_SPACETIMEDB_DATABASE: handoff.databaseName,
    NEMEIA_WORLD_RESOURCE_ROOT: handoff.resourceRoot,
  }, join(handoff.runDirectory, "frontend-resumed.log"));
  await ready(frontend, `${previousUi.frontendUrl}/missions`);
  await jsonFile(uiHandoffPath, { ...previousUi, available: true, ownerPid: process.pid });
  console.log(JSON.stringify({ frontendUrl: `${previousUi.frontendUrl}/missions`, mutations: "G2 first, then G3, then UI write flow" }));
  await hold;
} catch (error) {
  console.error(`resume failed: ${error.message}`);
  process.exitCode = 1;
} finally { await cleanup(); }
