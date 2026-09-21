import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loopbackWakeUrl } from "../eve-eval-fixture/agent/automatic-wake-protocol.ts";
import { finishAutomaticEval, startOwned, stopOwned, type OwnedProcess, type ProcessResult } from "./g2-owned-eval-process.ts";

type Row = Record<string, any>;
type Wake = { id: string; sessionId: string | null; status: string; sent: boolean; dirtyKeys: string[] };
export type AutomaticLedgerSnapshot = { busy: number; wakes: Wake[] };

export async function installedAutomaticWakeInventory(root: string): Promise<{
  capturedAt: string; nodeExecutable: string; versions: Record<string, string>;
  packageFiles: Record<string, { path: string; sha256: string }>;
}> {
  const versions: Record<string, string> = { node: process.version };
  const packageFiles: Record<string, { path: string; sha256: string }> = {};
  for (const name of ["eve", "spacetimedb", "just-bash"]) {
    const pathname = await realpath(join(root, "node_modules", name, "package.json"));
    const bytes = await readFile(pathname);
    const metadata = JSON.parse(bytes.toString("utf8")) as { name?: unknown; version?: unknown };
    if (metadata.name !== name || typeof metadata.version !== "string" || metadata.version.length === 0) {
      throw new Error(`installed automatic qualification package metadata is invalid: ${name}`);
    }
    versions[name] = metadata.version;
    packageFiles[name] = { path: pathname, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return { capturedAt: new Date().toISOString(), nodeExecutable: await realpath(process.execPath), versions, packageFiles };
}

const timeoutMs = 90_000;
const poll = () => new Promise<void>((resolve) => setTimeout(resolve, 25));
const configurationKeys = [
  "NEMEIA_WORLD_URI", "NEMEIA_WORLD_DATABASE", "NEMEIA_WORLD_ID", "NEMEIA_AGENT_ID", "NEMEIA_WORLD_TOKEN",
  "NEMEIA_AGENT_OWNER_PRINCIPAL_ID", "NEMEIA_WORLD_AUTH_SECRET", "NEMEIA_WORLD_AUTH_ISSUER", "NEMEIA_WORLD_AUTH_AUDIENCE", "NEMEIA_WORLD_AUTH_SUBJECT",
  "NEMEIA_AGENT_OWNER_ISSUER", "NEMEIA_AGENT_OWNER_SUBJECT", "NEMEIA_AGENT_LEDGER", "NEMEIA_G2_EXPECTED_UNIT_ID",
  "NEMEIA_G2_EXPECTED_ENTITY_ID", "NEMEIA_G2_EXPECTED_MAP_ID", "NEMEIA_G2_EXPECTED_OBSERVATION_ID",
] as const;

/** Whitelist only OS essentials plus the explicitly configured agent identity. */
export function automaticWakeEnvironment(base: NodeJS.ProcessEnv, configuration: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"]) if (base[key] !== undefined) env[key] = base[key];
  for (const key of configurationKeys) if (configuration[key] !== undefined) env[key] = configuration[key];
  env.EVE_TELEMETRY_DISABLED = "1";
  env.OTEL_SDK_DISABLED = "true";
  env.NEMEIA_INSTRUMENTATION_MODE = "local-noop";
  return env;
}

async function saveProcess(directory: string, prefix: string, result: ProcessResult): Promise<void> {
  await Promise.all([
    writeFile(join(directory, `${prefix}.stdout.log`), result.stdout, { mode: 0o600 }),
    writeFile(join(directory, `${prefix}.stderr.log`), result.stderr, { mode: 0o600 }),
  ]);
}

async function marker(directory: string, name: string, value: unknown): Promise<void> {
  const pathname = join(directory, name);
  await writeFile(`${pathname}.pending`, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(`${pathname}.pending`, pathname);
}

async function readMarker(directory: string, name: string): Promise<Row | undefined> {
  try {
    const data = await readFile(join(directory, name), "utf8");
    if (data.length > 128_000) throw new Error(`oversized qualification marker: ${name}`);
    return JSON.parse(data) as Row;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

export function isSqliteBusy(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  return value.code === "ERR_SQLITE_ERROR" && typeof value.errcode === "number" &&
    Number.isSafeInteger(value.errcode) && value.errcode >= 0 && (value.errcode & 0xff) === 5;
}

export function readAutomaticLedgerOnce(filename: string): AutomaticLedgerSnapshot | undefined {
  if (!existsSync(filename)) return undefined;
  // Observation only: never construct a write-capable production ledger or
  // seed/clear busy, wake, session, or auth rows from qualification code.
  let db: DatabaseSync | undefined;
  let operation = "open-readonly";
  try {
    db = new DatabaseSync(filename, { readOnly: true, timeout: 0 });
    operation = "select-schema";
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'turn_activity'").get()) return undefined;
    operation = "select-turn-activity";
    const busy = Number(db.prepare("SELECT COUNT(*) AS n FROM turn_activity WHERE accepted_count > 0").get()?.n ?? 0);
    operation = "select-wake-delivery";
    const rows = db.prepare("SELECT wake_id, session_id, status, channel_send_started, dirty_keys_json FROM wake_delivery ORDER BY created_at, wake_id").all();
    if (rows.length > 12) throw new Error("automatic wake delivery exceeded bounded fixture budget");
    return { busy, wakes: rows.map((row) => ({
      id: String(row.wake_id), sessionId: row.session_id === null ? null : String(row.session_id),
      status: String(row.status), sent: row.channel_send_started === 1, dirtyKeys: JSON.parse(String(row.dirty_keys_json)) as string[],
    })) };
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { ledgerOperation: operation });
    throw error;
  } finally { db?.close(); }
}

/** A new read-only handle per attempt; no PRAGMA, recovery writes, or synthetic state. */
export async function readAutomaticLedger(filename: string, busyTimeoutMs = 1_000): Promise<AutomaticLedgerSnapshot | undefined> {
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 1_000) throw new Error("invalid ledger observer busy budget");
  const deadline = Date.now() + busyTimeoutMs;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try { return readAutomaticLedgerOnce(filename); }
    catch (error) {
      // Match Node SQLite's numeric result code, never the English message.
      // SQLITE_LOCKED, corruption, schema/JSON errors, and I/O errors fail now.
      if (!isSqliteBusy(error)) throw error;
      if (Date.now() >= deadline) {
        throw Object.assign(new Error("automatic ledger read SQLITE_BUSY budget exhausted", { cause: error }), {
          ledgerAttempts: attempts, busyTimeoutMs,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
    }
  }
}

export function automaticFailureDetails(error: unknown, phase: string, env: NodeJS.ProcessEnv = {}): Row {
  const secrets = Object.entries(env).flatMap(([key, value]) =>
    /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)$/u.test(key) && value && value.length >= 8 ? [value] : [],
  ).sort((left, right) => right.length - left.length);
  const safe = (value: unknown, limit: number): string | undefined => {
    if (typeof value !== "string") return undefined;
    for (const secret of secrets) value = (value as string).replaceAll(secret, "[redacted]");
    return (value as string).replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu, "[jwt-redacted]").slice(0, limit);
  };
  const describe = (caught: unknown, depth: number): Row => {
    const value = caught !== null && typeof caught === "object" ? caught as Row : {};
    return { name: safe(value.name, 120), message: safe(value.message, 3_000), stack: safe(value.stack, 6_000),
      code: safe(value.code, 100), errcode: typeof value.errcode === "number" ? value.errcode : undefined,
      errstr: safe(value.errstr, 300), ledgerOperation: safe(value.ledgerOperation, 100),
      ledgerAttempts: typeof value.ledgerAttempts === "number" ? value.ledgerAttempts : undefined,
      busyTimeoutMs: typeof value.busyTimeoutMs === "number" ? value.busyTimeoutMs : undefined,
      ...(depth < 2 && value.cause !== undefined ? { cause: describe(value.cause, depth + 1) } : {}),
    };
  };
  return { phase, ...describe(error, 0) };
}

async function lifecycle(directory: string): Promise<Row[]> {
  try {
    const data = await readFile(join(directory, "lifecycle.jsonl"), "utf8");
    if (data.length > 128_000) throw new Error("automatic wake lifecycle exceeded bounded fixture budget");
    const complete = data.slice(0, data.lastIndexOf("\n") + 1);
    return complete.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Row);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

function uniqueEvents(events: Row[], type: string): Row[] {
  return [...new Map(events.filter((event) => event.type === type).map((event) => [String(event.turnId), event])).values()];
}

/** Pure gate used by the live observer and adversarial offline tests. */
export function busyBurstIsHeld(before: AutomaticLedgerSnapshot, after: AutomaticLedgerSnapshot, startedBefore: number, startedAfter: number): boolean {
  const sentIds = new Set(before.wakes.filter((wake) => wake.sent).map((wake) => wake.id));
  const afterSent = after.wakes.filter((wake) => wake.sent);
  const pending = after.wakes.filter((wake) => !wake.sent && ["pending", "dispatching", "uncertain"].includes(wake.status));
  return before.busy === 1 && after.busy === 1 && startedBefore === startedAfter && pending.length === 1 &&
    afterSent.length === sentIds.size && afterSent.every((wake) => sentIds.has(wake.id));
}

export async function prepareAutomaticBaseline(options: {
  baselineMissionId: string; measuredMissionIds: readonly string[];
  prepareUnitGrant: () => Promise<boolean>; createMission: (id: string) => Promise<void>;
  recordAllocation: (id: string) => void;
}): Promise<void> {
  if (!/^mission-g2-auto-[a-zA-Z0-9-]+$/u.test(options.baselineMissionId) || options.measuredMissionIds.includes(options.baselineMissionId)) {
    throw new Error("automatic baseline must have a distinct owned mission ID");
  }
  if (!await options.prepareUnitGrant()) throw new Error("automatic baseline requires a current generated Unit grant");
  options.recordAllocation(options.baselineMissionId); // Retain even a partially completed reducer sequence for finally cleanup.
  await options.createMission(options.baselineMissionId);
}

export function automaticMissionsCancelled(expectedIds: readonly string[], cleanups: readonly Row[]): boolean {
  return new Set(expectedIds).size === 4 && cleanups.length === 4 &&
    expectedIds.every((id) => cleanups.filter((cleanup) => cleanup.missionId === id && cleanup.missionState === "Cancelled" && cleanup.executionIds?.length === 0).length === 1);
}

export function executionMutationCount(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): number {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((id) => before[id] !== after[id]).length;
}

export async function runActionFreeAutomaticWake(options: {
  root: string; fixtureRoot: string; directory: string; env: NodeJS.ProcessEnv;
  baselineMissionId: string; missionIds: readonly string[];
  prepareUnitGrant: () => Promise<boolean>;
  createMission: (missionId: string) => Promise<void>;
  cleanupMission: (missionId: string) => Promise<{ missionState?: string; executionIds: readonly string[] }>;
  executionRows: () => Promise<Record<string, string>>;
  closeSubscriptions: () => Promise<void>;
}): Promise<{ automaticWakeTested: true; reportFile: string; checks: Record<string, boolean> }> {
  const { directory, missionIds, baselineMissionId } = options;
  const reportFile = join(directory, "automatic-wake-report.json");
  const inventoryFile = join(directory, "automatic-wake-inventory.json");
  const inventory = await installedAutomaticWakeInventory(options.root);
  await writeFile(inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const env = automaticWakeEnvironment(process.env, options.env);
  env.NEMEIA_AUTO_WAKE_DIRECTORY = directory;
  env.NEMEIA_AUTO_MISSION_IDS = JSON.stringify(missionIds);
  const ledgerFile = env.NEMEIA_AGENT_LEDGER;
  if (!ledgerFile?.startsWith("/") || missionIds.length !== 3) throw new Error("automatic wake test needs an isolated absolute WAL and three mission IDs");
  let eve: OwnedProcess | undefined, bridge: OwnedProcess | undefined;
  let eveCompletion: Omit<Awaited<ReturnType<typeof finishAutomaticEval>>, "result"> | undefined;
  let error: unknown, evalEvidence: Row | undefined, beforeBusy: AutomaticLedgerSnapshot | undefined, afterBusy: AutomaticLedgerSnapshot | undefined;
  let baseline: Row[] = [], measured: Row | undefined, idle: Row[] = [];
  const allocated: string[] = [];
  const cleanups: Row[] = [];
  const checks: Record<string, boolean> = {};
  const initialExecutions = await options.executionRows();
  let observedExecutionMutations: number | undefined;
  let phase = "prepare-baseline", failure: Row | undefined;
  const rememberFailure = (caught: unknown, failedPhase = phase) => {
    if (error !== undefined) return;
    error = caught;
    failure = automaticFailureDetails(caught, failedPhase, env);
  };
  async function wait(condition: () => Promise<boolean> | boolean, label: string): Promise<void> {
    phase = label;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const failure = await readMarker(directory, "eval-error.json");
      if (failure) throw new Error(`automatic Eve eval: ${String(failure.error).slice(0, 2000)}`);
      if (eve?.exited()) throw new Error(`automatic Eve exited early (${eve.exited()?.code}); see automatic-eve logs`);
      if (bridge?.exited()) throw new Error(`operational bridge exited early (${bridge.exited()?.code}); see operational-bridge logs`);
      if (await condition()) return;
      await poll();
    }
    throw new Error(`automatic wake timeout: ${label}`);
  }
  async function idleStable(minimumTurns: number): Promise<Row[]> {
    let stableSince = 0, signature = "", completed: Row[] = [];
    await wait(async () => {
      const state = await readAutomaticLedger(ledgerFile!);
      const events = await lifecycle(directory);
      if (events.some((event) => event.type.endsWith(".failed"))) throw new Error("automatic wake public lifecycle failed");
      completed = uniqueEvents(events, "turn.completed");
      const started = uniqueEvents(events, "turn.started");
      const next = JSON.stringify({ completed: completed.map((turn) => turn.turnId), wakes: state?.wakes });
      if (!state || state.busy !== 0 || completed.length < minimumTurns || completed.length !== started.length ||
        state.wakes.length === 0 || state.wakes.some((wake) => wake.status !== "acknowledged")) { stableSince = 0; return false; }
      if (next !== signature || !stableSince) { signature = next; stableSince = Date.now(); }
      return Date.now() - stableSince >= 2_300; // Exceeds production's 2s capped retry.
    }, "public idle receipt and drained operational dispatch");
    return completed;
  }
  try {
    await prepareAutomaticBaseline({ baselineMissionId, measuredMissionIds: missionIds,
      prepareUnitGrant: options.prepareUnitGrant, createMission: options.createMission,
      recordAllocation: (id) => { allocated.push(id); } });
    checks.unitGrantPrepared = true;
    checks.explicitBaselineMissionAssigned = true;
    await marker(directory, "baseline-prepared.json", { baselineMissionId, unitGrantPrepared: true });
    phase = "start-public-eval";
    eve = await startOwned(join(options.fixtureRoot, "node_modules/.bin/eve"), ["eval", "automatic-wake", "--json", "--timeout", "180000", "--skip-report"], options.fixtureRoot, env);
    let ready: Row | undefined;
    await wait(async () => { ready = await readMarker(directory, "target-ready.json"); return ready !== undefined; }, "public target URL");
    const wakeUrl = loopbackWakeUrl(String(ready!.url));
    if (ready!.kind !== "local" || ready!.wakeUrl !== wakeUrl) throw new Error("eval did not expose the validated local public target");
    phase = "start-operational-bridge";
    bridge = await startOwned("bash", [join(options.root, "agent/scripts/world-wake-bridge.sh")], options.root, { ...env, NEMEIA_EVE_WAKE_URL: wakeUrl });
    baseline = await idleStable(1);
    if (baseline.length > 4 || new Set(baseline.map((turn) => turn.sessionId)).size !== 1) throw new Error("initial automatic delivery did not settle to one bounded public session");
    const sessionId = String(baseline[0].sessionId);
    await marker(directory, "observe-baseline.json", { sessionId, turnIds: baseline.map((turn) => turn.turnId) });
    await wait(async () => !!await readMarker(directory, "baseline-observed.json"), "public baseline cursor");
    await marker(directory, "armed.json", { at: new Date().toISOString() });
    phase = "create-subsequent-native-trigger";
    allocated.push(missionIds[0]);
    await options.createMission(missionIds[0]);
    let thinking: Row | undefined;
    await wait(async () => { thinking = await readMarker(directory, "thinking.json"); return thinking !== undefined; }, "subsequent native update entered mockModel");
    await wait(async () => {
      beforeBusy = await readAutomaticLedger(ledgerFile!);
      const events = await lifecycle(directory);
      const received = events.find((event) => event.type === "message.received" && event.wakeId === thinking!.wakeId);
      measured = uniqueEvents(events, "turn.started").find((turn) => turn.turnId === received?.turnId);
      const wake = beforeBusy?.wakes.find((row) => row.id === thinking!.wakeId);
      return beforeBusy?.busy === 1 && !!measured && !!wake?.sent && wake.sessionId === sessionId && wake.dirtyKeys.some((key) => key.includes(missionIds[0]));
    }, "native trigger correlated with public wake/turn and shared busy receipt");
    checks.subsequentNativeUpdate = !baseline.some((turn) => turn.turnId === measured!.turnId);
    await marker(directory, "observe-measured.json", { sessionId, turnIds: [measured!.turnId] });
    const startedBefore = uniqueEvents(await lifecycle(directory), "turn.started").length;
    phase = "create-native-burst";
    for (const missionId of missionIds.slice(1)) { allocated.push(missionId); await options.createMission(missionId); }
    let heldSince = 0;
    await wait(async () => {
      afterBusy = await readAutomaticLedger(ledgerFile!);
      const count = uniqueEvents(await lifecycle(directory), "turn.started").length;
      if (afterBusy && (!busyBurstIsHeld(beforeBusy!, afterBusy, startedBefore, count))) {
        const newSent = afterBusy.wakes.some((wake) => wake.sent && !beforeBusy!.wakes.some((old) => old.id === wake.id && old.sent));
        if (count !== startedBefore || newSent || afterBusy.busy !== 1) throw new Error("busy burst dispatched an extra turn or lost the shared busy reservation");
        heldSince = 0; return false;
      }
      const pendingContainsBurst = afterBusy?.wakes.some((wake) => !wake.sent && wake.dirtyKeys.some((key) => missionIds.slice(1).some((id) => key.includes(id))));
      if (!afterBusy || !pendingContainsBurst || !bridge!.output().includes('"status":"held"')) { heldSince = 0; return false; }
      heldSince ||= Date.now();
      return Date.now() - heldSince >= 2_300;
    }, "native burst retained and coalesced while actual Eve turn is busy");
    checks.busyBurstCoalesced = true;
    await marker(directory, "release.json", { nativeMissionIds: missionIds, releasedAt: new Date().toISOString() });
    await wait(async () => !!await readMarker(directory, "measured-observed.json"), "pinned and fresh model-visible production context");
    const completed = await idleStable(baseline.length + 2);
    idle = completed.filter((turn) => !baseline.some((old) => old.turnId === turn.turnId) && turn.turnId !== measured!.turnId);
    if (idle.length < 1 || idle.length > 2) throw new Error("busy burst did not settle to one or two coalesced idle deliveries");
    await marker(directory, "observe-idle.json", { sessionId, turnIds: idle.map((turn) => turn.turnId) });
    await wait(async () => { evalEvidence = await readMarker(directory, "eval-observed.json"); return !!evalEvidence; }, "public cursor-observed idle delivery");
    phase = "stop-operational-bridge";
    const result = await stopOwned(bridge);
    await saveProcess(directory, "operational-bridge", result);
    checks.bridgeStoppedCleanly = result.code === 0 && result.signal === null;
    await marker(directory, "bridge-stopped.json", { cleanExit: checks.bridgeStoppedCleanly });
    phase = "final-public-eval-evidence";
    const { result: eveResult, ...completion } = await finishAutomaticEval(eve, { targetUrl: String(ready!.url), bashCalls: 2 + idle.length });
    eveCompletion = completion;
    await saveProcess(directory, "automatic-eve", eveResult);
    checks.actualPublicEvalPassed = completion.verdict.passed && eveResult.code === 0;
    checks.eveParentExitedNaturally = eve.lifecycle().exit?.code === 0 && eve.lifecycle().exit?.signal === null;
    const expectedChecks = ["publicTargetAndCursor", "initialLoadExcluded", "publicMockModelLifecycle", "measuredNativeMissionInWake", "sameStepPinned", "nextStepFresh", "usefulIntactWorldContext", "idleNextDelivery", "actionFreeBash"];
    for (const name of expectedChecks) checks[name] = evalEvidence!.checks?.[name] === true;
    checks.observedNodeMatchesInventory = evalEvidence!.nodeVersion === inventory.versions.node;
    const afterExecutions = await options.executionRows();
    checks.noExecutionCreated = Object.keys(afterExecutions).every((id) => Object.hasOwn(initialExecutions, id));
    observedExecutionMutations = executionMutationCount(initialExecutions, afterExecutions);
    checks.noExecutionMutation = observedExecutionMutations === 0;
    if (Object.values(checks).some((value) => !value)) throw new Error("automatic wake strict evidence gates failed");
  } catch (caught) { rememberFailure(caught); }
  finally {
    for (const [owned, name] of [[bridge, "operational-bridge"], [eve, "automatic-eve"]] as const) {
      if (!owned) continue;
      try { await saveProcess(directory, name, await stopOwned(owned)); }
      catch (caught) { rememberFailure(caught, `cleanup-stop-${name}`); }
    }
    // Never mutate cleanup state if an owned process could still dispatch.
    if ((!bridge || bridge.stopped()) && (!eve || eve.stopped())) {
      for (const missionId of allocated) {
        try { cleanups.push({ missionId, ...await options.cleanupMission(missionId) }); }
        catch (caught) { rememberFailure(caught, "cleanup-owned-mission"); cleanups.push({ missionId, cleanupFailed: true }); }
      }
    } else {
      rememberFailure(new Error("owned process shutdown not confirmed; mission cleanup held for coordinator"), "cleanup-shutdown-unconfirmed");
    }
    try {
      const afterCleanup = await options.executionRows();
      observedExecutionMutations = Math.max(observedExecutionMutations ?? 0, executionMutationCount(initialExecutions, afterCleanup));
      checks.noExecutionMutation = observedExecutionMutations === 0;
    } catch (caught) { rememberFailure(caught, "cleanup-execution-invariance"); }
    try { await options.closeSubscriptions(); checks.qualificationSubscribersClosed = true; }
    catch (caught) { rememberFailure(caught, "cleanup-subscribers"); checks.qualificationSubscribersClosed = false; }
  }
  checks.ownedChildrenStopped = bridge?.stopped() === true && eve?.stopped() === true;
  checks.ownedMissionsCancelled = automaticMissionsCancelled([baselineMissionId, ...missionIds], cleanups);
  const pass = error === undefined && Object.values(checks).every(Boolean);
  const reason = failure?.message ?? (error === undefined ? undefined : "automatic wake qualification failed");
  await marker(directory, "automatic-wake-report.json", {
    schemaVersion: 1, gate: "G2-automatic-wake", result: pass ? "pass" : "fail", claimable: pass, automaticWakeTested: pass,
    versions: inventory.versions, inventoryFile,
    checks, reason, failure, baselineMissionId, missionIds, executionMutationCount: observedExecutionMutations,
    eveCompletion, processLifecycle: { eve: eve?.lifecycle(), bridge: bridge?.lifecycle() },
    baselineTurnIds: baseline.map((turn) => turn.turnId), measuredTurnId: measured?.turnId,
    idleTurnIds: idle.map((turn) => turn.turnId), beforeBusy, afterBusy, evalEvidence, cleanups,
    safety: { paidInference: false, physicalActuation: false, robotAccess: false, externalExport: false },
  });
  if (!pass) throw new Error(`automatic wake qualification failed: ${reason ?? "strict cleanup/evidence gates"}; reportFile=${reportFile}`);
  return { automaticWakeTested: true, reportFile, checks };
}
