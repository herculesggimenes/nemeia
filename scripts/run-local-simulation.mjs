import { chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { createWriteStream, openSync } from "node:fs";
import { register } from "node:module";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import net from "node:net";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { provisionSpacetimeDb } from "./provision-spacetimedb.mjs";
import { createBackpackFixture } from "../conformance/src/backpack-fixture.ts";
import { createQualificationReport } from "../conformance/src/qualification-report.ts";
import { writeQualificationReport } from "./qualification-provenance.mjs";
import { canonicalJson } from "../world-client/src/json.ts";
import { createAuthorizedPerception, createFreshG3Fixture, runAssignedG3Flow } from "./g3-composition.mjs";
import { qualifyOperatorMissionExpiry, startOperatorMissionTicker } from "./operator-mission-ticker.mjs";
import { hasCurrentG2Release } from "./composition-guards.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
// The generated SDK emitted by SpacetimeDB 2.10.1 uses extensionless local
// imports. Register the test-only resolver before loading the controller/Eve
// TypeScript composition; source files and generated output remain unchanged.
register(pathToFileURL(resolve(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const reportDirectory = resolve(root, process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? `.artifacts/qualification/local-simulation/composition-${process.pid}-${Date.now()}`);
const sharedHandoffPath = resolve(root, ".artifacts/qualification/current-handoff.json");
let serverPort;
let endpoint;
const databaseName = "nemeia-local-loopback";
const fixture = createBackpackFixture();
const deferG3 = process.env.NEMEIA_DEFER_G3 === "1";
let qualificationFixtureDigest = fixture.fixtureDigest;
let g3Outcome;
let activeRunDirectory;
let moduleBuildHash;
let schemaFingerprint;
let operatorTicker;
const children = new Set();
const adapters = new Set();
let cleaned = false;

function assertLoopback() {
  const hostname = new URL(endpoint).hostname;
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) throw new Error("local composition refuses a non-loopback endpoint");
}

function localEnv(runDirectory) {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(runDirectory, "xdg-config"),
    XDG_DATA_HOME: join(runDirectory, "xdg-data"),
    XDG_STATE_HOME: join(runDirectory, "xdg-state"),
  };
}

function cliArguments(runDirectory, args) {
  const cliRoot = join(runDirectory, "cli-root");
  const cliConfig = join(cliRoot, "cli.toml");
  return ["--root-dir", cliRoot, "--config-path", cliConfig, ...args];
}

function cliConfigPath(runDirectory) {
  return join(runDirectory, "cli-root", "cli.toml");
}

async function publisherCredential(runDirectory) {
  const pathname = cliConfigPath(runDirectory);
  const config = await readFile(pathname, "utf8");
  await chmod(pathname, 0o600);
  const match = config.match(/^spacetimedb_token\s*=\s*"([^"]+)"\s*$/m);
  if (!match) throw new Error("isolated CLI publish did not retain a publisher token");
  const token = match[1];
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  if (typeof payload.hex_identity !== "string") throw new Error("isolated publisher token has no scoped identity claim");
  return { token, identityFingerprint: createHash("sha256").update(payload.hex_identity).digest("hex"), identity: payload.hex_identity };
}

async function writeJson(pathname, value) {
  await mkdir(resolve(pathname, ".."), { recursive: true, mode: 0o700 });
  await writeFile(pathname, `${JSON.stringify(JSON.parse(canonicalJson(value)), null, 2)}\n`, { mode: 0o600 });
  await chmod(pathname, 0o600);
}

function digestFixture(value) {
  const encoded = JSON.stringify(value, (_key, entry) => {
    if (typeof entry === "bigint") return entry.toString(10);
    if (entry instanceof Uint8Array) return Array.from(entry);
    return entry;
  });
  return createHash("sha256").update(encoded).digest("hex");
}

function sameTimestamp(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  return Number.isFinite(leftMillis) && leftMillis === rightMillis;
}

function boundedReadLength(value) {
  const length = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(length) || length <= 0) throw new Error("resource byteLength is not safe for bounded local IO");
  return length;
}

function resourceBoundary(resource) {
  return {
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: String(resource.byteLength),
  };
}

async function readFullResource(gateway, reader, resource) {
  const length = boundedReadLength(resource.byteLength);
  return gateway.read(reader, resourceBoundary(resource), { offset: 0, length });
}

function resourceErrorCode(error) {
  return typeof error?.code === "string" ? error.code : undefined;
}

function bytesEqual(left, right) {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function sameProjectionIdentity(left, right) {
  const sorted = (values) => [...values].sort();
  return JSON.stringify(sorted(left.entityIds)) === JSON.stringify(sorted(right.entityIds))
    && JSON.stringify(sorted(left.observationIds)) === JSON.stringify(sorted(right.observationIds))
    && JSON.stringify(sorted(left.mapRevisionIds)) === JSON.stringify(sorted(right.mapRevisionIds))
    && JSON.stringify(sorted(left.resourceIds)) === JSON.stringify(sorted(right.resourceIds))
    && sameTimestamp(left.recordedAcquisitionAt, right.recordedAcquisitionAt);
}

async function publicPublisherFingerprint(runDirectory) {
  for (const pathname of [
    join(runDirectory, "cli-root", "id_ecdsa.pub"),
    join(runDirectory, "cli-root", "spacetime", "id_ecdsa.pub"),
    join(runDirectory, "cli-root", "config", "id_ecdsa.pub"),
    join(runDirectory, "xdg-config", "spacetime", "id_ecdsa.pub"),
  ]) {
    try {
      const publicKey = await readFile(pathname);
      return { path: pathname, fingerprint: createHash("sha256").update(publicKey).digest("hex") };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function runLogged(command, args, { cwd, env, logPath }) {
  return new Promise((resolveResult, reject) => {
    const output = openSync(logPath, "w", 0o600);
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", output, output] });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveResult({ code: code ?? 1, signal }));
  });
}

function portIsOccupied(port) {
  return new Promise((resolveResult, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolveResult(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error?.code === "ECONNREFUSED" || error?.code === "EHOSTUNREACH") resolveResult(false);
      else reject(error);
    });
  });
}

async function assertPortAvailable(port) {
  if (await portIsOccupied(port)) {
    throw new Error(`loopback port ${port} is already occupied; refusing to reuse or kill an existing process`);
  }
}

async function chooseLoopbackPort() {
  if (process.env.NEMEIA_SPACETIMEDB_PORT !== undefined) {
    const requested = Number(process.env.NEMEIA_SPACETIMEDB_PORT);
    if (!Number.isInteger(requested) || requested < 1024 || requested > 65535) {
      throw new Error("NEMEIA_SPACETIMEDB_PORT must be an integer between 1024 and 65535");
    }
    await assertPortAvailable(requested);
    return { port: requested, requested: true };
  }

  // Reserve an ephemeral loopback port long enough to prove that the default
  // launcher is not selecting a known shared port. The child is then checked
  // for liveness and readiness before any generated client connects.
  const reservation = net.createServer();
  await new Promise((resolveListen, rejectListen) => {
    reservation.once("error", rejectListen);
    reservation.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("failed to reserve a loopback port");
  }
  const port = address.port;
  await new Promise((resolveClose, rejectClose) => reservation.close((error) => error ? rejectClose(error) : resolveClose()));
  await assertPortAvailable(port);
  return { port, requested: false };
}

async function waitForHealth(server) {
  const readinessDeadline = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("SpacetimeDB owned listener readiness timeout")), 20_000);
    timer.unref();
  });
  await Promise.race([server.readyPromise, readinessDeadline]);
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== undefined) throw new Error(`SpacetimeDB child exited before readiness: ${server.exitCode}`);
    try {
      const response = await fetch(`${endpoint}/v1/health`);
      if (response.ok) return await response.json();
      lastError = new Error(`health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`SpacetimeDB did not become healthy: ${lastError?.message ?? "timeout"}`);
}

function startServer(cliPath, runDirectory, env) {
  const stdout = createWriteStream(join(runDirectory, "server.stdout.log"), { flags: "a", mode: 0o600 });
  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const child = spawn(cliPath, cliArguments(runDirectory, [
    "start",
    "--listen-addr", `127.0.0.1:${serverPort}`,
    "--data-dir", join(runDirectory, "spacetime-data"),
    "--non-interactive",
  ]), { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.exitCode = undefined;
  child.readyPromise = readyPromise;
  child.ready = false;
  const consumeOutput = (chunk) => {
    stdout.write(chunk);
    if (!child.ready && chunk.toString().includes(`Starting SpacetimeDB listening on 127.0.0.1:${serverPort}`)) {
      child.ready = true;
      readyResolve();
    }
  };
  child.stdout.on("data", consumeOutput);
  child.stderr.on("data", consumeOutput);
  child.once("error", (error) => readyReject(error));
  child.once("exit", (code, signal) => {
    child.exitCode = code ?? signal ?? 1;
    if (!child.ready) readyReject(new Error(`SpacetimeDB child exited before its owned listener became ready: ${child.exitCode}`));
    stdout.end();
  });
  children.add(child);
  return child;
}

async function stopProcess(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { process.kill(-child.pid, 0); } catch (error) { if (error?.code === "ESRCH") return; throw error; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await operatorTicker?.close();
  try {
    const handoff = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
    if (activeRunDirectory && handoff.runDirectory === activeRunDirectory) {
      await writeJson(sharedHandoffPath, { ...handoff, available: false, phase: "closed" });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`[local-simulation] handoff close update failed: ${error?.message ?? error}`);
  }
  for (const adapter of adapters) {
    try { await adapter.close(); } catch { /* cleanup must still stop the owned child */ }
  }
  adapters.clear();
  for (const child of children) await stopProcess(child);
  children.clear();
}

async function holdCompositionUntilSignal() {
  if (process.env.NEMEIA_HOLD_LOCAL_SIMULATION !== "1") return;
  console.error(`[local-simulation] held loopback composition on ${endpoint}; credentials remain in the private run directory`);
  await new Promise((resolveHold) => {
    const finish = () => resolveHold();
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    process.once("SIGHUP", finish);
  });
}

async function waitForG2Completion() {
  const gatePath = process.env.NEMEIA_G2_GATE_FILE;
  if (!gatePath) return undefined;
  console.error(`[local-simulation] waiting for the actual G2 run before starting G3; gate file ${gatePath}`);
  for (;;) {
    try {
      const gate = JSON.parse(await readFile(resolve(gatePath), "utf8"));
      if (hasCurrentG2Release(gate, activeRunDirectory)) return gate;
    } catch {
      // The held G2 child has not published its completion marker yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

async function blockedReports(reason, details = {}) {
  const common = {
    mode: "loopback-spacetimedb",
    requestedResult: "blocked",
    fixtureDigest: qualificationFixtureDigest,
    checks: { composition: false },
    details: { reason, endpoint, serverPort, ...details },
  };
  for (const gate of ["G1", "G3"]) {
    try { await writeQualificationReport(join(reportDirectory, `${gate.toLowerCase()}-loopback.json`), createQualificationReport({ gate, ...common })); }
    catch (error) { if (error.code !== "EEXIST") throw error; } // Never erase a completed earlier gate.
  }
  await writeJson(join(reportDirectory, "composition.json"), {
    schemaVersion: 1,
    result: "blocked",
    reason,
    endpoint,
    serverPort,
    fixtureDigest: qualificationFixtureDigest,
    details,
  });
}

async function ensureGeneratedDependency(generatedDirectory) {
  const moduleNodeModules = join(generatedDirectory, "node_modules");
  const packageLink = join(moduleNodeModules, "spacetimedb");
  await mkdir(moduleNodeModules, { recursive: true, mode: 0o700 });
  try {
    await symlink(resolve(fileURLToPath(import.meta.resolve("spacetimedb")), "../.."), packageLink, "dir");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const generatedFiles = (await readdir(generatedDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"));
  for (const entry of generatedFiles) {
    const pathname = join(generatedDirectory, entry.name);
    const source = await readFile(pathname, "utf8");
    const rewritten = source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return /\.[cm]?[jt]sx?$/.test(specifier) ? `${prefix}${specifier}${suffix}` : `${prefix}${specifier}.ts${suffix}`;
    }).replace(/(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => {
      return /\.[cm]?[jt]sx?$/.test(specifier) ? `${prefix}${specifier}${suffix}` : `${prefix}${specifier}.ts${suffix}`;
    });
    if (rewritten !== source) await writeFile(pathname, rewritten, "utf8");
  }
}

async function main() {
  const selectedPort = await chooseLoopbackPort();
  serverPort = selectedPort.port;
  endpoint = `http://127.0.0.1:${serverPort}`;
  assertLoopback();
  await mkdir(reportDirectory, { recursive: true, mode: 0o700 });
  const runDirectory = resolve(process.env.NEMEIA_LOCAL_SIMULATION_RUN_DIR ?? join(reportDirectory, `run-${process.pid}`));
  activeRunDirectory = runDirectory;
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeJson(sharedHandoffPath, {
    schemaVersion: 1,
    phase: "bootstrapping",
    available: false,
    runDirectory,
  });
  const env = localEnv(runDirectory);
  const toolchain = await provisionSpacetimeDb({ cacheDirectory: resolve(root, ".artifacts/toolcache/spacetimedb-2.10.1") });
  await assertPortAvailable(serverPort);
  let server = startServer(toolchain.cliPath, runDirectory, env);
  await waitForHealth(server);

  const modulePath = resolve(root, "contracts/spacetimedb");
  const buildResult = await runLogged(toolchain.cliPath, cliArguments(runDirectory, ["build", "--module-path", modulePath]), {
    cwd: root, env, logPath: join(runDirectory, "build.log"),
  });
  if (buildResult.code !== 0) {
    await blockedReports("module-build-failed", {
      cliVersion: toolchain.cliVersion,
      cliPath: toolchain.cliPath,
      serverPath: toolchain.standalonePath,
      releaseUrl: toolchain.releaseUrl,
      releaseSha256: toolchain.releaseSha256,
      dataDirectory: join(runDirectory, "spacetime-data"),
      buildLog: join(runDirectory, "build.log"),
      command: `${toolchain.cliPath} build --module-path ${modulePath}`,
      exitCode: buildResult.code,
    });
    return 2;
  }
  moduleBuildHash = createHash("sha256").update(await readFile(join(modulePath, "dist/bundle.js"))).digest("hex");
  schemaFingerprint = createHash("sha256").update(await readFile(resolve(root, "conformance/contract-manifest.json"))).digest("hex");

  const publishResult = await runLogged(toolchain.cliPath, cliArguments(runDirectory, [
    "publish", databaseName,
    "--server", endpoint,
    "--module-path", modulePath,
    "--yes=remote,skip-login,migrate,break-clients",
    "--no-config",
  ]), { cwd: root, env, logPath: join(runDirectory, "publish.log") });
  if (publishResult.code !== 0) {
    await blockedReports("module-publish-failed", {
      publishLog: join(runDirectory, "publish.log"),
      command: `${toolchain.cliPath} publish ${databaseName} --server ${endpoint} --module-path ${modulePath} --yes=remote,skip-login,migrate,break-clients --no-config`,
      exitCode: publishResult.code,
    });
    return 2;
  }

  const generatedDirectory = resolve(runDirectory, "generated-module-bindings");
  await mkdir(generatedDirectory, { recursive: true, mode: 0o700 });
  const generateResult = await runLogged(toolchain.cliPath, cliArguments(runDirectory, [
    "generate", databaseName,
    "--lang", "typescript",
    "--out-dir", generatedDirectory,
    "--module-path", modulePath,
    "--include-private",
    "--yes",
    "--no-config",
  ]), { cwd: root, env, logPath: join(runDirectory, "generate.log") });
  if (generateResult.code !== 0) {
    await blockedReports("client-generation-failed", {
      generateLog: join(runDirectory, "generate.log"),
      command: `${toolchain.cliPath} generate ${databaseName} --lang typescript --out-dir ${generatedDirectory} --module-path ${modulePath} --include-private --yes --no-config`,
      exitCode: generateResult.code,
    });
    return 2;
  }
  await ensureGeneratedDependency(generatedDirectory);

  const identityFile = join(runDirectory, "credentials", "world-client.token");
  const fingerprintFile = join(runDirectory, "credentials", "world-client.identity-fingerprint");
  const publisherCredentialState = await publisherCredential(runDirectory);
  await mkdir(resolve(identityFile, ".."), { recursive: true, mode: 0o700 });
  await writeFile(identityFile, `${publisherCredentialState.token}\n`, { mode: 0o600 });
  await chmod(identityFile, 0o600);
  const { createLoopbackAdapter } = await import(pathToFileURL(resolve(root, "conformance/src/loopback-adapter.ts")).href);
  const processSupervisor = {
    restart: async () => {
      await stopProcess(server);
      children.delete(server);
      server = startServer(toolchain.cliPath, runDirectory, env);
      await waitForHealth(server);
    },
  };
  const world = await createLoopbackAdapter({
    modulePath: generatedDirectory,
    uri: endpoint,
    databaseName,
    scopedIdentityFile: identityFile,
    scopedIdentityFingerprint: publisherCredentialState.identityFingerprint,
    processSupervisor,
  });
  adapters.add(world);
  await world.start();
  await writeFile(fingerprintFile, `${await world.getScopedIdentityFingerprint()}\n`, { mode: 0o600 });
  await chmod(fingerprintFile, 0o600);

  const perceptionIdentityFile = join(runDirectory, "credentials", "perception-client.token");
  const perceptionFingerprintFile = join(runDirectory, "credentials", "perception-client.identity-fingerprint");
  const perception = await createLoopbackAdapter({
    modulePath: generatedDirectory,
    uri: endpoint,
    databaseName,
    scopedIdentityFile: perceptionIdentityFile,
    processSupervisor,
  });
  adapters.add(perception);
  await perception.start();
  const perceptionIdentity = await perception.getIdentity();
  const controllerIdentityFile = join(runDirectory, "credentials", "controller-client.token");
  const controllerFingerprintFile = join(runDirectory, "credentials", "controller-client.identity-fingerprint");
  const controller = await createLoopbackAdapter({
    modulePath: generatedDirectory,
    uri: endpoint,
    databaseName,
    scopedIdentityFile: controllerIdentityFile,
    processSupervisor,
  });
  adapters.add(controller);
  await controller.start();
  const controllerIdentity = await controller.getIdentity();
  await writeFile(controllerFingerprintFile, `${await controller.getScopedIdentityFingerprint()}\n`, { mode: 0o600 });
  await chmod(controllerFingerprintFile, 0o600);
  await world.callReducer("configureMember", {
    identity: controllerIdentity,
    role: { tag: "Controller" },
    unitId: "entity-go2-001",
    producerSession: undefined,
    package: undefined,
  });
  await world.callReducer("configureUnit", {
    unitId: "entity-go2-001",
    displayName: "Go2 simulation unit",
    controllerIdentity,
  });
  const agentIdentityFile = join(runDirectory, "credentials", "agent-client.token");
  const agentFingerprintFile = join(runDirectory, "credentials", "agent-client.identity-fingerprint");
  const agent = await createLoopbackAdapter({
    modulePath: generatedDirectory,
    uri: endpoint,
    databaseName,
    scopedIdentityFile: agentIdentityFile,
    processSupervisor,
  });
  adapters.add(agent);
  await agent.start();
  const agentIdentity = await agent.getIdentity();
  await world.callReducer("configureMember", {
    identity: agentIdentity,
    role: { tag: "Agent" },
    unitId: undefined,
    producerSession: undefined,
    package: undefined,
  });
  await world.callReducer("configureAgent", {
    agentId: "agent-g3-loopback-001",
    principal: agentIdentity,
    displayName: "G3 loopback agent",
    readScope: { worldId: "nemeia-local-world" },
    paused: false,
    expectedRevision: 0n,
  });
  await writeFile(agentFingerprintFile, `${await agent.getScopedIdentityFingerprint()}\n`, { mode: 0o600 });
  await chmod(agentFingerprintFile, 0o600);
  const operatorIdentityFile = join(runDirectory, "credentials", "operator-client.token");
  const operator = await createLoopbackAdapter({
    modulePath: generatedDirectory, uri: endpoint, databaseName,
    scopedIdentityFile: operatorIdentityFile, processSupervisor,
  });
  adapters.add(operator);
  await operator.start();
  const { bootstrapSimulationOperator } = await import("./bootstrap-simulation-operator.mjs");
  await bootstrapSimulationOperator({ admin: world, operator, unitId: "entity-go2-001", agentId: "agent-g3-loopback-001", seedGrant: true });
  await writeFile(perceptionFingerprintFile, `${await perception.getScopedIdentityFingerprint()}\n`, { mode: 0o600 });
  await chmod(perceptionFingerprintFile, 0o600);
  const { createSyntheticStandardFixture, SYNTHETIC_PNG_1X1_RGB } = await import(pathToFileURL(resolve(root, "perception/src/index.ts")).href);
  const standardFixture = createSyntheticStandardFixture({
    capturedAt: "2026-09-19T12:00:45.000Z",
    receivedAt: "2026-09-19T12:00:46.000Z",
    mapCapturedAt: "2026-09-19T12:00:46.000Z",
  });
  qualificationFixtureDigest = digestFixture(standardFixture);
  const capturedAt = standardFixture.samples[0]?.capturedAt;
  if (!capturedAt) throw new Error("standard synthetic fixture has no recorded acquisition timestamp");
  await world.callReducer("configureMember", {
    identity: perceptionIdentity,
    role: { tag: "Perception" },
    unitId: standardFixture.unitId,
    producerSession: standardFixture.producerSession,
    package: standardFixture.mapProduct.producer,
  });
  await perception.callReducer("registerSpatialFrame", {
    input: {
      frameId: standardFixture.spatialFrameId,
      sourceSession: standardFixture.producerSession,
      originEpoch: 0n,
      parentFrameId: undefined,
    },
  });
  await perception.callReducer("initializeLocalMap", {
    mapId: standardFixture.localMapId,
    unitId: standardFixture.unitId,
    rootFrameId: standardFixture.spatialFrameId,
  });

  const { ResourceGateway } = await import(pathToFileURL(resolve(root, "world-resources/src/index.ts")).href);
  const resourceCredentialFile = join(runDirectory, "credentials", "replay-producer.credential");
  const resourceCredential = Buffer.from("nemeia-local-replay-producer-credential-v1", "utf8");
  await writeFile(resourceCredentialFile, resourceCredential, { mode: 0o600 });
  await chmod(resourceCredentialFile, 0o600);
  const resourceRoot = join(runDirectory, "resource-gateway");
  const resourceBinding = {
    bindingId: "replay-binding-001",
    producerId: "replay-camera-001",
    producerSession: "replay-camera-001",
    unitId: "entity-go2-001",
    package: standardFixture.mapProduct.producer,
    credential: new Uint8Array(resourceCredential),
    allowedSchemas: ["image/png", "text/x.pcd", "application/json", "nemeia/native-map-manifest@1", "nemeia/native-map-evidence-index@1"],
    referenceCommitAdapter: { commitPublishedReferences: (request) => perception.commitPublishedReferences(request) },
  };
  const resourceGateway = await ResourceGateway.open({ root: resourceRoot, bindings: [resourceBinding] });
  const resourceSession = resourceGateway.authenticateWorker({ bindingId: "replay-binding-001", credential: new Uint8Array(resourceCredential) });
  const resourceReader = resourceGateway.createReader({ authorizeRead: () => true });
  perception.attachResourceGateway({ gateway: resourceGateway, session: resourceSession, reader: resourceReader });
  const ingestion = await perception.ingestStandardSyntheticFixture(standardFixture);
  // This is a path-only coordination artifact. It is written only after the
  // real module has enrolled all scoped principals and the standard fixture
  // has committed through the real gateway. Credential contents never enter
  // the artifact, logs, or browser environment.
  await writeJson(sharedHandoffPath, {
    schemaVersion: 1,
    phase: "seeded",
    available: true,
    moduleBuildHash,
    schemaFingerprint,
    uri: endpoint,
    databaseName,
    worldId: "nemeia-local-world",
    unitId: standardFixture.unitId,
    agentId: "agent-g3-loopback-001",
    adminTokenFile: identityFile,
    operatorTokenFile: operatorIdentityFile,
    agentTokenFile: agentIdentityFile,
    perceptionTokenFile: perceptionIdentityFile,
    controllerTokenFile: controllerIdentityFile,
    resourceRoot,
    runDirectory,
  });
  let operatorTickerEvidence;
  if (!deferG3) {
  if (process.env.NEMEIA_G2_GATE_FILE) {
    await writeJson(sharedHandoffPath, {
      schemaVersion: 1,
      phase: "g2-held",
      available: true,
      moduleBuildHash,
      schemaFingerprint,
      uri: endpoint,
      databaseName,
      worldId: "nemeia-local-world",
      unitId: standardFixture.unitId,
      agentId: "agent-g3-loopback-001",
      adminTokenFile: identityFile,
      operatorTokenFile: operatorIdentityFile,
      agentTokenFile: agentIdentityFile,
      perceptionTokenFile: perceptionIdentityFile,
      controllerTokenFile: controllerIdentityFile,
      resourceRoot,
      runDirectory,
    });
    await writeJson(join(reportDirectory, "composition.json"), {
      schemaVersion: 1,
      result: "held-before-g2",
      phase: "g2-held",
      endpoint,
      serverPort,
      databaseName,
      moduleBuildHash,
      schemaFingerprint,
      generatedDirectory,
      worldClientCredentialFile: identityFile,
      operatorClientCredentialFile: operatorIdentityFile,
      perceptionClientCredentialFile: perceptionIdentityFile,
      controllerClientCredentialFile: controllerIdentityFile,
      agentClientCredentialFile: agentIdentityFile,
      resourceRoot,
      runDirectory,
      fixtureDigest: qualificationFixtureDigest,
      safety: { loopbackOnly: true, robotAccess: false, paidInference: false, physicalActuation: false },
    });
    await waitForG2Completion();
    const { closePriorG2Requests } = await import("./g3-preflight.mjs");
    const cancellationCleanup = await closePriorG2Requests({ operator, controller, perception, standardFixture, runDirectory });
    await writeJson(join(runDirectory, "g2-cancellation-cleanup.json"), cancellationCleanup);
  }
  try {
    operatorTickerEvidence = await qualifyOperatorMissionExpiry(operator);
  } catch (error) {
    operatorTickerEvidence = { expiredWithoutExecution: false, error: String(error?.message ?? error) };
  }
  operatorTicker = startOperatorMissionTicker(operator);
  const g3Fixture = createFreshG3Fixture(standardFixture);
  const authorizedPerception = await createAuthorizedPerception({ perception, standardFixture });
  try {
    g3Outcome = await runAssignedG3Flow({
      operator,
      agent,
      controller,
      perception,
      fixture: g3Fixture,
      runDirectory,
      endpoint,
      databaseName,
      agentIdentityFile,
      resourceGateway,
      resourceSession,
      resourceReader,
      authorizedPerception,
    });
  } catch (error) {
    g3Outcome = {
      checks: Object.fromEntries([
        "actualEve",
        "missionAssignment",
        "unitGrant",
        "trustedAgentCommand",
        "admissionClaim",
        "retainedControllerReceipt",
        "measuredFeedback",
        "reviewedObjectiveProgress",
        "safeCancellation",
        "noDuplicateRetry",
      ].map((name) => [name, false])),
      details: {
        reason: String(error?.message ?? error),
        errorCode: typeof error?.code === "string" ? error.code : undefined,
        errorName: typeof error?.name === "string" ? error.name : undefined,
        causeCode: typeof error?.cause?.code === "string" ? error.cause.code : undefined,
        causeName: typeof error?.cause?.name === "string" ? error.cause.name : undefined,
        causeMessage: typeof error?.cause?.message === "string" ? error.cause.message : undefined,
        errorStack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
  await writeJson(sharedHandoffPath, {
    schemaVersion: 1,
    phase: Object.values(g3Outcome.checks ?? {}).every((value) => value === true) ? "g3-ready" : "g3-blocked",
    available: true,
    moduleBuildHash,
    schemaFingerprint,
    uri: endpoint,
    databaseName,
    worldId: "nemeia-local-world",
    unitId: standardFixture.unitId,
    agentId: "agent-g3-loopback-001",
    adminTokenFile: identityFile,
    operatorTokenFile: operatorIdentityFile,
    agentTokenFile: agentIdentityFile,
    perceptionTokenFile: perceptionIdentityFile,
    controllerTokenFile: controllerIdentityFile,
    resourceRoot,
    runDirectory,
  });
  }
  const perceptionProjectionBeforeRestart = await perception.readBackpackProjection();
  const perceptionViewsBeforeRestart = await perception.readScopedViews();
  const perceptionIdentityBeforeRestart = await perception.getScopedIdentityFingerprint();
  await operatorTicker?.close();
  operatorTicker = undefined;
  const preRestartHandoff = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
  await writeJson(sharedHandoffPath, { ...preRestartHandoff, available: false, phase: "owned-durability-restart" });
  await perception.restartWorldProcess();
  await Promise.all([world, operator, controller, agent].map((adapter) => adapter.start()));
  if (!deferG3) operatorTicker = startOperatorMissionTicker(operator);
  const perceptionIdentityAfterRestart = await perception.getScopedIdentityFingerprint();
  const perceptionProjectionAfterRestart = await perception.readBackpackProjection();
  const perceptionViewsAfterRestart = await perception.readScopedViews();
  await writeJson(sharedHandoffPath, {
    schemaVersion: 1,
    phase: "retained-restart-ready",
    available: true,
    moduleBuildHash,
    schemaFingerprint,
    uri: endpoint,
    databaseName,
    worldId: "nemeia-local-world",
    unitId: standardFixture.unitId,
    agentId: "agent-g3-loopback-001",
    adminTokenFile: identityFile,
    operatorTokenFile: operatorIdentityFile,
    agentTokenFile: agentIdentityFile,
    perceptionTokenFile: perceptionIdentityFile,
    controllerTokenFile: controllerIdentityFile,
    resourceRoot,
    runDirectory,
  });
  const imageReference = ingestion.replay.accepted[0]?.resource;
  const mapLayerReference = ingestion.map?.layerResources[0];
  if (!imageReference || !mapLayerReference || !ingestion.map?.manifestResource || !ingestion.map?.evidenceIndexResource) {
    throw new Error("standard synthetic fixture did not produce the expected image/map resource references");
  }
  const retainedResourceReferences = [
    { label: "image", reference: imageReference, expectedBytes: standardFixture.samples[0].bytes },
    { label: "map-layer", reference: mapLayerReference, expectedBytes: standardFixture.mapProduct.layers[0].bytes },
    { label: "map-manifest", reference: ingestion.map.manifestResource },
    { label: "map-evidence-index", reference: ingestion.map.evidenceIndexResource },
  ];
  let resourceGatewayReopenedAfterRestart = false;
  let resourceGatewayReopenError;
  let resourceInventoryAfterRestart;
  let retainedResourceEvidence = [];
  let resourceBytesVerifiedAfterRestart = false;
  let missingReadErrorCode;
  let missingCommitErrorCode;
  let corruptReadErrorCode;
  let corruptCommitErrorCode;
  try {
    const reopenedResourceGateway = await ResourceGateway.open({ root: resourceRoot, bindings: [resourceBinding] });
    const reopenedResourceSession = reopenedResourceGateway.authenticateWorker({
      bindingId: resourceBinding.bindingId,
      credential: new Uint8Array(resourceCredential),
    });
    const reopenedResourceReader = reopenedResourceGateway.createReader({ authorizeRead: () => true });
    resourceGatewayReopenedAfterRestart = true;
    resourceInventoryAfterRestart = await reopenedResourceGateway.inventory();
    for (const { label, reference, expectedBytes } of retainedResourceReferences) {
      const bytes = await readFullResource(reopenedResourceGateway, reopenedResourceReader, reference);
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      retainedResourceEvidence.push({
        label,
        id: reference.id,
        schema: reference.schema,
        byteLength: String(reference.byteLength),
        descriptorSha256: reference.sha256,
        actualSha256,
        digestMatchesDescriptor: actualSha256 === reference.sha256,
        fixtureBytesMatch: expectedBytes ? bytesEqual(bytes, expectedBytes) : undefined,
      });
    }
    resourceBytesVerifiedAfterRestart = retainedResourceEvidence.length === retainedResourceReferences.length
      && retainedResourceEvidence.every((entry) => entry.digestMatchesDescriptor && (entry.fixtureBytesMatch ?? true))
      && retainedResourceReferences.every(({ reference }) => resourceInventoryAfterRestart.resourceIds.includes(reference.id));

    const missingReference = {
      id: "perception_missing_g1_001",
      schema: "image/png",
      sha256: "0".repeat(64),
      byteLength: "1",
    };
    try {
      await reopenedResourceGateway.read(reopenedResourceReader, missingReference, { offset: 0, length: 1 });
    } catch (error) {
      missingReadErrorCode = resourceErrorCode(error);
    }
    try {
      await reopenedResourceGateway.commitPublishedReferences(reopenedResourceSession, [{ ...missingReference, byteLength: 1 }]);
    } catch (error) {
      missingCommitErrorCode = resourceErrorCode(error);
    }

    const corruptReference = { ...resourceBoundary(imageReference), sha256: "f".repeat(64) };
    try {
      await reopenedResourceGateway.read(reopenedResourceReader, corruptReference, {
        offset: 0,
        length: boundedReadLength(imageReference.byteLength),
      });
    } catch (error) {
      corruptReadErrorCode = resourceErrorCode(error);
    }
    try {
      await reopenedResourceGateway.commitPublishedReferences(reopenedResourceSession, [{
        ...imageReference,
        sha256: "f".repeat(64),
        byteLength: boundedReadLength(imageReference.byteLength),
      }]);
    } catch (error) {
      corruptCommitErrorCode = resourceErrorCode(error);
    }
  } catch (error) {
    resourceGatewayReopenError = resourceErrorCode(error) ?? String(error?.message ?? error);
  }
  const missingResourceRejected = missingReadErrorCode === "resource_corrupt" && missingCommitErrorCode === "resource_corrupt";
  const corruptResourceRejected = corruptReadErrorCode === "resource_corrupt" && corruptCommitErrorCode === "resource_identity_conflict";
  const projectionBeforeSameBodyReplay = await perception.readBackpackProjection();
  let sameBodyReplayErrorCode;
  try {
    await perception.ingestStandardSyntheticFixture(standardFixture);
  } catch (error) {
    sameBodyReplayErrorCode = resourceErrorCode(error) ?? String(error?.message ?? error);
  }
  const projectionAfterSameBodyReplay = await perception.readBackpackProjection();
  const sameBodyReplayNoNewRows = sameBodyReplayErrorCode === undefined
    && sameProjectionIdentity(projectionBeforeSameBodyReplay, projectionAfterSameBodyReplay);
  const changedSample = {
    ...standardFixture.samples[0],
    bytes: new Uint8Array(SYNTHETIC_PNG_1X1_RGB),
  };
  const changedFixture = {
    ...standardFixture,
    samples: [changedSample],
  };
  let changedBodyReplayErrorCode;
  try {
    await perception.ingestStandardSyntheticFixture(changedFixture);
  } catch (error) {
    changedBodyReplayErrorCode = resourceErrorCode(error) ?? String(error?.message ?? error);
  }
  const projectionAfterChangedBodyReplay = await perception.readBackpackProjection();
  const changedBodyReplayRejected = changedBodyReplayErrorCode === "resource_identity_conflict";
  const changedBodyReplayNoMutation = sameProjectionIdentity(projectionAfterSameBodyReplay, projectionAfterChangedBodyReplay);
  const scopedWorkerRead = perceptionViewsAfterRestart.readiness.some((row) => row.authorized === true);
  const retainedBootstrapMembership = perceptionViewsAfterRestart.readiness.some((row) =>
    row.role === "perception" && row.unitId === "entity-go2-001" && row.synchronized === true
  );
  const retainedDataAfterRestart = perceptionProjectionAfterRestart.resourceIds.length > 0
    && perceptionProjectionAfterRestart.mapRevisionIds.length > 0
    && sameTimestamp(perceptionProjectionAfterRestart.recordedAcquisitionAt, capturedAt);
  const sourceAcquisitionTimesPreserved = sameTimestamp(perceptionProjectionAfterRestart.recordedAcquisitionAt, capturedAt);
  const fixtureBackedRetention = retainedDataAfterRestart && sourceAcquisitionTimesPreserved;
  const scopedViews = await world.readScopedViews();
  const publisher = await publicPublisherFingerprint(runDirectory);
  const composition = {
    schemaVersion: 1,
    fixtureKind: "synthetic",
    controllerMode: "no-motion",
    endpoint,
    serverPort,
    databaseName,
    cliVersion: toolchain.cliVersion,
    standaloneVersion: toolchain.standaloneVersion,
    moduleBuildHash,
    schemaFingerprint,
    cliPath: toolchain.cliPath,
    standalonePath: toolchain.standalonePath,
    dataDirectory: join(runDirectory, "spacetime-data"),
    cliRoot: join(runDirectory, "cli-root"),
    generatedDirectory,
    worldClientCredentialFile: identityFile,
    worldClientIdentityFingerprintFile: fingerprintFile,
    operatorClientCredentialFile: operatorIdentityFile,
    perceptionClientCredentialFile: perceptionIdentityFile,
    perceptionClientIdentityFingerprintFile: perceptionFingerprintFile,
    controllerClientCredentialFile: controllerIdentityFile,
    controllerClientIdentityFingerprintFile: controllerFingerprintFile,
    agentClientCredentialFile: agentIdentityFile,
    agentClientIdentityFingerprintFile: agentFingerprintFile,
    resourceRoot,
    publisherKeyFingerprint: publisher?.fingerprint,
    publisherKeyFile: publisher?.path,
    publisherIdentityFingerprint: publisherCredentialState.identityFingerprint,
    perceptionIdentityFingerprint: perceptionIdentityBeforeRestart,
    perceptionIdentityFingerprintAfterRestart: perceptionIdentityAfterRestart,
    samePerceptionIdentityAfterRestart: perceptionIdentityBeforeRestart === perceptionIdentityAfterRestart,
    retainedBootstrapMembership,
    scopedWorkerRead,
    perceptionScopedViewsBeforeRestart: perceptionViewsBeforeRestart,
    perceptionScopedViewsAfterRestart: perceptionViewsAfterRestart,
    standardFixtureKind: "synthetic",
    standardFixtureDigest: qualificationFixtureDigest,
    standardFixtureResourceIds: [...new Set([
      ...ingestion.replay.accepted.map((frame) => frame.resource.id),
      ...perceptionProjectionAfterRestart.resourceIds,
    ])],
    resourceGatewayReopenedAfterRestart,
    resourceGatewayReopenError,
    resourceInventoryAfterRestart,
    retainedResourceEvidence,
    resourceBytesVerifiedAfterRestart,
    sameBodyReplayNoNewRows,
    sameBodyReplayErrorCode,
    changedBodyReplayRejected,
    changedBodyReplayErrorCode,
    changedBodyReplayNoMutation,
    missingResourceRejected,
    missingReadErrorCode,
    missingCommitErrorCode,
    corruptResourceRejected,
    corruptReadErrorCode,
    corruptCommitErrorCode,
    perceptionProjectionBeforeRestart,
    perceptionProjectionAfterRestart,
    scopedViewCounts: Object.fromEntries(Object.entries(scopedViews).map(([key, rows]) => [key, rows.length])),
    readiness: scopedViews.readiness,
    operatorTickerEvidence,
    g3Outcome,
    fixtureDigest: qualificationFixtureDigest,
    ui: "separate native browser qualification; see UI evidence report",
  };
  const g1Report = createQualificationReport({
    gate: "G1",
    mode: "loopback-spacetimedb",
    requestedResult: retainedDataAfterRestart
      && fixtureBackedRetention
      && scopedWorkerRead
      && resourceGatewayReopenedAfterRestart
      && resourceBytesVerifiedAfterRestart
      && sameBodyReplayNoNewRows
      && changedBodyReplayRejected
      && missingResourceRejected
      && corruptResourceRejected
      ? "pass"
      : "blocked",
    fixtureDigest: qualificationFixtureDigest,
    checks: {
      actualModule: true,
      generatedDbConnection: true,
      adminAuthorizedGeneratedViews: true,
      scopedWorkerRead,
      processRestart: perception.processRestartCount === 1,
      retainedDataAfterRestart,
      sameScopedIdentityAfterRestart: perceptionIdentityBeforeRestart === perceptionIdentityAfterRestart,
      fixtureBackedRetention,
      sourceAcquisitionTimesPreserved,
      resourceGatewayReopenedAfterRestart,
      resourceBytesVerifiedAfterRestart,
      sameBodyReplayNoNewRows,
      changedBodyReplayRejected,
      missingResourceRejected,
      corruptResourceRejected,
    },
    details: {
      runDirectory,
      reason: scopedWorkerRead
        ? "distinct perception identity enrolled through the retained publisher/admin connection; standard synthetic PNG/PCD evidence was committed and retained across restart"
        : "distinct perception identity enrolled through the retained publisher/admin connection; generated scoped readiness is unauthorized and must be fixed in the world views before worker qualification",
      endpoint,
      serverPort,
      retainedBootstrapMembership,
      scopedWorkerRead,
      scopedViews,
      perceptionViewsBeforeRestart,
      perceptionViewsAfterRestart,
      perceptionProjectionBeforeRestart,
      perceptionProjectionAfterRestart,
      sourceAcquisitionTimesPreserved,
      resourceGatewayReopenedAfterRestart,
      resourceGatewayReopenError,
      resourceInventoryAfterRestart,
      retainedResourceEvidence,
      resourceBytesVerifiedAfterRestart,
      sameBodyReplayNoNewRows,
      sameBodyReplayErrorCode,
      changedBodyReplayRejected,
      changedBodyReplayErrorCode,
      changedBodyReplayNoMutation,
      missingResourceRejected,
      missingReadErrorCode,
      missingCommitErrorCode,
      corruptResourceRejected,
      corruptReadErrorCode,
      corruptCommitErrorCode,
    },
  });
  await writeQualificationReport(join(reportDirectory, "g1-loopback.json"), g1Report);
  if (deferG3) {
    if (!g1Report.claimable) throw new Error("G1 failed; simulation startup cannot release G2");
    const { prepareG2Simulation } = await import("./g2-simulation-preflight.mjs");
    const startup = await prepareG2Simulation({ controller, perception, agent, standardFixture, runDirectory });
    await writeQualificationReport(join(reportDirectory, "g2-simulation-preflight.json"), {
      gate: "simulation-startup", result: "pass", claimable: true,
      checks: startup.checks, details: { runDirectory, ...startup },
    });
    const current = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
    await writeJson(sharedHandoffPath, { ...current, phase: g1Report.claimable ? "g1-complete-g2-ready" : "g1-blocked" });
    await writeJson(join(reportDirectory, "composition.json"), {
      ...composition, runDirectory, result: g1Report.claimable ? "held-before-g2" : "blocked",
      phase: g1Report.claimable ? "g1-complete-g2-ready" : "g1-blocked",
      gateReports: { G1: g1Report.result }, g1ReportPath: join(reportDirectory, "g1-loopback.json"),
    });
    await holdCompositionUntilSignal();
    return g1Report.claimable ? 0 : 2;
  }
  const g3Report = createQualificationReport({
    gate: "G3",
    mode: "loopback-spacetimedb",
    requestedResult: Object.values(g3Outcome?.checks ?? {}).every((value) => value === true) ? "pass" : "blocked",
    fixtureDigest: qualificationFixtureDigest,
    checks: {
      actualModule: true,
      processRestart: perception.processRestartCount === 1,
      retainedDataAfterRestart,
      sameScopedIdentityAfterRestart: perceptionIdentityBeforeRestart === perceptionIdentityAfterRestart,
      ...(g3Outcome?.checks ?? {}),
      missionDeadlineWithoutExecutions: operatorTickerEvidence.expiredWithoutExecution,
    },
    evidence: g3Outcome?.evidence ?? [],
    details: {
      ...g3Outcome?.details, endpoint, serverPort, operatorTickerEvidence,
      observedChecks: g3Outcome?.observedChecks, notRunChecks: g3Outcome?.notRunChecks,
      ids: g3Outcome?.ids, receipts: g3Outcome?.receipts, diagnostics: g3Outcome?.diagnostics,
    },
  });
  await writeQualificationReport(join(reportDirectory, "g3-loopback.json"), g3Report);
  const qualified = g1Report.claimable && g3Report.claimable;
  await writeJson(join(reportDirectory, "composition.json"), {
    ...composition, result: qualified ? "pass" : "blocked",
    gateReports: { G1: g1Report.result, G3: g3Report.result },
    failures: [...g1Report.failures, ...g3Report.failures],
  });
  await holdCompositionUntilSignal();
  return qualified ? 0 : 2;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, async () => { await cleanup(); process.exit(130); });
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error) {
  await blockedReports(error instanceof Error ? error.message : String(error), {
    error: String(error),
    errorStack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 2;
  // A held diagnostic run retains its owned service after a post-bootstrap
  // failure. This does not turn the failed report into a release marker.
  try {
    const handoff = JSON.parse(await readFile(sharedHandoffPath, "utf8"));
    if (handoff.runDirectory === activeRunDirectory && handoff.available === true) {
      await writeJson(sharedHandoffPath, { ...handoff, phase: "qualification-blocked" });
      await holdCompositionUntilSignal();
    }
  } catch { /* No live bootstrapped handoff exists; normal cleanup follows. */ }
} finally {
  await cleanup();
}
