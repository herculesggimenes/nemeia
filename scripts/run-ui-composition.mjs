import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPassedReport, qualifiedG2Release } from "./qualification-sequence.mjs";
import { writeQualificationReport } from "./qualification-provenance.mjs";
import { archiveNativeBrowserEvidence } from "./browser-evidence.mjs";
import { ownedProcessTree, signalOwnedGroup } from "./owned-process-tree.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const compositionBase = resolve(root, process.env.NEMEIA_UI_COMPOSITION_DIR ?? ".artifacts/qualification/ui-composition");
const compositionRoot = join(compositionBase, `composition-${process.pid}-${Date.now()}`);
const reportDirectory = join(compositionRoot, "qualification");
const runDirectory = join(compositionRoot, `run-${process.pid}`);
const handoffPath = join(compositionBase, "handoff.json");
const children = new Set();
const verify = process.argv.includes("--verify");
if (process.argv.slice(2).some((arg) => arg !== "--verify")) throw new Error("Supported option: --verify");
const reports = {};
const processTree = ownedProcessTree();
let cleanupEvidence;
const treeTimer = setInterval(() => { processTree.capture().catch((error) => {
  failure ??= error.message; stopping = true; finishHold();
}); }, 1000);
treeTimer.unref();
let failure;
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"].includes(key)));
let cleaned = false;
let stopping = false;
let finishHold;
const hold = new Promise((resolveHold) => { finishHold = resolveHold; });
const sharedHandoffPath = join(root, ".artifacts/qualification/current-handoff.json");

function assertRunning() {
  if (stopping) throw new Error("owned UI composition is stopping");
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => {
  stopping = true;
  finishHold();
});

async function privateJson(pathname, value) {
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(pathname, 0o600);
}

function spawnOwned(command, args, env, stdio = "inherit") {
  assertRunning();
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio,
  });
  children.add(child);
  if (child.pid) child.ownedIdentity = processTree.add(child.pid);
  child.ownedIdentity?.catch((error) => { failure ??= error.message; stopping = true; finishHold(); });
  // Retain process groups until cleanup, including a child whose descendants
  // briefly outlive it. Never discover or kill a process by port.
  child.once("error", () => { stopping = true; finishHold(); });
  return child;
}

function waitForChild(child) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: null });
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function stopOwned(child) {
  if (!child?.pid) return;
  const identity = await child.ownedIdentity;
  if (!await signalOwnedGroup(identity, "SIGTERM")) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (!await signalOwnedGroup(identity, 0)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  await signalOwnedGroup(identity, "SIGKILL");
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  stopping = true;
  clearInterval(treeTimer);
  await processTree.capture();
  for (const pathname of [handoffPath, sharedHandoffPath]) {
    try {
      const value = JSON.parse(await readFile(pathname, "utf8"));
      if ((value.runDirectory ?? value.localSimulationRunDirectory) === runDirectory) {
        await privateJson(pathname, { ...value, available: false, phase: "closed" });
      }
    } catch (error) { if (error.code !== "ENOENT") console.error(`[ui-composition] handoff cleanup: ${error.message}`); }
  }
  // Stop consumers before their database. Each child receives time to drain
  // its own nested Eve/browser/controller processes before escalation.
  for (const child of [...children].reverse()) await stopOwned(child);
  cleanupEvidence = await processTree.close();
  children.clear();
}

async function runPhase(name, script, args, env, timeoutMs) {
  const logPath = join(compositionRoot, `${name}.log`);
  const log = await open(logPath, "wx", 0o600);
  const startedAt = Date.now();
  const child = spawnOwned(process.execPath, [join(root, script), ...args], env, ["ignore", log.fd, log.fd]);
  await log.close();
  let timer;
  try {
    const result = await Promise.race([
      waitForChild(child), hold.then(() => { throw new Error("composition stopped"); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} exceeded ${timeoutMs}ms; log ${logPath}`)), timeoutMs); }),
    ]);
    if (result.code !== 0) throw new Error(`${name} failed (exit ${result.code}, signal ${result.signal}); log ${logPath}`);
    return { ...result, logPath, startedAt };
  } catch (error) {
    await stopOwned(child);
    throw error;
  } finally { clearTimeout(timer); }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (!port) throw new Error("frontend loopback port reservation failed");
  return port;
}

async function waitForFile(pathname, child, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertRunning();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("owned simulation exited before its handoff");
    try {
      const value = JSON.parse(await readFile(pathname, "utf8"));
      if (value?.runDirectory === runDirectory && value?.endpoint && value?.resourceRoot && value?.worldClientCredentialFile) return value;
    } catch {
      // The held local simulation has not finished its bootstrap report yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("held local simulation did not publish a private composition handoff");
}

async function waitForHttp(child, url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertRunning();
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("owned frontend exited before readiness");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000), redirect: "error" });
      if (response.ok && child.exitCode === null && child.signalCode === null) return;
    } catch {
      // The owned frontend child is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("frontend loopback child did not become ready");
}

async function main() {
  if (process.env.NEXT_PUBLIC_NEMEIA_WORLD_OPERATOR_TOKEN) throw new Error("public operator credentials are forbidden");
  try {
    const previous = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
    if (previous.available) throw new Error("another owned composition is available; close it before a fresh run");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(compositionRoot, { recursive: true, mode: 0o700 });
  const simulation = spawnOwned(process.execPath, [resolve(root, "scripts/run-local-simulation.mjs")], {
    ...environment,
    NEMEIA_HOLD_LOCAL_SIMULATION: "1",
    NEMEIA_DEFER_G3: "1",
    NEMEIA_QUALIFICATION_REPORT_DIR: reportDirectory,
    NEMEIA_LOCAL_SIMULATION_RUN_DIR: runDirectory,
  });
  simulation.once("exit", () => {
    if (!cleaned && !stopping) process.exitCode = 1;
    stopping = true; finishHold();
  });
  const composition = await waitForFile(join(reportDirectory, "composition.json"), simulation);
  if (simulation.exitCode !== null) throw new Error("held local simulation exited before UI handoff");
  const g1Path = join(reportDirectory, "g1-loopback.json");
  reports.G1 = (await readPassedReport(g1Path, { gate: "G1", runDirectory })).path;
  const qualificationRunId = `g2-${process.pid}-${Date.now()}`;
  const qualificationEnv = {
    ...environment,
    NEMEIA_CURRENT_HANDOFF_FILE: resolve(root, ".artifacts/qualification/current-handoff.json"),
    NEMEIA_QUALIFICATION_HANDOFF: resolve(root, ".artifacts/qualification/current-handoff.json"),
    NEMEIA_QUALIFICATION_REPORT_DIR: reportDirectory,
    NEMEIA_QUALIFICATION_RUN_ID: qualificationRunId,
    NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "nemeia-g2-loopback:eve-owner-g2-loopback",
    NEMEIA_WORLD_AUTH_ISSUER: "nemeia-g2-loopback",
    NEMEIA_WORLD_AUTH_SUBJECT: "eve-owner-g2-loopback",
    NEMEIA_AGENT_LEDGER: join(runDirectory, "g2-agent.sqlite"),
    NEMEIA_G2_GATE_FILE: join(runDirectory, "g2-complete.json"),
  };
  const frontendPort = await freePort();
  const frontend = spawnOwned(process.execPath, [fileURLToPath(import.meta.resolve("next/dist/bin/next")), "dev", "frontend", "--hostname", "127.0.0.1", "--port", String(frontendPort)], {
    ...environment,
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_URI: composition.endpoint,
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_DATABASE: composition.databaseName,
    NEMEIA_SPACETIMEDB_URI: composition.endpoint,
    NEMEIA_SPACETIMEDB_DATABASE: composition.databaseName,
    NEMEIA_WORLD_RESOURCE_ROOT: composition.resourceRoot,
  });
  frontend.once("exit", () => {
    if (!cleaned && !stopping) process.exitCode = 1;
    stopping = true; finishHold();
  });
  const frontendUrl = `http://127.0.0.1:${frontendPort}`;
  await waitForHttp(frontend, `${frontendUrl}/missions`);
  const handoff = {
    schemaVersion: 1,
    mode: "held-ui-loopback",
    available: true,
    phase: "g2-held",
    ownerPid: process.pid,
    loopbackOnly: true,
    fixtureKind: "synthetic",
    physicalActuation: false,
    frontendUrl,
    missionUrl: `${frontendUrl}/missions`,
    worldUri: composition.endpoint,
    databaseName: composition.databaseName,
    resourceRoot: composition.resourceRoot,
    operatorCredentialFile: composition.operatorClientCredentialFile ?? composition.worldClientCredentialFile,
    browserAuth: "enter the scoped operator credential in the password field; no browser bundle or public environment variable contains it",
    localSimulationRunDirectory: runDirectory,
    mutationOrder: "G1 restart, G2, automatic wake, G3, then UI; do not use browser write controls until UI-ready",
    qualificationReportDirectory: reportDirectory,
  };
  await privateJson(handoffPath, handoff);
  console.error(`[ui-composition] SYNTHETIC / NO MOTION: ${handoff.missionUrl}; private handoff ${handoffPath}`);
  await runPhase("g2", "scripts/run-eve-qualification.mjs", [], qualificationEnv, 300_000);
  const g2Path = join(reportDirectory, "g2-eve.json");
  reports.G2 = (await readPassedReport(g2Path, { gate: "G2", runDirectory, qualificationRunId })).path;
  await privateJson(handoffPath, { ...handoff, phase: "automatic-wake-running" });
  await runPhase("automatic-wake", "scripts/run-automatic-wake-qualification.mjs", [], qualificationEnv, 300_000);
  const automaticPath = join(reportDirectory, "automatic-wake.json");
  const release = await qualifiedG2Release({ runDirectory, qualificationRunId, standardPath: g2Path, automaticPath });
  reports.automaticWake = automaticPath;
  // This marker is written only after both independent reports pass. The G3
  // consumer reopens and hashes those same reports before any mutation.
  await privateJson(join(runDirectory, "g2-complete.json"), release);
  await privateJson(handoffPath, { ...handoff, phase: "g3-running" });
  await runPhase("g3", "scripts/run-held-g3.mjs", [], qualificationEnv, 360_000);
  const current = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
  if (current.runDirectory !== runDirectory || !current.g3ReportPath) throw new Error("G3 did not release this fixture to the UI");
  reports.G3 = (await readPassedReport(current.g3ReportPath, { gate: "G3", runDirectory })).path;
  await privateJson(handoffPath, { ...handoff, phase: "g3-complete-ui-ready" });
  if (verify) {
    const browser = await runPhase("native-e7", "frontend/scripts/verify-native-ui.mjs", ["--mutate"],
      { ...qualificationEnv, NEMEIA_UI_URL: frontendUrl }, 180_000);
    const browserEvidence = await archiveNativeBrowserEvidence({
      logPath: browser.logPath, exitCode: browser.code, startedAt: browser.startedAt,
      sourceDirectory: join(root, "frontend/test-results/native-e7"), destination: join(compositionRoot, "native-e7"),
    });
    reports.E7 = join(reportDirectory, "native-e7.json");
    await writeQualificationReport(reports.E7, {
      gate: "E7", result: "pass", claimable: true, checks: browserEvidence.checks,
      details: { runDirectory, ...browserEvidence },
    });
    return;
  }
  console.error(`[ui-composition] G1/G2/automatic wake/G3 passed; UI writes may now begin: ${handoff.missionUrl}`);
  if ([simulation, frontend].some((child) => child.exitCode !== null || child.signalCode !== null)) return;
  await hold;
}

try {
  await main();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  if (!stopping) {
    console.error(`UI composition failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    if (!verify) {
      console.error("[ui-composition] failed gate retained for diagnosis; Ctrl-C stops owned services");
      await hold;
    }
  }
} finally {
  try { await cleanup(); } catch (error) {
    failure ??= `owned cleanup failed: ${error.message}`;
    process.exitCode = 1;
  }
  if (verify) {
    const expected = ["G1", "G2", "automaticWake", "G3", "E7"];
    const checks = Object.fromEntries(expected.map((gate) => [gate, typeof reports[gate] === "string"]));
    const passed = !failure && Object.values(checks).every(Boolean) && !process.exitCode;
    await writeQualificationReport(join(compositionRoot, "verification.json"), {
      gate: "software-composition", result: passed ? "pass" : "fail", claimable: passed, checks,
      details: { runDirectory, reports, failure, ownedCleanupCompleted: cleanupEvidence?.verifiedStopped === true, cleanupEvidence,
        safety: { synthetic: true, physicalActuation: false, paidInference: false, robotAccess: false } },
    });
    if (!passed) process.exitCode = 1;
    console.error(`[ui-composition] verification report: ${join(compositionRoot, "verification.json")}`);
  }
}
