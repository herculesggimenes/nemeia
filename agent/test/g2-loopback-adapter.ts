import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, cp, lstat, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type GeneratedRow = Record<string, any>;
type GeneratedSnapshot = {
  readonly readiness: readonly GeneratedRow[];
  readonly assignedMissions: readonly GeneratedRow[];
  readonly relevantExecutions: readonly GeneratedRow[];
  readonly relevantAgents: readonly GeneratedRow[];
  readonly relevantEntities: readonly GeneratedRow[];
  readonly relevantSemantic: readonly GeneratedRow[];
  readonly relevantLocalMaps: readonly GeneratedRow[];
  readonly relevantMissionAgents: readonly GeneratedRow[];
  readonly relevantUnitAssignments: readonly GeneratedRow[];
  readonly relevantUnitControls: readonly GeneratedRow[];
  readonly relevantGeometry?: readonly GeneratedRow[];
  readonly relevantPoses?: readonly GeneratedRow[];
};

type LoopbackAdapter = {
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly callReducer: (name: string, input: unknown) => Promise<unknown>;
  readonly readSnapshot: () => Promise<GeneratedSnapshot>;
  readonly getIdentity: () => Promise<unknown>;
};

type CreateLoopbackAdapter = (input: {
  readonly modulePath: string;
  readonly uri: string;
  readonly databaseName: string;
  readonly scopedIdentityFile: string;
  readonly scopedIdentityFingerprint?: string;
  readonly processSupervisor?: unknown;
}) => Promise<LoopbackAdapter>;

type QualificationHandoff = {
  readonly uri: string;
  readonly databaseName: string;
  readonly worldId: string;
  readonly unitId: string;
  readonly agentId: string;
  readonly operatorTokenFile: string;
  /** Required by G2's permission probe, never by G3's action path. */
  readonly adminTokenFile?: string;
  readonly agentTokenFile: string;
  readonly runDirectory: string;
  readonly available: boolean;
};

type BackpackFixture = {
  readonly fixtureDigest: string;
  readonly mission: { readonly id: string; readonly objectiveId: string };
  readonly unit: { readonly id: string };
  readonly frame: { readonly id: string };
  readonly firstObservation: { readonly entityId: string };
  readonly mapCheckpoint: { readonly id: string };
};

type G2SlowStepModel = (input: { readonly waitForWorldChange: () => Promise<void> }) => Promise<unknown>;

type G2Outcome = {
  readonly automaticWakeTested: false;
  readonly actualEveLifecycle: boolean;
  readonly injectedModel: boolean;
  readonly worldChangedDuringThinking: boolean;
  readonly actualGeneratedWorldSubscription: boolean;
  readonly usefulWorldContext: boolean;
  readonly authenticatedJustBashRead: boolean;
  readonly nextStepFresh: boolean;
  readonly sameStepPinned: boolean;
  readonly revokedAccessDenied: boolean;
  readonly permissionRestored: boolean;
  readonly unauthorizedWakeDenied: boolean;
  readonly missionPresentInFreshContext: boolean;
  readonly actionCommandPath: boolean;
  readonly unitGrantPrepared: boolean;
  readonly defaultApiOtherPrincipalDenied: boolean;
  readonly defaultApiEvidenceFile: string;
  readonly evidenceFile: string;
  readonly childStdoutFile: string;
  readonly childStderrFile: string;
  readonly permissionEvidenceFile: string;
  readonly cleanup: MutationCleanup;
  readonly mutation: { readonly missionId: string; readonly objectiveId: string; readonly assigned: boolean };
};

type MutationCleanup = {
  readonly missionId: string;
  readonly executionIds: readonly string[];
  readonly cancellationRequestedExecutionIds: readonly string[];
  readonly missionState?: string;
  readonly executionStates: readonly { readonly id: string; readonly state?: string }[];
  readonly evidenceFile: string;
  readonly controllerCleanupReportFile?: string;
};

type ChildResult = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

type ChildOutputFiles = {
  readonly stdoutFile: string;
  readonly stderrFile: string;
};

type CapturedChild = Promise<ChildResult> & {
  /** Process exit can precede pipe closure when an Eve descendant retains stdio. */
  readonly exited: Promise<ChildResult>;
  readonly snapshot: () => ChildResult;
};

function redactChildText(text: string, secrets: readonly string[] = []): string {
  let safe = text;
  for (const secret of secrets) safe = safe.replaceAll(secret, "[redacted]");
  return safe
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[jwt-redacted]");
}

export function childFailureDetail(result: ChildResult): string {
  const safeText = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    return redactChildText(value)
      .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/gu, "")
      .slice(-4_000);
  };
  let evalSummary: unknown;
  const reportStart = result.stdout.search(/^\{\s*\n\s*"target"/mu);
  const candidates = result.stdout.trim().split(/\r?\n/u).reverse();
  if (reportStart >= 0) candidates.unshift(result.stdout.slice(reportStart).trim());
  for (const line of candidates) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object") {
        const value = parsed as Record<string, unknown>;
        evalSummary = {
          status: value.status,
          failed: value.failed,
          passed: value.passed,
          message: safeText(value.message),
          error: safeText(value.error),
          results: Array.isArray(value.results) ? value.results.slice(0, 8).map((entry) => ({
            id: safeText(entry.id), verdict: entry.verdict, error: safeText(entry.error),
            assertions: Array.isArray(entry.assertions) ? entry.assertions.slice(0, 24).map((item: Record<string, unknown>) => ({
              name: safeText(item?.name), passed: item?.passed, message: safeText(item?.message),
            })) : undefined,
          })) : undefined,
          assertions: Array.isArray(value.assertions)
            ? value.assertions.slice(0, 24).map((assertion: unknown) => {
              if (assertion === null || typeof assertion !== "object") return { value: safeText(String(assertion)) };
              const item = assertion as Record<string, unknown>;
              return { name: safeText(item.name), passed: item.passed, message: safeText(item.message) };
            })
            : undefined,
        };
        break;
      }
    } catch {
      // Eve's human-readable diagnostics are retained below.
    }
  }
  const stderr = safeText(result.stderr);
  return JSON.stringify({ code: result.code, signal: result.signal, stderr, evalFailure: evalSummary,
    ...(evalSummary === undefined ? { stdout: safeText(result.stdout) } : {}),
  });
}

type EveCommandEvidence = {
  readonly receipt: unknown;
  readonly retryReceipt: unknown;
  readonly step: { readonly sessionId: string; readonly turnId?: string; readonly stepIndex?: number };
  readonly evidence: {
    readonly lifecycle: readonly string[];
    readonly bashTool: boolean;
    readonly actionCommandPath: boolean;
  };
};

type QualificationTarget = {
  readonly entityId: string;
  readonly mapId: string;
  readonly frameId: string;
  readonly observationId: string;
};

type PermissionEvidence = {
  readonly firstReadSucceeded: boolean;
  readonly revokedReadDenied: boolean;
  readonly restoredReadObserved: boolean;
  readonly beforeRole?: string;
  readonly revokedRole?: string;
  readonly restoredRole?: string;
  readonly evidenceFile: string;
};

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultHandoffPath = join(root, ".artifacts/qualification/current-handoff.json");

function boundedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function eveJwtOwnerPrincipal(configuredOwner: string, issuer: string): { readonly principal: string; readonly subject: string } {
  const prefix = `${issuer}:`;
  const subject = configuredOwner.startsWith(prefix) ? configuredOwner.slice(prefix.length) : configuredOwner;
  if (subject.length === 0 || subject.includes(":")) throw new Error("G2 owner mapping has an invalid JWT subject");
  const principal = `${issuer}:${subject}`;
  if (principal !== `${issuer}:${subject}`) throw new Error("G2 JWT owner mapping is inconsistent");
  return { principal, subject };
}

async function readJson(pathname: string): Promise<unknown> {
  return JSON.parse(await readFile(pathname, "utf8")) as unknown;
}

async function loadLoopbackAdapter(): Promise<CreateLoopbackAdapter> {
  // Keep the strict fixture typecheck independent of the concurrently-owned
  // conformance source. Runtime still loads that exact production adapter.
  const moduleUrl = pathToFileURL(join(root, "conformance/src/loopback-adapter.ts")).href;
  const module = await import(moduleUrl) as { readonly createLoopbackAdapter?: unknown };
  if (typeof module.createLoopbackAdapter !== "function") throw new Error("production loopback adapter export is unavailable");
  return module.createLoopbackAdapter as CreateLoopbackAdapter;
}

function handoffFrom(value: unknown): QualificationHandoff {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("qualification handoff is not an object");
  const input = value as Record<string, unknown>;
  const stringField = (name: keyof QualificationHandoff): string => {
    const field = input[name];
    if (typeof field !== "string" || field.length === 0) throw new Error(`qualification handoff field is invalid: ${String(name)}`);
    return field;
  };
  if (input.available !== true) throw new Error("qualification handoff is not available");
  return {
    uri: stringField("uri"),
    databaseName: stringField("databaseName"),
    worldId: stringField("worldId"),
    unitId: stringField("unitId"),
    agentId: stringField("agentId"),
    operatorTokenFile: stringField("operatorTokenFile"),
    ...(input.adminTokenFile === undefined ? {} : { adminTokenFile: stringField("adminTokenFile") }),
    agentTokenFile: stringField("agentTokenFile"),
    runDirectory: stringField("runDirectory"),
    available: true,
  };
}

async function credential(pathname: string): Promise<string> {
  const permissions = (await stat(pathname)).mode & 0o777;
  if (permissions !== 0o600) throw new Error(`qualification credential must be mode 0600: ${pathname}`);
  const value = (await readFile(pathname, "utf8")).trim();
  if (value.length === 0) throw new Error(`qualification credential is empty: ${pathname}`);
  return value;
}

type MemberAdministrator = {
  readonly setAgentRole: (identity: unknown, role: "Agent" | "Controller") => Promise<void>;
  readonly close: () => Promise<void>;
};

/** Host-only G2 authority: the returned port cannot submit actions or grants. */
export async function openQualificationMemberAdministrator({ adminTokenFile, createClient }: {
  readonly adminTokenFile?: string;
  readonly createClient: (privateTokenFile: string) => Promise<Pick<LoopbackAdapter, "start" | "close" | "callReducer">>;
}): Promise<MemberAdministrator> {
  if (adminTokenFile === undefined || !isAbsolute(adminTokenFile)) {
    throw new Error("G2 permission qualification requires an explicit absolute handoff.adminTokenFile");
  }
  const metadata = await lstat(adminTokenFile);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("G2 adminTokenFile must be a private regular file with mode 0600");
  }
  await credential(adminTokenFile); // Validate privately; never put admin bytes in an Eve environment.
  const client = await createClient(adminTokenFile);
  try {
    await client.start();
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    async setAgentRole(identity, role) {
      await client.callReducer("configureMember", {
        identity, role: { tag: role }, unitId: undefined, producerSession: undefined, package: undefined,
      });
    },
    close: () => client.close(),
  };
}

function sanitizeChildEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^(LMNR_|OTEL_|OTEL_EXPORTER_|LANGFUSE_|BRAINTRUST_|TRACE_|TRACING_|VERCEL_OTEL_)/u.test(name)) delete env[name];
  }
  env.OTEL_SDK_DISABLED = "true";
  env.NEMEIA_INSTRUMENTATION_MODE = "local-noop";
  delete env.NEMEIA_EVE_WAKE_URL;
  return env;
}

function bigintValue(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  throw new Error(`generated row has no valid ${field}`);
}

function timestampMillis(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value === "object" && typeof (value as { readonly toISOString?: unknown }).toISOString === "function") {
    const parsed = Date.parse((value as { readonly toISOString: () => string }).toISOString());
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function usableUnitGrant(row: GeneratedRow | undefined, agentId: string): boolean {
  if (row?.agentId !== agentId) return false;
  if (row.expiresAt === undefined || row.expiresAt === null) return true;
  const expiresAt = timestampMillis(row.expiresAt);
  return expiresAt !== undefined && expiresAt > Date.now();
}

async function waitFor(condition: () => boolean | Promise<boolean>, description: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await condition()) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`g2_loopback_timeout:${description}`);
}

export async function persistChildOutput(result: ChildResult, files: ChildOutputFiles): Promise<void> {
  await Promise.all([
    [files.stdoutFile, redactChildText(result.stdout)],
    [files.stderrFile, redactChildText(result.stderr)],
    [`${files.stdoutFile}.diagnostics.json`, `${childFailureDetail(result)}\n`],
  ].map(async ([pathname, content]) => {
    // These paths are allocated inside this run's private evidence directory.
    await writeFile(pathname!, content!, { mode: 0o600 });
    await chmod(pathname!, 0o600);
  }));
}

export async function waitForMarker(
  pathname: string,
  expected: string,
  childResult: CapturedChild,
  timeoutMs: number,
  outputFiles?: ChildOutputFiles,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: ChildResult | undefined;
  void childResult.exited.then((result) => { exited = result; });
  const files = outputFiles === undefined
    ? ""
    : `;childStdoutFile=${outputFiles.stdoutFile};childStderrFile=${outputFiles.stderrFile};childDiagnosticsFile=${outputFiles.stdoutFile}.diagnostics.json`;
  while (Date.now() <= deadline) {
    if (exited !== undefined) {
      const latest = childResult.snapshot();
      if (outputFiles !== undefined) await persistChildOutput(latest, outputFiles);
      throw new Error(`eve_eval_exited_before_${expected}:code=${latest.code}${files};failure=${childFailureDetail(latest)}`);
    }
    try {
      if ((await readFile(pathname, "utf8")).trim() === expected) return;
    } catch {
      // The child has not created the marker yet.
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
  }
  const latest = childResult.snapshot();
  if (outputFiles !== undefined) await persistChildOutput(latest, outputFiles);
  throw new Error(`g2_loopback_timeout:marker:${expected}${files};failure=${childFailureDetail(latest)}`);
}

async function isolatedEveApp(sourceRoot: string, evidenceDirectory: string): Promise<string> {
  // Eve resolves symlinked project roots before locating evals. Give each
  // child a physical app tree, while parent-level links preserve the fixture's
  // authored relative imports into the real production agent tree.
  const hierarchyRoot = join(evidenceDirectory, "eve-root");
  const appRoot = join(hierarchyRoot, "agent", "eve-eval-fixture");
  await mkdir(join(hierarchyRoot, "agent"), { recursive: true, mode: 0o700 });
  await mkdir(appRoot, { recursive: true, mode: 0o700 });
  await cp(join(sourceRoot, "agent"), join(appRoot, "agent"), { recursive: true });
  await cp(join(sourceRoot, "evals"), join(appRoot, "evals"), { recursive: true });
  // Use canonical package directories without sharing the repository's Eve
  // cache.  The physical app root isolates .eve workflow state while these
  // links preserve the authored project's package resolution.
  await mkdir(join(appRoot, "node_modules/.bin"), { recursive: true, mode: 0o700 });
  for (const packageName of ["ai", "eve", "just-bash", "spacetimedb", "zod"]) {
    await symlink(join(root, "node_modules", packageName), join(appRoot, "node_modules", packageName), "dir");
  }
  await symlink(join(root, "node_modules/.bin/eve"), join(appRoot, "node_modules/.bin/eve"), "file");
  await cp(join(sourceRoot, "package.json"), join(appRoot, "package.json"));
  await cp(join(sourceRoot, "package-lock.json"), join(appRoot, "package-lock.json"));
  await symlink(join(root, "agent/sandbox.ts"), join(hierarchyRoot, "agent/sandbox.ts"), "file");
  await symlink(join(root, "agent/lib"), join(hierarchyRoot, "agent/lib"), "dir");
  await symlink(join(root, "agent/hooks"), join(hierarchyRoot, "agent/hooks"), "dir");
  await symlink(join(root, "agent/channels"), join(hierarchyRoot, "agent/channels"), "dir");
  await symlink(join(root, "world-client"), join(hierarchyRoot, "world-client"), "dir");
  return appRoot;
}

export function waitForChild(child: ChildProcess, env: NodeJS.ProcessEnv = {}): CapturedChild {
  let stdout = "";
  let stderr = "";
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;
  const secrets = Object.entries(env).flatMap(([key, value]) =>
    /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)$/u.test(key) && value !== undefined && value.length >= 8 ? [value] : [],
  ).sort((left, right) => right.length - left.length);
  const snapshot = (): ChildResult => ({ code, signal, stdout: redactChildText(stdout, secrets), stderr: redactChildText(stderr, secrets) });
  let noteExit!: (result: ChildResult) => void;
  const exited = new Promise<ChildResult>((resolveExit) => { noteExit = resolveExit; });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
  const result = new Promise<ChildResult>((resolveResult) => {
    child.once("error", (error) => {
      stderr += `\n${error.message}\n`;
      noteExit(snapshot());
      resolveResult(snapshot());
    });
    child.once("exit", (exitCode, exitSignal) => {
      code = exitCode; signal = exitSignal;
      noteExit(snapshot());
    });
    child.once("close", (exitCode, exitSignal) => {
      code = exitCode; signal = exitSignal;
      noteExit(snapshot());
      resolveResult(snapshot());
    });
  });
  return Object.assign(result, { exited, snapshot });
}

function actionProposalFor(missionId: string, objectiveId: string, target: QualificationTarget): string {
  return JSON.stringify({
    kind: "navigate",
    missionId,
    objectiveId,
    mapId: target.mapId,
    targetFrameId: target.frameId,
    target: {
      positionM: { x: 1, y: 2, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  });
}

async function ensureQualificationMission(
  operator: LoopbackAdapter,
  agent: LoopbackAdapter,
  target: QualificationTarget,
  handoff: QualificationHandoff,
  timeoutMs: number,
  requestedIds?: { readonly missionId: string; readonly objectiveId: string },
  description = "Eve G2 delayed WorldClient subscription qualification",
): Promise<{ readonly missionId: string; readonly objectiveId: string; readonly assigned: boolean }> {
  const suffix = `${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const missionId = requestedIds?.missionId ?? `mission-g2-eve-${suffix}`;
  const objectiveId = requestedIds?.objectiveId ?? `objective-g2-eve-${suffix}`;
  await operator.callReducer("createMission", {
    missionId,
    spec: {
      description,
      template: undefined,
      objectives: [{
        id: objectiveId,
        description: "Observe the seeded blue backpack while the agent is thinking",
        dependsOn: [],
        optional: false,
        criterion: {
          tag: "Observed",
          value: { entityId: target.entityId, facet: { tag: "Semantic" }, maxAgeMs: 120_000 },
        },
      }],
      deadlineAt: undefined,
    },
  });
  await waitFor(
    async () => (await operator.readSnapshot()).assignedMissions.some((row) => row.id === missionId),
    "operator mission subscription",
    timeoutMs,
  );
  const operatorSnapshot = await operator.readSnapshot();
  const mission = operatorSnapshot.assignedMissions.find((row) => row.id === missionId);
  const agentRow = operatorSnapshot.relevantAgents.find((row) => row.id === handoff.agentId);
  if (mission === undefined || agentRow === undefined) throw new Error("qualification mission or configured agent is not visible to operator");
  const existingMembership = operatorSnapshot.relevantMissionAgents.find((row) => row.missionId === missionId && row.agentId === handoff.agentId && row.active);
  if (existingMembership === undefined) {
    await operator.callReducer("assignMission", {
      missionId,
      agentId: handoff.agentId,
      expectedMissionRevision: bigintValue(mission.revision, "mission revision"),
      expectedAgentRevision: bigintValue(agentRow.revision, "agent revision"),
    });
  }
  await waitFor(
    async () => (await agent.readSnapshot()).assignedMissions.some((row) => row.id === missionId),
    "agent assigned mission subscription",
    timeoutMs,
  );
  return { missionId, objectiveId, assigned: true };
}

function stateTag(row: GeneratedRow | undefined): string | undefined {
  const state = row?.state;
  if (typeof state === "string") return state;
  if (state !== null && typeof state === "object" && typeof state.tag === "string") return state.tag;
  return undefined;
}

function executionNeedsCancellation(row: GeneratedRow): boolean {
  const tag = stateTag(row)?.toLowerCase();
  return tag === "accepted" || tag === "running";
}

/**
 * Close only the mission/executions allocated by this G2 run.  These are
 * production reducers through the operator identity; no row is deleted and
 * no synthetic terminal state is written by the fixture.
 */
async function cleanupQualificationMutation(
  operator: LoopbackAdapter,
  mutation: { readonly missionId: string; readonly objectiveId: string },
  evidenceFile: string,
  timeoutMs: number,
): Promise<MutationCleanup> {
  const cancellationRequestedExecutionIds: string[] = [];
  let snapshot = await operator.readSnapshot();
  const initialExecutions = snapshot.relevantExecutions.filter((row) => row.missionId === mutation.missionId && typeof row.id === "string");
  for (const execution of initialExecutions) {
    if (!executionNeedsCancellation(execution)) continue;
    await operator.callReducer("requestExecutionCancel", { executionId: execution.id });
    cancellationRequestedExecutionIds.push(execution.id);
  }

  const initialMission = snapshot.assignedMissions.find((row) => row.id === mutation.missionId);
  if (initialMission === undefined) {
    const cleanup: MutationCleanup = {
      missionId: mutation.missionId,
      executionIds: initialExecutions.map((row) => row.id),
      cancellationRequestedExecutionIds,
      missionState: undefined,
      executionStates: initialExecutions.map((row) => ({ id: row.id, state: stateTag(row) })),
      evidenceFile,
    };
    await writeFile(evidenceFile, `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 });
    return cleanup;
  }
  const missionState = stateTag(initialMission)?.toLowerCase();
  if (missionState !== "succeeded" && missionState !== "failed" && missionState !== "cancelled") {
    await operator.callReducer("cancelMission", {
      missionId: mutation.missionId,
      expectedRevision: bigintValue(initialMission.revision, "mission revision"),
    });
  }

  await waitFor(
    async () => {
      snapshot = await operator.readSnapshot();
      const mission = snapshot.assignedMissions.find((row) => row.id === mutation.missionId);
      const missionTag = stateTag(mission)?.toLowerCase();
      const executions = snapshot.relevantExecutions.filter((row) => row.missionId === mutation.missionId);
      return (missionTag === "closing" || missionTag === "cancelled") && !executions.some(executionNeedsCancellation);
    },
    "G2 authorized cancellation state",
    timeoutMs,
  );
  const cancellingIds = snapshot.relevantExecutions
    .filter((row) => row.missionId === mutation.missionId && stateTag(row) === "Cancelling")
    .map((row) => String(row.id));
  let controllerCleanupReportFile: string | undefined;
  if (cancellingIds.length > 0) {
    const cleanupChild = spawn(process.execPath, [join(root, "scripts/close-held-g2.mjs"), ...cancellingIds], {
      cwd: root, env: sanitizeChildEnvironment(), stdio: ["ignore", "pipe", "pipe"],
    });
    const cleanupResult = await waitForChild(cleanupChild);
    const outputFiles = {
      stdoutFile: join(dirname(evidenceFile), "g2-controller-cleanup.stdout.log"),
      stderrFile: join(dirname(evidenceFile), "g2-controller-cleanup.stderr.log"),
    };
    await persistChildOutput(cleanupResult, outputFiles);
    if (cleanupResult.code !== 0) throw new Error(`scoped G2 controller cleanup failed; ${outputFiles.stderrFile}; ${childFailureDetail(cleanupResult)}`);
    const line = cleanupResult.stdout.trim().split(/\r?\n/u).reverse().find((value) => value.startsWith('{"checks":'));
    if (line === undefined) throw new Error("scoped G2 cleanup returned no check report");
    const report = JSON.parse(line) as { checks: Record<string, unknown>; reportPath: string };
    const required = ["allCancelled", "missionsCancelled", "noActiveReservation", "safeStateConfirmed", "noExecute", "freshCommittedProof"];
    if (!required.every((name) => report.checks[name] === true)) throw new Error("scoped G2 cleanup did not pass every safety check");
    controllerCleanupReportFile = join(dirname(evidenceFile), "g2-controller-cleanup-report.json");
    await cp(report.reportPath, controllerCleanupReportFile);
  } else {
    await operator.callReducer("reconcileMission", { missionId: mutation.missionId });
  }
  await waitFor(async () => {
    snapshot = await operator.readSnapshot();
    return stateTag(snapshot.assignedMissions.find((row) => row.id === mutation.missionId)) === "Cancelled" &&
      snapshot.relevantExecutions.filter((row) => row.missionId === mutation.missionId).every((row) => stateTag(row) === "Cancelled");
  }, "G2 terminal cancellation cleanup", timeoutMs);
  const finalMission = snapshot.assignedMissions.find((row) => row.id === mutation.missionId);
  const finalExecutions = snapshot.relevantExecutions
    .filter((row) => row.missionId === mutation.missionId && typeof row.id === "string")
    .map((row) => ({ id: row.id, state: stateTag(row) }));
  const cleanup: MutationCleanup = {
    missionId: mutation.missionId,
    executionIds: finalExecutions.map((row) => row.id),
    cancellationRequestedExecutionIds,
    missionState: stateTag(finalMission),
    executionStates: finalExecutions,
    evidenceFile,
    controllerCleanupReportFile,
  };
  await writeFile(evidenceFile, `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 });
  return cleanup;
}

async function cleanupPriorQualificationMutations(
  operator: LoopbackAdapter,
  evidenceFile: string,
  timeoutMs: number,
): Promise<void> {
  let snapshot = await operator.readSnapshot();
  const missionRows = snapshot.assignedMissions.filter((row) => typeof row.id === "string" && row.id.startsWith("mission-g2-eve-"));
  const executionRows = snapshot.relevantExecutions.filter((row) => typeof row.missionId === "string" && row.missionId.startsWith("mission-g2-eve-") && typeof row.id === "string");
  const cancellationRequestedExecutionIds: string[] = [];
  for (const execution of executionRows) {
    if (!executionNeedsCancellation(execution)) continue;
    await operator.callReducer("requestExecutionCancel", { executionId: execution.id });
    cancellationRequestedExecutionIds.push(execution.id);
  }
  for (const mission of missionRows) {
    const tag = stateTag(mission)?.toLowerCase();
    if (tag !== "active" && tag !== "closing") continue;
    await operator.callReducer("cancelMission", {
      missionId: mission.id,
      expectedRevision: bigintValue(mission.revision, "mission revision"),
    });
  }
  await waitFor(
    async () => {
      snapshot = await operator.readSnapshot();
      return !snapshot.relevantExecutions.some((row) => row.missionId?.startsWith("mission-g2-eve-") && executionNeedsCancellation(row));
    },
    "prior G2 accepted execution cancellation request",
    timeoutMs,
  );
  const remaining = snapshot.relevantExecutions
    .filter((row) => row.missionId?.startsWith("mission-g2-eve-") && typeof row.id === "string")
    .map((row) => ({ id: row.id, missionId: row.missionId, state: stateTag(row) }))
    .filter((row) => row.state !== undefined && !["succeeded", "cancelled", "failed"].includes(row.state.toLowerCase()));
  const evidence = {
    cancellationRequestedExecutionIds,
    missions: snapshot.assignedMissions
      .filter((row) => row.id?.startsWith("mission-g2-eve-"))
      .map((row) => ({ id: row.id, state: stateTag(row), revision: row.revision })),
    remainingExecutions: remaining,
    evidenceFile,
  };
  await writeFile(evidenceFile, `${JSON.stringify(evidence, (_, value) => typeof value === "bigint" ? String(value) : value, 2)}\n`, { mode: 0o600 });
  if (remaining.length > 0) {
    throw new Error(`G2 prior execution requires authorized controller safe closure: ${remaining.map((row) => `${row.id}:${row.state}`).join(",")}; evidenceFile=${evidenceFile}`);
  }
}

async function ensureUnitGrant(
  operator: LoopbackAdapter,
  agent: LoopbackAdapter,
  handoff: QualificationHandoff,
  timeoutMs: number,
): Promise<boolean> {
  const current = (await operator.readSnapshot()).relevantUnitAssignments.find((row) => row.unitId === handoff.unitId);
  if (!usableUnitGrant(current, handoff.agentId)) {
    await operator.callReducer("assignUnit", {
      unitId: handoff.unitId,
      agentId: handoff.agentId,
      expectedRevision: current === undefined ? 0n : bigintValue(current.revision, "unit assignment revision"),
      actionNames: Array.isArray(current?.actionNames)
        ? current.actionNames.filter((value: unknown): value is string => typeof value === "string")
        : [],
      expiresAt: undefined,
    });
  }
  await waitFor(
    async () => usableUnitGrant(
      (await agent.readSnapshot()).relevantUnitAssignments.find((row) => row.unitId === handoff.unitId),
      handoff.agentId,
    ),
    "agent generated Unit grant subscription",
    timeoutMs,
  );
  return true;
}

async function qualificationTarget(operator: LoopbackAdapter, handoff: QualificationHandoff): Promise<QualificationTarget> {
  const snapshot = await operator.readSnapshot();
  const knownEntityIds = new Set(snapshot.relevantEntities.filter((row) => row.id !== handoff.unitId && String(row.kind?.tag ?? row.kind).toLowerCase() === "object").map((row) => row.id));
  const semantic = snapshot.relevantSemantic.find((row) => knownEntityIds.has(row.entityId));
  if (semantic === undefined) throw new Error("G2 requires a generated semantic observation in the authorized operator view");
  const map = snapshot.relevantLocalMaps.find((row) => row.unitId === handoff.unitId && row.rootFrameId === semantic.frameId && row.headRevision !== undefined);
  if (map === undefined) throw new Error("G2 requires a generated local-map head in the authorized operator view");
  if (typeof semantic.observationId !== "string" || semantic.observationId.length === 0) {
    throw new Error("G2 requires a generated semantic observation id for the permission probe");
  }
  return { entityId: semantic.entityId, mapId: map.id, frameId: map.rootFrameId, observationId: semantic.observationId };
}

function childEnvironment({
  base,
  handoff,
  agentToken,
  ownerPrincipal,
  ledgerFile,
  actionProposal,
  target,
  evidenceDirectory,
  expectedMissionId,
  actionOnly = false,
  permissionOnly = false,
  permissionObservationId,
}: {
  readonly base: NodeJS.ProcessEnv;
  readonly handoff: QualificationHandoff;
  readonly agentToken: string;
  readonly ownerPrincipal: string;
  readonly ledgerFile: string;
  readonly actionProposal: string;
  readonly target?: QualificationTarget;
  readonly evidenceDirectory: string;
  readonly expectedMissionId?: string;
  readonly actionOnly?: boolean;
  readonly permissionOnly?: boolean;
  readonly permissionObservationId?: string;
}): NodeJS.ProcessEnv {
  const env = { ...base };
  env.NEMEIA_WORLD_URI = handoff.uri;
  env.NEMEIA_WORLD_DATABASE = handoff.databaseName;
  env.NEMEIA_WORLD_ID = handoff.worldId;
  env.NEMEIA_AGENT_ID = handoff.agentId;
  env.NEMEIA_G2_EXPECTED_UNIT_ID = handoff.unitId;
  env.NEMEIA_WORLD_TOKEN = agentToken;
  env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID = ownerPrincipal;
  env.NEMEIA_AGENT_LEDGER = ledgerFile;
  env.NEMEIA_G2_ACTION_PROPOSAL_JSON = actionProposal;
  if (target !== undefined) {
    env.NEMEIA_G2_EXPECTED_ENTITY_ID = target.entityId;
    env.NEMEIA_G2_EXPECTED_MAP_ID = target.mapId;
    env.NEMEIA_G2_EXPECTED_OBSERVATION_ID = target.observationId;
  } else {
    delete env.NEMEIA_G2_EXPECTED_ENTITY_ID;
    delete env.NEMEIA_G2_EXPECTED_MAP_ID;
  }
  if (expectedMissionId !== undefined) env.NEMEIA_G2_EXPECTED_MISSION_ID = expectedMissionId;
  env.NEMEIA_WORLD_AUTH_SECRET = env.NEMEIA_WORLD_AUTH_SECRET ?? randomBytes(32).toString("hex");
  env.NEMEIA_WORLD_AUTH_ISSUER = env.NEMEIA_WORLD_AUTH_ISSUER ?? "nemeia-g2-loopback";
  env.NEMEIA_WORLD_AUTH_AUDIENCE = env.NEMEIA_WORLD_AUTH_AUDIENCE ?? "nemeia-g2-eve";
  const issuer = env.NEMEIA_WORLD_AUTH_ISSUER;
  if (issuer === undefined) throw new Error("G2 JWT issuer is not configured");
  env.NEMEIA_WORLD_AUTH_SUBJECT = env.NEMEIA_WORLD_AUTH_SUBJECT
    ?? (ownerPrincipal.startsWith(`${issuer}:`) ? ownerPrincipal.slice(issuer.length + 1) : ownerPrincipal);
  if (`${issuer}:${env.NEMEIA_WORLD_AUTH_SUBJECT}` !== ownerPrincipal) {
    throw new Error("G2 JWT subject does not resolve to the configured Eve owner principal");
  }
  env.NEMEIA_EVAL_TIMEOUT_MS = env.NEMEIA_EVAL_TIMEOUT_MS ?? "90000";
  env.NEMEIA_EVAL_RESULT_FILE = join(evidenceDirectory, actionOnly ? "g3-eve-command-evidence.json" : permissionOnly ? "g2-permission-child-evidence.json" : "g2-eve-evidence.json");
  const phase = actionOnly ? "g3" : permissionOnly ? "g2-permission" : "g2";
  env.NEMEIA_EVAL_THINKING_FILE = join(evidenceDirectory, `${phase}-thinking`);
  env.NEMEIA_EVAL_RELEASE_FILE = join(evidenceDirectory, `${phase}-release`);
  env.NEMEIA_G2_WORLD_CHANGED_FILE = join(evidenceDirectory, "g2-world-changed");
  env.NEMEIA_EVAL_MODEL_CALL_FILE = join(evidenceDirectory, `${phase}-model-calls`);
  env.NEMEIA_EVAL_ACTION_CALL_FILE = join(evidenceDirectory, `${phase}-action-call`);
  env.NEMEIA_EVAL_PERMISSION_FIRST_RESULT_FILE = join(evidenceDirectory, permissionOnly ? "g2-permission-first-result" : "unused-permission-first-result");
  if (permissionObservationId !== undefined) env.NEMEIA_G2_PERMISSION_OBSERVATION_ID = permissionObservationId;
  if (actionOnly) env.NEMEIA_EVAL_ACTION_ONLY = "1";
  else delete env.NEMEIA_EVAL_ACTION_ONLY;
  if (permissionOnly) env.NEMEIA_EVAL_PERMISSION_ONLY = "1";
  else delete env.NEMEIA_EVAL_PERMISSION_ONLY;
  return env;
}

async function startEveEval({
  cwd,
  env,
  evalId = "world-runtime",
}: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly evalId?: string;
}): Promise<{ readonly child: ChildProcess; readonly result: CapturedChild }> {
  const eveCli = join(cwd, "node_modules/.bin/eve");
  const child = spawn(eveCli, ["eval", evalId, "--json", "--timeout", env.NEMEIA_EVAL_TIMEOUT_MS ?? "90000", "--skip-report"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { child, result: waitForChild(child, env) };
}

async function readEvidence(pathname: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(pathname, "utf8")) as Record<string, unknown>;
}

function eventStep(evidence: Record<string, unknown>): { readonly sessionId: string; readonly turnId?: string; readonly stepIndex?: number } {
  const value = evidence.step;
  if (value !== null && typeof value === "object") {
    const step = value as Record<string, unknown>;
    if (typeof step.sessionId === "string") return {
      sessionId: step.sessionId,
      ...(typeof step.turnId === "string" ? { turnId: step.turnId } : {}),
      ...(typeof step.stepIndex === "number" ? { stepIndex: step.stepIndex } : {}),
    };
  }
  return { sessionId: "unknown" };
}

async function invokePublicEveAction({
  fixtureRoot,
  env,
  proposal,
  timeoutMs,
}: {
  readonly fixtureRoot: string;
  readonly env: NodeJS.ProcessEnv;
  readonly proposal: string;
  readonly timeoutMs: number;
}): Promise<EveCommandEvidence> {
  const started = await startEveEval({ cwd: fixtureRoot, env });
  const result = await started.result;
  const outputFiles = {
    stdoutFile: join(dirname(env.NEMEIA_EVAL_RESULT_FILE!), "g3-eve-command.stdout.log"),
    stderrFile: join(dirname(env.NEMEIA_EVAL_RESULT_FILE!), "g3-eve-command.stderr.log"),
  } satisfies ChildOutputFiles;
  await persistChildOutput(result, outputFiles);
  if (result.code !== 0) {
    throw new Error(`actual Eve trusted command eval failed;childStdoutFile=${outputFiles.stdoutFile};childStderrFile=${outputFiles.stderrFile};failure=${childFailureDetail(result)}`);
  }
  const evidence = await readEvidence(env.NEMEIA_EVAL_RESULT_FILE!);
  const receipt = evidence.receipt;
  const retryReceipt = evidence.retryReceipt;
  if (receipt === undefined) throw new Error("actual Eve trusted command evidence has no parsed tool result");
  if (retryReceipt === undefined) throw new Error("actual Eve trusted command evidence has no parsed retry tool result");
  const lifecycle = Array.isArray(evidence.eventTypes) ? evidence.eventTypes.filter((value): value is string => typeof value === "string") : [];
  return {
    receipt,
    retryReceipt,
    step: eventStep(evidence),
    evidence: {
      lifecycle,
      bashTool: evidence.bashTool === true,
      actionCommandPath: evidence.actionCommandPath === true,
    },
  };
}

async function runPermissionRevocationProbe({
  administrator,
  agent,
  target,
  handoff,
  agentToken,
  ownerPrincipal,
  ledgerFile,
  fixtureRoot,
  evidenceDirectory,
  timeoutMs,
}: {
  readonly administrator: MemberAdministrator;
  readonly agent: LoopbackAdapter;
  readonly target: QualificationTarget;
  readonly handoff: QualificationHandoff;
  readonly agentToken: string;
  readonly ownerPrincipal: string;
  readonly ledgerFile: string;
  readonly fixtureRoot: string;
  readonly evidenceDirectory: string;
  readonly timeoutMs: number;
}): Promise<PermissionEvidence> {
  const agentIdentity = await agent.getIdentity();
  const before = (await agent.readSnapshot()).readiness[0];
  const env = childEnvironment({
    base: sanitizeChildEnvironment(),
    handoff,
    agentToken,
    ownerPrincipal,
    ledgerFile,
    actionProposal: "{}",
    target,
    evidenceDirectory,
    permissionOnly: true,
    permissionObservationId: target.observationId,
  });
  const firstResultFile = env.NEMEIA_EVAL_PERMISSION_FIRST_RESULT_FILE!;
  const releaseFile = env.NEMEIA_EVAL_RELEASE_FILE!;
  const evidenceFile = join(evidenceDirectory, "g2-permission-evidence.json");
  const outputFiles = {
    stdoutFile: join(evidenceDirectory, "g2-permission.stdout.log"),
    stderrFile: join(evidenceDirectory, "g2-permission.stderr.log"),
  } satisfies ChildOutputFiles;
  const permissionRoot = await isolatedEveApp(join(root, "agent/eve-eval-fixture"), join(evidenceDirectory, "permission-app"));
  const started = await startEveEval({ cwd: permissionRoot, env });
  let restored = false;
  try {
    await waitForMarker(firstResultFile, "{\"success\":true}", started.result, timeoutMs, outputFiles);
    await administrator.setAgentRole(agentIdentity, "Controller");
    await waitFor(
      async () => {
        const snapshot = await agent.readSnapshot();
        const readiness = snapshot.readiness[0];
        return readiness?.role === "controller" && snapshot.relevantEntities.length === 0 && snapshot.relevantLocalMaps.length === 0;
      },
      "agent generated views revoked after member demotion",
      timeoutMs,
    );
    await writeFile(releaseFile, "release\n", { mode: 0o600 });
    const childResult = await started.result;
    await persistChildOutput(childResult, outputFiles);
    if (childResult.code !== 0) {
      throw new Error(`permission probe Eve eval failed;childStdoutFile=${outputFiles.stdoutFile};childStderrFile=${outputFiles.stderrFile};failure=${childFailureDetail(childResult)}`);
    }
    const childEvidence = await readEvidence(env.NEMEIA_EVAL_RESULT_FILE!);
    const revokedReadDenied = childEvidence.revokedReadDenied === true;
    await administrator.setAgentRole(agentIdentity, "Agent");
    await waitFor(
      async () => {
        const snapshot = await agent.readSnapshot();
        const readiness = snapshot.readiness[0];
        return readiness?.role === "agent" && snapshot.relevantEntities.length > 0 && snapshot.relevantLocalMaps.length > 0;
      },
      "agent generated views restored after member grant",
      timeoutMs,
    );
    restored = true;
    const evidence: PermissionEvidence = {
      firstReadSucceeded: childEvidence.firstReadSucceeded === true,
      revokedReadDenied,
      restoredReadObserved: true,
      beforeRole: typeof before?.role === "string" ? before.role : undefined,
      revokedRole: "controller",
      restoredRole: "agent",
      evidenceFile,
    };
    await writeFile(evidenceFile, `${JSON.stringify({ ...childEvidence, ...evidence }, null, 2)}\n`, { mode: 0o600 });
    return evidence;
  } finally {
    if (!restored) {
      try {
        await administrator.setAgentRole(agentIdentity, "Agent");
      } catch {
        // Preserve the original probe failure; the report must not claim restore.
      }
    }
    if (started.child.exitCode === null && !started.child.killed) started.child.kill("SIGTERM");
    await persistChildOutput(await started.result, outputFiles);
  }
}

export async function createEveQualificationAdapter(): Promise<{
  readonly mode: "eve-loopback";
  readonly runG2SlowStep: (input: { readonly fixture: BackpackFixture; readonly model: G2SlowStepModel }) => Promise<G2Outcome>;
  readonly invokeTrustedCommand: (input: { readonly argv: readonly string[] }) => Promise<EveCommandEvidence>;
  readonly runDefaultApiOwnerProbe: () => Promise<{ readonly defaultApiOtherPrincipalDenied: true; readonly evidenceFile: string }>;
  readonly runAutomaticWakeQualification: () => Promise<{ readonly automaticWakeTested: true; readonly reportFile: string; readonly checks: Record<string, boolean> }>;
  readonly close: () => Promise<void>;
}> {
  const handoffPath = boundedEnv("NEMEIA_QUALIFICATION_HANDOFF") ?? defaultHandoffPath;
  const handoff = handoffFrom(await readJson(handoffPath));
  const modulePath = boundedEnv("NEMEIA_WORLD_CLIENT_MODULE") ?? join(handoff.runDirectory, "generated-module-bindings");
  const agentToken = await credential(handoff.agentTokenFile);
  await credential(handoff.operatorTokenFile);
  const createLoopbackAdapter = await loadLoopbackAdapter();
  const agent = await createLoopbackAdapter({
    modulePath,
    uri: handoff.uri,
    databaseName: handoff.databaseName,
    scopedIdentityFile: handoff.agentTokenFile,
    scopedIdentityFingerprint: undefined,
    processSupervisor: undefined,
  });
  const operator = await createLoopbackAdapter({
    modulePath,
    uri: handoff.uri,
    databaseName: handoff.databaseName,
    scopedIdentityFile: handoff.operatorTokenFile,
    scopedIdentityFingerprint: undefined,
    processSupervisor: undefined,
  });
  await agent.start();
  await operator.start();
  const configuredOwnerPrincipal = boundedEnv("NEMEIA_AGENT_OWNER_PRINCIPAL_ID") ?? boundedEnv("NEMEIA_EVE_OWNER_PRINCIPAL_ID");
  if (configuredOwnerPrincipal === undefined) {
    throw new Error("G2 requires an explicit Eve-owner principal mapping via NEMEIA_AGENT_OWNER_PRINCIPAL_ID; a SpacetimeDB identity hex is not an Eve principal");
  }
  const issuer = boundedEnv("NEMEIA_WORLD_AUTH_ISSUER") ?? "nemeia-g2-loopback";
  const ownerMapping = eveJwtOwnerPrincipal(configuredOwnerPrincipal, issuer);
  const ownerPrincipal = ownerMapping.principal;
  const fixtureRoot = join(root, "agent/eve-eval-fixture");
  const evidenceDirectory = join(handoff.runDirectory, `g2-eve-${process.pid}-${Date.now().toString(36)}`);
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const isolatedFixtureRoot = await isolatedEveApp(fixtureRoot, evidenceDirectory);
  const ledgerFile = boundedEnv("NEMEIA_AGENT_LEDGER") ?? join(evidenceDirectory, "agent-ledger.sqlite");
  let activeChild: ChildProcess | undefined;
  let administrator: MemberAdministrator | undefined;

  const runDefaultApiOwnerProbe = async (): Promise<{ readonly defaultApiOtherPrincipalDenied: true; readonly evidenceFile: string }> => {
    const directory = join(evidenceDirectory, `default-api-${randomUUID()}`);
    const appRoot = await isolatedEveApp(fixtureRoot, directory);
    const env = childEnvironment({ base: sanitizeChildEnvironment(), handoff, agentToken, ownerPrincipal,
      ledgerFile: join(directory, "agent-ledger.sqlite"), actionProposal: "{}", evidenceDirectory: directory });
    env.NEMEIA_EVAL_DEFAULT_API_ONLY = "1";
    const started = await startEveEval({ cwd: appRoot, env });
    const result = await started.result;
    const files = { stdoutFile: join(directory, "default-api.stdout.log"), stderrFile: join(directory, "default-api.stderr.log") };
    await persistChildOutput(result, files);
    if (result.code !== 0) throw new Error(`default API owner probe failed; ${files.stdoutFile}; ${childFailureDetail(result)}`);
    const evidence = await readEvidence(env.NEMEIA_EVAL_RESULT_FILE!);
    if (evidence.defaultApiOtherPrincipalDenied !== true) throw new Error("default API did not deny another authenticated principal");
    return { defaultApiOtherPrincipalDenied: true, evidenceFile: env.NEMEIA_EVAL_RESULT_FILE! };
  };

  const runG2SlowStep = async ({ fixture, model }: { readonly fixture: BackpackFixture; readonly model: G2SlowStepModel }): Promise<G2Outcome> => {
    // Fail before any G2 mutation if the administrator handoff has not migrated.
    // G3 invokeTrustedCommand never opens or uses this connection.
    administrator ??= await openQualificationMemberAdministrator({
      adminTokenFile: handoff.adminTokenFile,
      createClient: (scopedIdentityFile) => createLoopbackAdapter({
        modulePath, uri: handoff.uri, databaseName: handoff.databaseName, scopedIdentityFile,
      }),
    });
    const timeoutMs = Number(boundedEnv("NEMEIA_G2_TIMEOUT_MS") ?? "90000");
    const baseEnv = sanitizeChildEnvironment();
    const priorCleanupEvidenceFile = join(evidenceDirectory, "g2-prior-cleanup-evidence.json");
    await cleanupPriorQualificationMutations(operator, priorCleanupEvidenceFile, timeoutMs);
    const target = await qualificationTarget(operator, handoff);
    const unitGrantPrepared = await ensureUnitGrant(operator, agent, handoff, timeoutMs);
    const mutation = {
      missionId: `mission-g2-eve-${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      objectiveId: `objective-g2-eve-${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    };
    const actionProposal = actionProposalFor(mutation.missionId, mutation.objectiveId, target);
    const env = childEnvironment({
      base: baseEnv,
      handoff,
      agentToken,
      ownerPrincipal,
      ledgerFile,
      actionProposal,
      target,
      evidenceDirectory,
      expectedMissionId: mutation.missionId,
    });
    const thinkingFile = env.NEMEIA_EVAL_THINKING_FILE!;
    const releaseFile = env.NEMEIA_EVAL_RELEASE_FILE!;
    const changedFile = env.NEMEIA_G2_WORLD_CHANGED_FILE!;
    const outputFiles = {
      stdoutFile: join(evidenceDirectory, "g2-eve.stdout.log"),
      stderrFile: join(evidenceDirectory, "g2-eve.stderr.log"),
    } satisfies ChildOutputFiles;
    const cleanupEvidenceFile = join(evidenceDirectory, "g2-cleanup-evidence.json");
    await Promise.all([
      writeFile(thinkingFile, "\n", { mode: 0o600 }),
      writeFile(releaseFile, "\n", { mode: 0o600 }),
      writeFile(changedFile, "\n", { mode: 0o600 }),
    ]);
    const started = await startEveEval({ cwd: isolatedFixtureRoot, env });
    activeChild = started.child;
    let outcome: Omit<G2Outcome, "cleanup"> | undefined;
    let primaryError: unknown;
    try {
      await waitForMarker(thinkingFile, "thinking", started.result, timeoutMs, outputFiles);
      let resolveWorldChange!: () => void;
      const worldChange = new Promise<void>((resolveChange) => { resolveWorldChange = resolveChange; });
      const injectedModel = model({ waitForWorldChange: () => worldChange });
      const ensured = await ensureQualificationMission(operator, agent, target, handoff, timeoutMs, mutation);
      await writeFile(changedFile, "changed\n", { mode: 0o600 });
      resolveWorldChange();
      await injectedModel;
      await writeFile(releaseFile, "release\n", { mode: 0o600 });
      const childResult = await started.result;
      await persistChildOutput(childResult, outputFiles);
      if (childResult.code !== 0) {
        throw new Error(`actual Eve G2 eval failed;childStdoutFile=${outputFiles.stdoutFile};childStderrFile=${outputFiles.stderrFile};failure=${childFailureDetail(childResult)}`);
      }
      const evidence = await readEvidence(env.NEMEIA_EVAL_RESULT_FILE!);
      const contextIds = Array.isArray(evidence.contextIds) ? evidence.contextIds : [];
      const revisions = Array.isArray(evidence.worldRevisions) ? evidence.worldRevisions : [];
      const eventTypes = Array.isArray(evidence.eventTypes) ? evidence.eventTypes : [];
      const missionPresentInFreshContext = evidence.missionPresentInFreshContext === true;
      const permission = await runPermissionRevocationProbe({
        administrator,
        agent,
        target,
        handoff,
        agentToken,
        ownerPrincipal,
        ledgerFile,
        fixtureRoot: isolatedFixtureRoot,
        evidenceDirectory,
        timeoutMs,
      });
      const defaultApi = await runDefaultApiOwnerProbe();
      outcome = {
        automaticWakeTested: false,
        actualEveLifecycle: evidence.actualEveLifecycle === true && eventTypes.includes("session.started") && eventTypes.includes("step.started"),
        injectedModel: evidence.injectedModel === true,
        worldChangedDuringThinking: evidence.worldChangedDuringThinking === true && missionPresentInFreshContext,
        actualGeneratedWorldSubscription: contextIds.length >= 3 && missionPresentInFreshContext,
        usefulWorldContext: evidence.usefulWorldContext === true,
        authenticatedJustBashRead: evidence.authenticatedJustBashRead === true,
        nextStepFresh: evidence.nextStepFresh === true && revisions.length >= 2,
        sameStepPinned: evidence.sameStepPinned === true,
        revokedAccessDenied: permission.revokedReadDenied,
        permissionRestored: permission.restoredReadObserved,
        unauthorizedWakeDenied: evidence.unauthorizedWakeDenied === true,
        missionPresentInFreshContext,
        actionCommandPath: evidence.actionCommandPath === true,
        unitGrantPrepared,
        defaultApiOtherPrincipalDenied: defaultApi.defaultApiOtherPrincipalDenied,
        defaultApiEvidenceFile: defaultApi.evidenceFile,
        evidenceFile: env.NEMEIA_EVAL_RESULT_FILE!,
        childStdoutFile: outputFiles.stdoutFile,
        childStderrFile: outputFiles.stderrFile,
        permissionEvidenceFile: permission.evidenceFile,
        mutation: ensured,
      };
    } catch (error) {
      primaryError = error;
    } finally {
      if (activeChild !== undefined && activeChild.exitCode === null && !activeChild.killed) activeChild.kill("SIGTERM");
      const finalResult = await started.result;
      try {
        await persistChildOutput(finalResult, outputFiles);
        if (primaryError !== undefined) {
          primaryError = new Error(`${primaryError instanceof Error ? primaryError.message : String(primaryError)};finalChildFailure=${childFailureDetail(finalResult)}`);
        }
      } catch (diagnosticError) {
        primaryError = new Error(`${primaryError instanceof Error ? primaryError.message : "G2 child diagnostics failed"};diagnostics=${diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)}`);
      }
      activeChild = undefined;
    }
    let cleanup: MutationCleanup | undefined;
    let cleanupError: unknown;
    try {
      cleanup = await cleanupQualificationMutation(operator, mutation, cleanupEvidenceFile, timeoutMs);
    } catch (error) {
      cleanupError = error;
    }
    if (primaryError !== undefined) {
      if (cleanupError !== undefined) {
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${primaryError instanceof Error ? primaryError.message : String(primaryError)}; G2 cleanup failed: ${cleanupMessage}; cleanupEvidenceFile=${cleanupEvidenceFile}`);
      }
      throw primaryError;
    }
    if (cleanupError !== undefined) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      throw new Error(`G2 cleanup failed: ${cleanupMessage}; cleanupEvidenceFile=${cleanupEvidenceFile}`);
    }
    if (outcome === undefined || cleanup === undefined) throw new Error("G2 did not produce an outcome");
    return { ...outcome, cleanup };
  };

  const invokeTrustedCommand = async ({ argv }: { readonly argv: readonly string[] }): Promise<EveCommandEvidence> => {
    const proposal = argv.at(-1);
    if (proposal === undefined) throw new Error("actual Eve command callback received no proposal JSON");
    JSON.parse(proposal) as unknown;
    const commandDirectory = join(evidenceDirectory, `g3-command-${randomUUID()}`);
    const commandRoot = await isolatedEveApp(fixtureRoot, commandDirectory);
    const env = childEnvironment({
      base: sanitizeChildEnvironment(),
      handoff,
      agentToken,
      ownerPrincipal,
    ledgerFile,
    actionProposal: proposal,
    evidenceDirectory: commandDirectory,
      actionOnly: true,
    });
    await Promise.all([
      writeFile(env.NEMEIA_EVAL_RESULT_FILE!, "\n", { mode: 0o600 }),
      writeFile(env.NEMEIA_EVAL_ACTION_CALL_FILE!, "\n", { mode: 0o600 }),
    ]);
    const result = await invokePublicEveAction({ fixtureRoot: commandRoot, env, proposal, timeoutMs: 90_000 });
    return result;
  };

  const runAutomaticWakeQualification = async () => {
    // Explicit, separate entrypoint. Normal G2/G3 never launches a dispatcher.
    const { runActionFreeAutomaticWake } = await import("./g2-automatic-wake.ts");
    const { AUTO_MISSION_DESCRIPTION } = await import("../eve-eval-fixture/agent/automatic-wake-protocol.ts");
    const directory = join(evidenceDirectory, `automatic-wake-${randomUUID()}`);
    const appRoot = await isolatedEveApp(fixtureRoot, directory);
    const target = await qualificationTarget(operator, handoff);
    const missionIds = [0, 1, 2].map((index) => `mission-g2-auto-${randomUUID()}-${index}`);
    const baselineMissionId = `mission-g2-auto-${randomUUID()}-baseline`;
    const env = childEnvironment({ base: sanitizeChildEnvironment(), handoff, agentToken, ownerPrincipal,
      ledgerFile: join(directory, "automatic-wake.sqlite"), actionProposal: "{}", target, evidenceDirectory: directory });
    const closeSubscriptions = async () => {
      const results = await Promise.allSettled([administrator?.close(), operator.close(), agent.close()]);
      if (results.some((result) => result.status === "rejected")) throw new Error("automatic qualification subscriber closure failed");
    };
    try { return await runActionFreeAutomaticWake({
      root, fixtureRoot: appRoot, directory, env, missionIds, baselineMissionId,
      prepareUnitGrant: () => ensureUnitGrant(operator, agent, handoff, 15_000),
      createMission: async (missionId) => {
        await ensureQualificationMission(operator, agent, target, handoff, 15_000,
          { missionId, objectiveId: `objective-${missionId}` }, AUTO_MISSION_DESCRIPTION);
        const snapshot = await agent.readSnapshot();
        if (stateTag(snapshot.assignedMissions.find((row) => row.id === missionId)) !== "Active" ||
          !snapshot.relevantMissionAgents.some((row) => row.missionId === missionId && row.agentId === handoff.agentId && row.active)) {
          throw new Error(`automatic qualification mission is not actively assigned in the native Agent subscription: ${missionId}`);
        }
      },
      cleanupMission: async (missionId) => {
        const executions = (await operator.readSnapshot()).relevantExecutions.filter((row) => row.missionId === missionId);
        if (executions.length > 0) throw new Error(`action-free automatic qualification unexpectedly created executions for ${missionId}; authorized controller cleanup required`);
        return cleanupQualificationMutation(operator, { missionId, objectiveId: `objective-${missionId}` },
          join(directory, `${missionId}-cleanup.json`), 15_000);
      },
      executionRows: async () => Object.fromEntries((await operator.readSnapshot()).relevantExecutions.map((row) => [String(row.id),
        createHash("sha256").update(JSON.stringify(row, (_, value) => typeof value === "bigint" ? String(value) : value)).digest("hex")])),
      closeSubscriptions,
    }); } finally { await closeSubscriptions(); }
  };

  return {
    mode: "eve-loopback",
    runG2SlowStep,
    invokeTrustedCommand,
    runDefaultApiOwnerProbe,
    runAutomaticWakeQualification,
    async close() {
      if (activeChild !== undefined && activeChild.exitCode === null && !activeChild.killed) activeChild.kill("SIGTERM");
      await administrator?.close();
      await operator.close();
      await agent.close();
    },
  };
}
