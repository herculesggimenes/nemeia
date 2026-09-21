import { mkdir, open, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { join, resolve } from "node:path";
import { checkConfiguredCompilerImports } from "./eve-compiler-import-smoke.mjs";
import { captureQualificationProvenance } from "./qualification-provenance.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const artifactRoot = join(root, ".artifacts/qualification/eve-packaging");
const artifactDirectory = join(artifactRoot, `run-${process.pid}-${Date.now()}`);
await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
// This identifier is a static example in the installed Eve agent-config.md,
// not a qualified Nemeia deployment choice. The smoke never submits a session.
const packagingModel = process.env.NEMEIA_PACKAGING_MODEL ?? "openai/gpt-5.5";
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "C.UTF-8",
  NODE_ENV: "production",
  EVE_TELEMETRY_DISABLED: "1",
  EVE_TRACES: "off",
  OTEL_SDK_DISABLED: "true",
  NEMEIA_INSTRUMENTATION_MODE: "local-noop",
  // Discovery/build only: no prompt, session, model invocation, or provider key.
  NEMEIA_EVE_MODEL: packagingModel,
  NEMEIA_AGENT_LEDGER: join(artifactDirectory, "packaging-ledger.sqlite"),
};
const children = new Set();

async function launch(name, args, extraEnvironment = {}) {
  const logfile = join(artifactDirectory, `${name}.log`);
  const log = await open(logfile, "w", 0o600);
  const child = spawn(process.execPath, [join(root, "node_modules/eve/bin/eve.js"), ...args], {
    cwd: root, env: { ...env, ...extraEnvironment }, stdio: ["ignore", log.fd, log.fd], detached: true,
  });
  children.add(child);
  await log.close();
  child.completion = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit({ code, signal, logfile }));
  });
  // Health polling observes early exit; retain the rejection for the awaiter.
  child.completion.catch(() => {});
  return { child, logfile };
}

async function stop(child) {
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  let timeout;
  await Promise.race([child.completion.catch(() => {}), new Promise((resolveWait) => { timeout = setTimeout(resolveWait, 5000); })]);
  clearTimeout(timeout);
  try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  await child.completion.catch(() => {});
  children.delete(child);
}

async function run(name, args, extraEnvironment = {}, timeoutMs = 120_000) {
  const { child } = await launch(name, args, extraEnvironment);
  const timeout = setTimeout(() => { void stop(child); }, timeoutMs);
  try { return await child.completion; }
  finally { clearTimeout(timeout); await stop(child); }
}

async function smoke(command) {
  const reservation = net.createServer();
  await new Promise((resolveListen, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolveListen); });
  const port = reservation.address().port;
  await new Promise((resolveClose, reject) => reservation.close((error) => error ? reject(error) : resolveClose()));
  const { child, logfile } = await launch(`${command}-health`, [command, "--host", "127.0.0.1", "--port", String(port), ...(command === "dev" ? ["--no-ui"] : [])]);
  const healthUrl = `http://127.0.0.1:${port}/eve/v1/health`;
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${command} exited before readiness; see ${logfile}`);
      try {
        const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
        if (response.ok && child.exitCode === null && child.signalCode === null) return { result: "pass", healthUrl, logfile };
      } catch { /* Wait only for our owned loopback process. */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`${command} readiness timed out; see ${logfile}`);
  } finally { await stop(child); }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, async () => {
  await Promise.all([...children].map(stop));
  process.exit(130);
});
let report;
try {
  const configuredCompilerImports = await checkConfiguredCompilerImports({ artifactDirectory, run });
  const discovery = await run("discovery", ["info", "--json"]);
  const build = discovery.code === 0 ? await run("build", ["build"]) : undefined;
  const dev = build?.code === 0 ? await smoke("dev") : undefined;
  const start = dev?.result === "pass" ? await smoke("start") : undefined;
  report = {
    schemaVersion: 1, projectRoot: root, authoredAgentRoot: join(root, "agent"),
    result: configuredCompilerImports.result === "pass" && discovery.code === 0 && build?.code === 0 && dev?.result === "pass" && start?.result === "pass" ? "pass" : "blocked",
    configuredCompilerImports, discovery, build, dev, start,
    packagingModel, deploymentModelQualified: false,
    paidInference: false, modelInvocations: 0, databaseMutation: false,
  };
} catch (error) {
  report = { result: "blocked", reason: error.message, projectRoot: root };
} finally { await Promise.all([...children].map(stop)); }
const reportPath = join(artifactDirectory, "report.json");
const provenance = await captureQualificationProvenance(join(artifactDirectory, "provenance"));
report = { ...report, versions: provenance.versions, qualificationProvenance: { path: provenance.path, sha256: provenance.sha256 } };
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
// Keep prior packaging evidence immutable; update only a path-only latest pointer.
await writeFile(join(artifactRoot, "latest.json"), `${JSON.stringify({ reportPath, result: report.result })}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...report, reportPath }));
if (report.result !== "pass") process.exitCode = 2;
