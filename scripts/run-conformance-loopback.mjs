import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBackpackFixture } from "../conformance/src/backpack-fixture.ts";
import { runLoopbackBackpackQualification, runLoopbackSoftwareQualification } from "../conformance/src/backpack-harness.ts";
import { createQualificationReport, writeQualificationReport } from "../conformance/src/qualification-report.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const fixture = createBackpackFixture();
const reportDirectory = resolve(root, process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? ".artifacts/qualification");
let child;
let cleaned = false;

function commandFromEnvironment() {
  if (!process.env.NEMEIA_LOOPBACK_PROCESS) return null;
  const command = JSON.parse(process.env.NEMEIA_LOOPBACK_PROCESS);
  if (!Array.isArray(command) || command.length === 0 || command.some(value => typeof value !== "string")) {
    throw new Error("NEMEIA_LOOPBACK_PROCESS must be a JSON argv array");
  }
  return command;
}

function assertLoopbackUri(uri) {
  const hostname = new URL(uri).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) throw new Error("loopback qualification refuses non-loopback endpoints");
}

function cleanup() {
  if (cleaned || !child?.pid) return;
  cleaned = true;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function writeBlocked(reason) {
  const report = createQualificationReport({
    gate: "G1",
    mode: "loopback-spacetimedb",
    requestedResult: "blocked",
    fixtureDigest: fixture.fixtureDigest,
    checks: {},
    details: { reason }
  });
  await writeQualificationReport(resolve(reportDirectory, "g1-loopback.json"), report);
  console.error(`loopback qualification blocked: ${reason}`);
  process.exitCode = 2;
}

async function main() {
  const adapterPath = process.env.NEMEIA_LOOPBACK_ADAPTER
    ? resolve(process.env.NEMEIA_LOOPBACK_ADAPTER)
    : resolve(root, "conformance/src/loopback-adapter.ts");
  const required = ["NEMEIA_WORLD_CLIENT_MODULE", "NEMEIA_SPACETIMEDB_URI", "NEMEIA_SCOPED_IDENTITY_FILE", "NEMEIA_SCOPED_IDENTITY_FINGERPRINT"];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) return writeBlocked(`missing ${missing.join(", ")}`);
  if (!existsSync(adapterPath)) return writeBlocked(`adapter does not exist: ${adapterPath}`);
  assertLoopbackUri(process.env.NEMEIA_SPACETIMEDB_URI);
  const command = commandFromEnvironment();
  if (!command) return writeBlocked("NEMEIA_LOOPBACK_PROCESS is required so process restart is explicit");

  child = spawn(command[0], command.slice(1), { cwd: root, stdio: "inherit", detached: true });
  const adapterModule = await import(pathToFileURL(adapterPath).href);
  if (typeof adapterModule.createLoopbackAdapter !== "function") throw new Error("loopback adapter must export createLoopbackAdapter");
  const world = await adapterModule.createLoopbackAdapter({
    modulePath: resolve(process.env.NEMEIA_WORLD_CLIENT_MODULE),
    uri: process.env.NEMEIA_SPACETIMEDB_URI,
    scopedIdentityFile: resolve(process.env.NEMEIA_SCOPED_IDENTITY_FILE),
    scopedIdentityFingerprint: process.env.NEMEIA_SCOPED_IDENTITY_FINGERPRINT,
    processHandle: child
  });
  try {
    const g1 = await runLoopbackBackpackQualification({ world, fixture });
    const g3 = await runLoopbackSoftwareQualification({ world, fixture });
    await writeQualificationReport(resolve(reportDirectory, "g1-loopback.json"), g1.report);
    await writeQualificationReport(resolve(reportDirectory, "g3-loopback.json"), g3.report);
    if (!g1.report.claimable || !g3.report.claimable) {
      console.error("loopback qualification produced non-claimable evidence");
      process.exitCode = 2;
    } else {
      console.log("loopback qualification: G1 and G3 reports are claimable");
    }
  } finally {
    await world.close();
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => { cleanup(); process.exit(130); });
}
try {
  await main();
} catch (error) {
  await writeBlocked(error instanceof Error ? error.message : String(error));
  process.exitCode = process.exitCode || 1;
} finally {
  cleanup();
}
