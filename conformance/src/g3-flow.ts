import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
// The conformance package intentionally has no second SpacetimeDB dependency.
// Runtime uses the generated SDK copy owned by world-client; its explicit mjs
// path is not resolved to the adjacent declaration by the standalone G3
// tsconfig, so keep the generated Timestamp type and narrow the runtime seam.
// @ts-expect-error TS7016: the pinned SDK runtime entrypoint has no explicit-mjs declaration resolution
import { Timestamp as NativeTimestamp } from "../../world-client/node_modules/spacetimedb/dist/index.mjs";
import { WorldClient, type CurrentWorldSnapshot, type RequestExecutionParams } from "../../world-client/src/index.ts";
import { canonicalJson } from "../../world-client/src/json.ts";
import type {
  DbConnection,
} from "../../world-client/src/generated/index.ts";
import type {
  Execution,
  ExecutionResult,
  ExecutionSafetyProof,
  MissionSpec,
  Pose3,
} from "../../world-client/src/generated/types.ts";
import { createSyntheticStandardFixture, type SyntheticStandardFixture } from "../../perception/src/fixture.ts";
import type { ResourceGatewayPort } from "../../perception/src/resource-adapter.ts";
import type { AuthorizedResourceReader, TrustedWorkerSession } from "../../world-resources/src/resource-gateway.ts";
import {
  GeneratedControllerSession,
} from "../../local-controller/src/generated-controller-session.ts";
import {
  LocalController,
  type ControllerCommand,
  type ExecutorResult,
  type LocalReceipt,
  type NoMotionExecutor,
  type StopResult,
} from "../../local-controller/src/local-controller.ts";
import {
  createTrustedActionPort,
  type ActionReceipt,
  type TrustedActionPort,
  type TrustedActionProposal,
} from "../../agent/lib/world-bridge/action-boundary.ts";
import { DeliveryLedger } from "../../agent/lib/world-bridge/delivery-ledger.ts";
import type { StepIdentity, TrustedWorldBinding, WorldPrincipal } from "../../agent/lib/world-bridge/types.ts";

type GeneratedConnection = InstanceType<typeof DbConnection>;
type G3ControllerEpochSource = Pick<GeneratedConnection, "isActive" | "identity"> & {
  readonly db: {
    readonly relevantUnitControls: {
      readonly unitId: Pick<GeneratedConnection["db"]["relevantUnitControls"]["unitId"], "find">;
    };
  };
};

/** Read the enrolled epoch from the caller's confirmed generated subscription.
 * LocalController uses this only for a new ledger; reopening still increments
 * its persisted epoch and preserves its receipts and fencing behavior. */
export function confirmedG3ControllerEpoch(connection: G3ControllerEpochSource, unitId: string): bigint {
  if (!connection.isActive) throw new Error("controller generated connection is inactive");
  const control = connection.db.relevantUnitControls.unitId.find(unitId);
  if (!control || control.unitId !== unitId || !connection.identity || !control.controller.isEqual(connection.identity)) {
    throw new Error("G3 requires an enrolled Unit control for the current controller identity");
  }
  return control.epoch;
}

type Timestamp = Execution["updatedAt"];
const Timestamp = NativeTimestamp as unknown as {
  fromDate(date: Date): Timestamp;
};

const DEFAULT_WORLD_ID = "nemeia-local-world";
const PACKAGE_SHA256 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export interface AgentConnectionConfig {
  readonly uri: string | URL;
  readonly databaseName: string;
  /** A direct token is accepted only as a host-side connection input. It is never returned or logged. */
  readonly token?: string;
  readonly tokenFile?: string;
}

export interface G3ResourceGatewayAttachment {
  readonly gateway: ResourceGatewayPort;
  readonly session: TrustedWorkerSession;
  readonly reader: AuthorizedResourceReader;
}

export interface G3PerceptionAdapter {
  readonly generatedConnection?: () => GeneratedConnection | undefined;
  attachResourceGateway?(attachment: G3ResourceGatewayAttachment): unknown;
  ingestStandardSyntheticFixture(input: {
    readonly samples: SyntheticStandardFixture["samples"];
    readonly observation: Omit<SyntheticStandardFixture["observation"], "semantic"> & {
      readonly semantic?: SyntheticStandardFixture["observation"]["semantic"];
      readonly pose?: { readonly observedAt: string; readonly frameId: string; readonly value: Pose3 };
    };
    readonly mapProduct?: SyntheticStandardFixture["mapProduct"];
  }): Promise<unknown>;
}

export interface G3PostClaimEvidenceInput {
  readonly execution: Execution;
  /** The durable local result that caused this callback, including its
   * executor completion when one exists. */
  readonly receiptId: string;
  readonly localReceipt: LocalReceipt;
  /** Explicit no-motion measurement passed alongside the receipt. */
  readonly measuredState: {
    readonly outcome: LocalReceipt["outcome"];
    readonly safeState: LocalReceipt["safeState"];
    readonly effect: "none" | "unknown";
  };
  readonly phase: "result" | "safe-closure";
}

/**
 * This is deliberately an authorized perception seam, not a fixture value.
 * Implementations must publish a fresh generated Observation through the
 * perception identity and return the IDs/timestamp accepted by the module.
 */
export interface G3PostClaimEvidence {
  readonly unitObservationId?: string;
  /** Optional: old generated schemas required this only for approach success. */
  readonly targetObservationId?: string;
  /** The observation used by the reviewed Located finding. */
  readonly reviewObservationId?: string;
  readonly safeObservationId: string;
  readonly targetEntityId?: string;
  readonly observedAt: Timestamp | Date | string;
  /** A generated, module-shaped completion supplied by authorized perception. */
  readonly completion?: ExecutionResult;
}

export interface G3AuthorizedPerception {
  publishPostClaimEvidence(input: G3PostClaimEvidenceInput): Promise<G3PostClaimEvidence>;
}

export interface ActualEveInvocationEvidence {
  /** Parsed from the real Eve command result; no local ledger is substituted. */
  readonly receipt: unknown;
  /** Optional retry receipt from the same actual Eve step. */
  readonly retryReceipt?: unknown;
  readonly step: {
    readonly sessionId: string;
    readonly turnId?: string;
    readonly stepIndex?: number;
  };
  readonly evidence: {
    readonly lifecycle: readonly string[];
    readonly bashTool: boolean;
    readonly actionCommandPath: boolean;
  };
}

export interface InvokeTrustedCommandInput {
  readonly argv: readonly string[];
}

export type InvokeTrustedCommand = (input: InvokeTrustedCommandInput) => Promise<ActualEveInvocationEvidence>;

export interface ActualG3FlowOptions {
  /** Admin/world-operator connection from the already-running loopback topology. */
  readonly operatorDbConnection: GeneratedConnection;
  /** A connected agent WorldClient, or a host-side connection config to build one. */
  readonly agentWorldClient?: WorldClient;
  readonly agentConnectionConfig?: AgentConnectionConfig;
  /** Controller identity connection from the already-running loopback topology. */
  readonly controllerDbConnection: GeneratedConnection;
  readonly perceptionAdapter: G3PerceptionAdapter;
  readonly perceptionDbConnection?: GeneratedConnection;
  readonly perceptionGateway?: G3ResourceGatewayAttachment;
  readonly authorizedPerception?: G3AuthorizedPerception;
  readonly runDirectory: string;
  readonly worldId?: string;
  readonly unitId: string;
  readonly agentId: string;
  readonly agentBinding?: TrustedWorldBinding;
  readonly agentPrincipal?: WorldPrincipal;
  readonly fixture?: SyntheticStandardFixture;
  /** Pass the Runtime-owned durable ledger when available; otherwise runDir is used. */
  readonly ledger?: DeliveryLedger;
  /** The host's real Eve step identity. The default is only for standalone qualification. */
  readonly initialStep?: StepIdentity;
  readonly invokeTrustedCommand?: InvokeTrustedCommand;
  readonly timeoutMs?: number;
}

export interface G3FlowCheck {
  readonly name: string;
  readonly result: boolean;
  readonly detail: string;
  readonly evidence?: readonly string[];
}

export interface G3NotRunCheck {
  readonly name: string;
  readonly detail: string;
}

export interface ActualG3FlowResult {
  readonly mode: "loopback-spacetimedb";
  readonly actualEve: boolean;
  readonly actualModule: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly observedChecks: readonly G3FlowCheck[];
  readonly notRunChecks: readonly G3NotRunCheck[];
  readonly evidence: readonly string[];
  readonly diagnostics: readonly string[];
  readonly ids: Readonly<Record<string, string>>;
  readonly receipts: readonly ActionReceipt[];
}

/** Exported only so the focused conformance test can prove cancellation does
 * not depend on a later executor release. It never drives an actuator. */
export class HeldNoMotionExecutor implements NoMotionExecutor {
  readonly kind = "fake-no-motion" as const;
  executeCalls = 0;
  stopCalls = 0;
  released = false;
  /** Explicit initial state of this isolated simulation, not a hardware measurement. */
  readonly initialSimulationPose: Pose3 = identityPose();
  #pending?: {
    readonly command: ControllerCommand;
    readonly resolve: (result: ExecutorResult) => void;
  };

  get pendingCommand(): ControllerCommand | undefined {
    return this.#pending?.command;
  }

  async execute(command: ControllerCommand, signal: AbortSignal): Promise<ExecutorResult> {
    this.executeCalls += 1;
    this.released = false;
    return new Promise<ExecutorResult>((resolveResult) => {
      const pending: { readonly command: ControllerCommand; resolve: (result: ExecutorResult) => void } = {
        command,
        resolve: () => undefined,
      };
      const resolve = (result: ExecutorResult): void => {
        if (this.#pending !== pending) return;
        this.#pending = undefined;
        signal.removeEventListener("abort", onAbort);
        resolveResult(result);
      };
      const onAbort = (): void => resolve(this.cancelled(command));
      pending.resolve = resolve;
      this.#pending = pending;
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  async stop(_reason: string): Promise<StopResult> {
    this.stopCalls += 1;
    const pending = this.#pending;
    if (pending) pending.resolve(this.cancelled(pending.command));
    return { safeState: "confirmed", detail: "held fake no-motion executor stopped before release" };
  }

  async proveSafeState(): Promise<StopResult> {
    return { safeState: "confirmed", detail: "held fake no-motion executor has no physical actuator" };
  }

  release(expectedExecutionId?: string): void {
    const pending = this.#pending;
    if (expectedExecutionId !== undefined && pending?.command.executionId !== expectedExecutionId) {
      throw new Error("G3 release requires the matching pending executor command");
    }
    if (!pending) return;
    this.released = true;
    const command = pending.command;
    pending.resolve({
      outcome: "succeeded",
      safeState: "confirmed",
      effect: "none",
      completion: command.kind === "navigate@1"
        ? {
            action: "navigate@1",
            outcome: "succeeded",
            finalPose: {
              frameId: command.targetFrameId,
              mapId: command.mapId,
              basisMapRevision: command.basisMapRevision,
              targetPose: command.targetPose,
            },
            localReceiptId: `held-no-motion:${command.executionId}`,
            safeClosureReceiptId: `held-no-motion:${command.executionId}`,
          }
        : {
            action: "approach@1",
            outcome: "failed",
            localReceiptId: `held-no-motion:${command.executionId}`,
            safeClosureReceiptId: `held-no-motion:${command.executionId}`,
            detail: "held G3 executor does not synthesize measured approach distance",
          },
    });
  }

  private cancelled(command: ControllerCommand): ExecutorResult {
    return {
      outcome: "cancelled",
      safeState: "confirmed",
      effect: "none",
      completion: command.kind === "navigate@1"
        ? {
            action: "navigate@1",
            outcome: "failed",
            localReceiptId: `held-cancelled:${command.executionId}`,
            safeClosureReceiptId: `held-cancelled:${command.executionId}`,
            detail: "cancelled before no-motion release",
          }
        : {
            action: "approach@1",
            outcome: "failed",
            localReceiptId: `held-cancelled:${command.executionId}`,
            safeClosureReceiptId: `held-cancelled:${command.executionId}`,
            detail: "cancelled before no-motion release",
          },
    };
  }
}

function identityText(identity: unknown): string {
  const value = identity as { toHexString?: () => string } | undefined;
  return typeof value?.toHexString === "function" ? value.toHexString() : String(identity ?? "");
}

function principalFromConnection(connection: GeneratedConnection): WorldPrincipal {
  const id = identityText(connection.identity);
  if (!id) throw new Error("agent connection identity is unavailable");
  return {
    principalId: id,
    principalType: "spacetimedb",
    authenticator: "spacetimedb",
  };
}

function timestamp(value: Timestamp | Date | string): Timestamp {
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string") return Timestamp.fromDate(new Date(value));
  return value;
}

function connectionReducer(connection: GeneratedConnection, name: string): (input: unknown) => Promise<void> {
  const reducer = (connection.reducers as unknown as Record<string, (input: unknown) => Promise<void>>)[name];
  if (typeof reducer !== "function") throw new Error(`generated reducer is unavailable: ${name}`);
  return reducer.bind(connection.reducers);
}

function tableRows(connection: GeneratedConnection, name: string): Iterable<unknown> | undefined {
  return (connection.db as unknown as Record<string, Iterable<unknown> | undefined>)[name];
}

function findRow<T extends Record<string, unknown>>(connection: GeneratedConnection, table: string, key: string, value: string): T | undefined {
  const rows = tableRows(connection, table);
  if (!rows) return undefined;
  for (const row of rows) {
    const candidate = row as Record<string, unknown>;
    if (String(candidate[key]) === value) return candidate as T;
  }
  return undefined;
}

async function readToken(pathname: string | undefined): Promise<string | undefined> {
  if (!pathname) return undefined;
  const token = (await readFile(resolve(pathname), "utf8")).trim();
  if (!token) throw new Error("agent token file is empty");
  return token;
}

async function waitFor(condition: () => boolean, description: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    signal?.throwIfAborted();
    if (condition()) return;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`actual_g3_timeout:${description}`);
}

/** Eve can continue teardown after its command has committed. Drive the real
 * controller lifecycle concurrently, and join both pieces of evidence. A
 * failed invocation aborts lifecycle polling before any later mutation. */
export async function runG3ConcurrentInvocation<T, U>(
  invoke: () => Promise<T>,
  lifecycle: (signal: AbortSignal) => Promise<U>,
): Promise<{ delivery: T; observed: U }> {
  const abort = new AbortController();
  const guarded = <V>(work: () => Promise<V>): Promise<V> => Promise.resolve().then(work).catch((error: unknown) => {
    abort.abort(error);
    throw error;
  });
  const [delivery, observed] = await Promise.all([
    guarded(invoke),
    guarded(() => lifecycle(abort.signal)),
  ]);
  return { delivery, observed };
}

/** A new acquisition of the fake executor's initialized stationary state,
 * using the existing resource-verifying perception pipeline and pinned map. */
export function createG3StationarySimulationFixture(
  fixture: SyntheticStandardFixture,
  observationId: string,
  pose: Pose3,
): Parameters<G3PerceptionAdapter["ingestStandardSyntheticFixture"]>[0] {
  const now = new Date().toISOString();
  const acquired = createSyntheticStandardFixture({
    unitId: fixture.unitId, producerId: fixture.producerId,
    producerSession: fixture.producerSession, sourceSessionId: fixture.sourceSessionId,
    localMapId: fixture.mapId, mapId: fixture.mapId, spatialFrameId: fixture.spatialFrameId,
    capturedAt: now, receivedAt: now, mapCapturedAt: now,
  });
  const sequence = fixture.samples.reduce((max, sample) => sample.sequence > max ? sample.sequence : max, 0n) + 1n;
  return {
    samples: acquired.samples.map((sample) => ({ ...sample, sequence })),
    observation: {
      ...acquired.observation, id: observationId, entityId: fixture.unitId,
      trackId: `${observationId}-track`, semantic: undefined,
      pose: { observedAt: now, frameId: fixture.spatialFrameId, value: pose },
    },
    // Initial map checkpoint was independently qualified; do not advance it.
    mapProduct: undefined,
  };
}

async function connectAgent(options: ActualG3FlowOptions): Promise<{ client: WorldClient; owned: boolean }> {
  if (options.agentWorldClient) {
    if (options.agentWorldClient.state !== "ready") {
      if (options.agentWorldClient.state === "disconnected" || options.agentWorldClient.state === "error") {
        options.agentWorldClient.connect();
      }
      options.agentWorldClient.subscribeCurrentWorld();
      await waitFor(() => options.agentWorldClient?.state === "ready", "agent generated snapshot", options.timeoutMs ?? 15_000);
    }
    return { client: options.agentWorldClient, owned: false };
  }
  const config = options.agentConnectionConfig;
  if (!config) throw new Error("agentWorldClient or agentConnectionConfig is required");
  const token = config.token ?? await readToken(config.tokenFile);
  const client = new WorldClient({ uri: config.uri, databaseName: config.databaseName, token });
  client.connect();
  client.subscribeCurrentWorld();
  await waitFor(() => client.state === "ready", "agent generated snapshot", options.timeoutMs ?? 15_000);
  return { client, owned: true };
}

function cloneFixture(base: SyntheticStandardFixture, options: ActualG3FlowOptions, suffix: string): SyntheticStandardFixture {
  const mapId = `g3-map-${suffix}`;
  const frameId = `g3-frame-${suffix}`;
  const observationId = `g3-observation-${suffix}`;
  const samples = base.samples.map((sample) => ({ ...sample, unitId: options.unitId, spatialFrameId: frameId }));
  const observation = {
    ...base.observation,
    id: observationId,
    localMapId: mapId,
    // Navigation does not select or manufacture a target entity. Preserve
    // any entity supplied by the authorized fixture for the later Located
    // review; post-claim evidence must name the existing observed entity.
    entityId: base.observation.entityId,
    semantic: { ...base.observation.semantic, frameId },
  };
  const mapProduct = {
    ...base.mapProduct,
    unitId: options.unitId,
    mapId,
    spatialFrameId: frameId,
    expectedHeadRevision: 0n,
    inputObservationIds: [observationId],
    layers: base.mapProduct.layers.map((layer) => ({ ...layer, frameId })),
  };
  return {
    ...base,
    unitId: options.unitId,
    localMapId: mapId,
    mapId,
    spatialFrameId: frameId,
    samples,
    observation,
    mapProduct,
  };
}

function freshFixture(options: ActualG3FlowOptions, suffix: string): SyntheticStandardFixture {
  const now = Date.now();
  const base = options.fixture ?? createSyntheticStandardFixture({
    unitId: options.unitId,
    localMapId: `g3-map-${suffix}`,
    mapId: `g3-map-${suffix}`,
    spatialFrameId: `g3-frame-${suffix}`,
    capturedAt: new Date(now).toISOString(),
    receivedAt: new Date(now + 10).toISOString(),
    mapCapturedAt: new Date(now + 20).toISOString(),
  });
  return cloneFixture(base, options, suffix);
}

function identityPose(): Pose3 {
  return {
    positionM: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

function isTerminal(row: Execution | null | undefined): boolean {
  return row?.state.tag === "Succeeded" || row?.state.tag === "Cancelled" || row?.state.tag === "Failed";
}

function hasMeasuredNavigateSuccess(row: Execution | undefined, executionId: string): boolean {
  if (!row || row.id !== executionId || row.state.tag !== "Succeeded" || row.result?.tag !== "Succeeded") return false;
  const completion = row.result.value.completion;
  return completion.tag === "Navigate" && completion.value.unitObservationId.length > 0 &&
    completion.value.localReceiptId.length > 0 && row.receiptId === completion.value.localReceiptId;
}

function actionProposal(ids: { missionId: string; objectiveId: string; mapId: string; frameId: string }): TrustedActionProposal {
  return {
    kind: "navigate",
    missionId: ids.missionId,
    objectiveId: ids.objectiveId,
    mapId: ids.mapId,
    targetFrameId: ids.frameId,
    target: identityPose(),
  };
}

function generatedCancelled(receiptId: string): ExecutionResult {
  return { tag: "Cancelled", value: { localReceiptId: receiptId } };
}

function makeMissionSpec(deadline: Timestamp): MissionSpec {
  return {
    description: "Actual generated SDK G3 located-object qualification",
    template: undefined,
    objectives: [{
      id: "located-object",
      description: "Review the authorized post-claim located evidence",
      dependsOn: [],
      optional: false,
      criterion: { tag: "Located", value: { description: "the synthetic target" } },
    }],
    deadlineAt: deadline,
  };
}

function checkMap(snapshot: CurrentWorldSnapshot, fixture: SyntheticStandardFixture): boolean {
  return snapshot.relevantLocalMaps.some((row) => row.id === fixture.mapId && row.unitId === fixture.unitId && row.headRevision !== undefined);
}

/**
 * Run the actual generated-SDK G3 composition against Integration's live
 * loopback connections. The helper owns no server lifecycle and never calls
 * an actuator: LocalController is explicitly bound to a held fake/no-motion
 * executor, while post-claim result and safe proof values come from the
 * authorized perception callback.
 */
export async function runActualG3Flow(options: ActualG3FlowOptions): Promise<ActualG3FlowResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const diagnostics: string[] = [];
  const receipts: ActionReceipt[] = [];
  const observedChecks: G3FlowCheck[] = [];
  const notRunChecks: G3NotRunCheck[] = [];
  const suffix = `${process.pid}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const worldId = options.worldId ?? DEFAULT_WORLD_ID;
  const missionId = `g3-mission-${suffix}`;
  const objectiveId = "located-object";
  const fixture = freshFixture(options, suffix);
  const initialStep = options.initialStep ?? { sessionId: `g3-${suffix}`, turnId: "actual-g3", stepIndex: 0 };
  let currentStep: StepIdentity = initialStep;
  let ledger = options.ledger;
  let ownsLedger = false;
  let agentOwned = false;
  let agent: WorldClient | undefined;
  let controller: LocalController | undefined;
  let session: GeneratedControllerSession | undefined;
  let action: TrustedActionPort | undefined;
  const postClaimEvidence = new Map<string, G3PostClaimEvidence>();
  let firstExecutionId = "";
  let secondExecutionId = "";
  let thirdExecutionId = "";
  let requestCalls = 0;
  let lostAckInjected = false;
  let firstAcceptedBeforeRetry = false;
  let firstControllerClaimed = false;
  let firstTerminal: Execution | undefined;
  let runningCancellationTerminal: Execution | undefined;
  let acceptedCancellationTerminal: Execution | undefined;
  let runningCancellationStopCalls = 0;
  let stopBeforeRelease = false;
  let acceptedBeforeClaim = false;
  let actualWorldEvidence = false;
  let actualEveEvidence = false;
  let sourceAcquisitionTimesPreserved = false;
  let sameStepRetried = false;
  const heldExecutor = new HeldNoMotionExecutor();
  let phase = "prepare";
  const initialPoseObservationId = `g3-stationary-unit-${suffix}`;

  const addCheck = (name: string, result: boolean, detail: string, evidence: readonly string[] = []): void => {
    observedChecks.push({ name, result, detail, ...(evidence.length ? { evidence } : {}) });
    if (!result) diagnostics.push(`${name}:${detail}`);
  };

  try {
    if (!options.operatorDbConnection.isActive) throw new Error("operator generated connection is inactive");
    if (!options.controllerDbConnection.isActive) throw new Error("controller generated connection is inactive");
    const connected = await connectAgent(options);
    agent = connected.client;
    agentOwned = connected.owned;
    const agentConnection = agent.connection;
    if (!agentConnection || !agentConnection.isActive) throw new Error("agent generated connection is inactive");
    const binding: TrustedWorldBinding = options.agentBinding ?? {
      worldId,
      agentId: options.agentId,
      principal: options.agentPrincipal ?? principalFromConnection(agentConnection),
    };
    const actualAgentPrincipal = principalFromConnection(agentConnection);
    if (binding.principal.principalId !== actualAgentPrincipal.principalId) {
      throw new Error("agent binding principal does not match the generated connection identity");
    }

    const perceptionConnection = options.perceptionDbConnection ?? options.perceptionAdapter.generatedConnection?.();
    if (!perceptionConnection?.isActive) throw new Error("perception generated connection is inactive");
    if (options.perceptionGateway) {
      if (typeof options.perceptionAdapter.attachResourceGateway !== "function") {
        throw new Error("perception adapter does not expose attachResourceGateway");
      }
      options.perceptionAdapter.attachResourceGateway(options.perceptionGateway);
    }

    const now = Date.now();
    const deadline = Timestamp.fromDate(new Date(now + 120_000));
    const createMission = connectionReducer(options.operatorDbConnection, "createMission");
    const assignMission = connectionReducer(options.operatorDbConnection, "assignMission");
    const assignUnit = connectionReducer(options.operatorDbConnection, "assignUnit");
    const setActionBinding = connectionReducer(options.operatorDbConnection, "setActionBinding");
    const initializeLocalMap = connectionReducer(perceptionConnection, "initializeLocalMap");
    const registerSpatialFrame = connectionReducer(perceptionConnection, "registerSpatialFrame");

    const agentProjection = agent.snapshot().relevantAgents.find((row) => row.id === options.agentId);
    if (!agentProjection) throw new Error("agent revision is not visible in the confirmed generated snapshot");
    await createMission({ missionId, spec: makeMissionSpec(deadline) });
    await assignMission({ missionId, agentId: options.agentId, expectedMissionRevision: 1n, expectedAgentRevision: agentProjection.revision });

    const existingBinding = agent.snapshot().relevantActionBindings.find(
      (row) => row.unitId === options.unitId && row.actionName === "navigate@1",
    );
    const bindingVersion = existingBinding?.version ?? 1n;
    if (existingBinding && existingBinding.policy.mode.tag !== "Simulation") {
      throw new Error("isolated G3 Unit has a non-simulation navigate binding");
    }
    if (!existingBinding) {
      await setActionBinding({
        unitId: options.unitId,
        actionName: "navigate@1",
        version: bindingVersion,
        policy: {
          executor: { name: "nemeia-no-motion", version: "1", sha256: PACKAGE_SHA256 },
          mode: { tag: "Simulation" },
          maxEvidenceAgeMs: 120_000,
          maxLinearMps: 0.2,
          maxRunMs: 10_000,
          toleranceM: 0.1,
        },
      });
    }
    const existingAssignment = agent.snapshot().relevantUnitAssignments.find((row) => row.unitId === options.unitId);
    const assignmentRevision = existingAssignment?.revision ?? 0n;
    const grantExpiry = Timestamp.fromDate(new Date(now + 90_000));
    await assignUnit({
      unitId: options.unitId,
      agentId: options.agentId,
      expectedRevision: assignmentRevision,
      actionNames: ["navigate@1"],
      expiresAt: grantExpiry,
    });
    await waitFor(
      () => agent?.snapshot().assignedMissions.some((row) => row.id === missionId) === true,
      "agent mission assignment",
      timeoutMs,
    );
    await waitFor(
      () => agent?.snapshot().relevantUnitAssignments.some((row) => row.unitId === options.unitId && row.agentId === options.agentId && row.actionNames.includes("navigate@1")) === true,
      "agent Unit grant",
      timeoutMs,
    );

    await registerSpatialFrame({
      input: { frameId: fixture.spatialFrameId, sourceSession: fixture.samples[0]?.sourceSessionId ?? fixture.producerSession, originEpoch: 0n, parentFrameId: undefined },
    });
    await initializeLocalMap({ mapId: fixture.mapId, unitId: options.unitId, rootFrameId: fixture.spatialFrameId });
    const fixtureResult = await options.perceptionAdapter.ingestStandardSyntheticFixture({
      samples: fixture.samples,
      observation: fixture.observation,
      mapProduct: fixture.mapProduct,
    });
    const replayAccepted = (fixtureResult as { replay?: { accepted?: readonly { capturedAt?: string }[] } } | undefined)?.replay?.accepted;
    sourceAcquisitionTimesPreserved = replayAccepted !== undefined && replayAccepted.length === fixture.samples.length &&
      replayAccepted.every((sample, index) => sample.capturedAt === fixture.samples[index]?.capturedAt);
    await waitFor(() => checkMap(agent!.snapshot(), fixture), "generated map checkpoint", timeoutMs);

    phase = "initial-stationary-simulation-pose";
    await options.perceptionAdapter.ingestStandardSyntheticFixture(
      createG3StationarySimulationFixture(fixture, initialPoseObservationId, heldExecutor.initialSimulationPose),
    );
    await waitFor(() => agent!.snapshot().relevantPoses.some((pose) =>
      pose.entityId === options.unitId && pose.frameId === fixture.spatialFrameId &&
      pose.observationId === initialPoseObservationId &&
      canonicalJson(pose.value) === canonicalJson(heldExecutor.initialSimulationPose)),
    "committed initial stationary simulation Unit pose", timeoutMs);

    await mkdir(resolve(options.runDirectory), { recursive: true });
    const ledgerPath = join(resolve(options.runDirectory), `g3-agent-${options.unitId}.sqlite`);
    if (!ledger) {
      ledger = new DeliveryLedger(ledgerPath);
      ownsLedger = true;
    }

    const world = {
      snapshot: () => agent!.snapshot(),
      requestExecution: async (request: RequestExecutionParams): Promise<void> => {
        requestCalls += 1;
        await agent!.requestExecution(request);
        if (!lostAckInjected) {
          lostAckInjected = true;
          throw new Error("simulated lost acknowledgement after actual generated reducer acceptance");
        }
      },
    };
    const authorizeCurrentPrincipal = async (current: TrustedWorldBinding): Promise<void> => {
      const live = agent!.connection?.identity;
      if (!live || identityText(live) !== current.principal.principalId) throw new Error("agent principal is no longer authorized");
    };
    const makeAction = (): TrustedActionPort => createTrustedActionPort({
      ledger: ledger!,
      world,
      hostContext: () => ({ binding, step: currentStep }),
      authorizeCurrentPrincipal,
    });
    if (!options.invokeTrustedCommand) action = makeAction();

    type ProposalDelivery = {
      readonly receipt: ActionReceipt;
      readonly retryReceipt?: ActionReceipt;
    };
    const invokeProposal = async (proposal: TrustedActionProposal): Promise<ProposalDelivery> => {
      const argv = ["nemeia", "world", "action", "propose", JSON.stringify(proposal)];
      if (options.invokeTrustedCommand) {
        // Eve owns the session/turn/step identity. The qualification helper
        // supplies only the command argv and validates the returned identity;
        // it never asks Eve to adopt a synthetic fixture step.
        const evidence = await options.invokeTrustedCommand({ argv });
        const checked = await verifyActualEveEvidence(evidence, proposal, agent!, binding, timeoutMs);
        actualEveEvidence = true;
        return checked;
      }
      if (!action) throw new Error("direct action port is unavailable");
      return { receipt: await action.propose(proposal, binding) };
    };

    controller = new LocalController({
      path: join(resolve(options.runDirectory), `controller-${options.unitId}.sqlite`),
      unitId: options.unitId,
      executor: heldExecutor,
      initialEpoch: confirmedG3ControllerEpoch(options.controllerDbConnection, options.unitId),
    });
    session = new GeneratedControllerSession({
      connection: options.controllerDbConnection,
      controller,
      unitId: options.unitId,
      resultFor: async (execution, receipt) => {
        if (receipt.outcome === "cancelled") return generatedCancelled(receipt.id);
        if (receipt.outcome === "failed") {
          return { tag: "Failed", value: { code: "no_motion_failed", detail: "held no-motion executor failed", localReceiptId: receipt.id } };
        }
        const evidence = await evidenceForExecution(options.authorizedPerception, postClaimEvidence, execution, receipt, "result");
        postClaimEvidence.set(execution.id, evidence);
        actualWorldEvidence = true;
        if (!evidence.completion) throw new Error("authorized perception must return the generated typed completion; navigation cannot invent distance or target observations");
        if (completionReceiptId(evidence.completion) !== receipt.id) throw new Error("generated completion receipt does not match local controller receipt");
        return evidence.completion;
      },
      safeProofFor: async (execution, receipt): Promise<ExecutionSafetyProof> => {
        const evidence = postClaimEvidence.get(execution.id) ?? await evidenceForExecution(options.authorizedPerception, postClaimEvidence, execution, receipt, "safe-closure");
        postClaimEvidence.set(execution.id, evidence);
        return {
          executionId: execution.id,
          unitId: execution.unitId,
          controllerEpoch: execution.controllerEpoch!,
          observationId: evidence.safeObservationId,
          observedAt: timestamp(evidence.observedAt),
        };
      },
      diagnostics: (event) => {
        if (event.name.includes("error") || event.name.includes("failed")) diagnostics.push(`${event.name}:${event.fields?.detail ?? "unknown"}`);
      },
    });
    await session.start();

    const proposal = actionProposal({ missionId, objectiveId, mapId: fixture.mapId, frameId: fixture.spatialFrameId });
    const waitForNewRequest = async (excluded: readonly string[], signal: AbortSignal): Promise<Execution> => {
      let found: Execution | undefined;
      await waitFor(() => {
        const rows = Array.from(options.controllerDbConnection.db.relevantExecutions).filter((row) =>
          row.missionId === missionId && row.objectiveId === objectiveId && row.unitId === options.unitId &&
          row.agentId === options.agentId && !excluded.includes(row.id));
        if (rows.length > 1) throw new Error("G3 invocation created more than one unique mission execution");
        found = rows[0];
        return found !== undefined;
      }, "unique G3 mission execution", timeoutMs, signal);
      if (found!.input.tag !== "Navigate" || found!.input.value.mapId !== fixture.mapId ||
          found!.input.value.targetFrameId !== fixture.spatialFrameId ||
          canonicalJson(found!.input.value.target) !== canonicalJson(heldExecutor.initialSimulationPose)) {
        throw new Error("G3 observed request differs from its stationary navigation proposal");
      }
      return found!;
    };
    const waitForHeld = async (executionId: string, signal: AbortSignal): Promise<void> => {
      await waitFor(() => heldExecutor.pendingCommand?.executionId === executionId,
        "matching held executor started", timeoutMs, signal);
    };
    const verifyDelivery = (delivery: ProposalDelivery, executionId: string): void => {
      const row = options.controllerDbConnection.db.relevantExecutions.id.find(executionId);
      if (!row) throw new Error("G3 observed execution disappeared before Eve receipt verification");
      const observedIds = new Set([firstExecutionId, secondExecutionId, thirdExecutionId].filter(Boolean));
      const missionRows = Array.from(options.controllerDbConnection.db.relevantExecutions)
        .filter((candidate) => candidate.missionId === missionId);
      if (missionRows.length !== observedIds.size || missionRows.some((candidate) => !observedIds.has(candidate.id))) {
        throw new Error("G3 Eve invocation/retry introduced an extra generated mission execution");
      }
      for (const receipt of [delivery.receipt, ...(delivery.retryReceipt ? [delivery.retryReceipt] : [])]) {
        assertG3ReceiptMatchesExecution(receipt, row);
        receipts.push(receipt);
      }
    };

    phase = "first-running-release";
    const { delivery: firstDelivery } = await runG3ConcurrentInvocation(() => invokeProposal(proposal), async (signal) => {
      const observed = await waitForNewRequest([], signal);
      firstExecutionId = observed.id;
      await waitForHeld(firstExecutionId, signal);
      // execute() has installed its pending token. Never await Eve teardown
      // (or poll for transient Running after teardown) before releasing it.
      heldExecutor.release(firstExecutionId);
      await waitFor(() => isTerminal(options.controllerDbConnection.db.relevantExecutions.id.find(firstExecutionId)),
        "first execution terminal receipt", timeoutMs, signal);
      firstTerminal = options.controllerDbConnection.db.relevantExecutions.id.find(firstExecutionId) ?? undefined;
      firstControllerClaimed = firstTerminal?.claimedAt !== undefined && firstTerminal.controllerEpoch !== undefined &&
        identityText(firstTerminal.controller) === identityText(options.controllerDbConnection.identity);
      return firstExecutionId;
    });
    verifyDelivery(firstDelivery, firstExecutionId);
    const first = firstDelivery.receipt;
    firstAcceptedBeforeRetry = first.executionId === firstExecutionId && firstControllerClaimed;

    if (options.invokeTrustedCommand && firstDelivery.retryReceipt) {
      const eveRetry = firstDelivery.retryReceipt;
      sameStepRetried = true;
      firstAcceptedBeforeRetry = firstAcceptedBeforeRetry && eveRetry.executionId === firstExecutionId;
    } else if (!options.invokeTrustedCommand && ownsLedger) {
      ledger!.close();
      ledger = new DeliveryLedger(ledgerPath);
      action = makeAction();
      const retry = await action.propose(proposal, binding);
      assertG3ReceiptMatchesExecution(retry, firstTerminal!);
      receipts.push(retry);
      sameStepRetried = true;
      firstAcceptedBeforeRetry = firstAcceptedBeforeRetry && retry.executionId === firstExecutionId;
    }
    currentStep = { ...currentStep, stepIndex: currentStep.stepIndex + 1 };

    phase = "second-held-cancellation";
    const { delivery: secondDelivery } = await runG3ConcurrentInvocation(() => invokeProposal(proposal), async (signal) => {
      secondExecutionId = (await waitForNewRequest([firstExecutionId], signal)).id;
      await waitForHeld(secondExecutionId, signal);
      const stopCountBeforeRunningCancel = heldExecutor.stopCalls;
      stopBeforeRelease = !heldExecutor.released;
      signal.throwIfAborted();
      await connectionReducer(options.operatorDbConnection, "requestExecutionCancel")({ executionId: secondExecutionId });
      await waitFor(() => isTerminal(options.controllerDbConnection.db.relevantExecutions.id.find(secondExecutionId)),
        "running cancellation terminal receipt", timeoutMs, signal);
      runningCancellationTerminal = options.controllerDbConnection.db.relevantExecutions.id.find(secondExecutionId) ?? undefined;
      runningCancellationStopCalls = heldExecutor.stopCalls - stopCountBeforeRunningCancel;
      return secondExecutionId;
    });
    verifyDelivery(secondDelivery, secondExecutionId);

    await session.stop();
    controller.close();
    controller = new LocalController({
      path: join(resolve(options.runDirectory), `controller-${options.unitId}.sqlite`),
      unitId: options.unitId,
      executor: heldExecutor,
      initialEpoch: confirmedG3ControllerEpoch(options.controllerDbConnection, options.unitId),
    });
    session = new GeneratedControllerSession({
      connection: options.controllerDbConnection,
      controller,
      unitId: options.unitId,
      resultFor: async (execution, receipt) => {
        if (receipt.outcome === "cancelled") return generatedCancelled(receipt.id);
        const evidence = await evidenceForExecution(options.authorizedPerception, postClaimEvidence, execution, receipt, "result");
        postClaimEvidence.set(execution.id, evidence);
        if (!evidence.completion) throw new Error("authorized perception must return the generated typed completion");
        if (completionReceiptId(evidence.completion) !== receipt.id) throw new Error("generated completion receipt does not match local controller receipt");
        return evidence.completion;
      },
      safeProofFor: async (execution, receipt) => {
        const evidence = postClaimEvidence.get(execution.id) ?? await evidenceForExecution(options.authorizedPerception, postClaimEvidence, execution, receipt, "safe-closure");
        postClaimEvidence.set(execution.id, evidence);
        return {
          executionId: execution.id,
          unitId: execution.unitId,
          controllerEpoch: execution.controllerEpoch!,
          observationId: evidence.safeObservationId,
          observedAt: timestamp(evidence.observedAt),
        };
      },
      diagnostics: (event) => {
        if (event.name.includes("error") || event.name.includes("failed")) diagnostics.push(`${event.name}:${event.fields?.detail ?? "unknown"}`);
      },
    });
    currentStep = { ...currentStep, stepIndex: currentStep.stepIndex + 1 };
    phase = "third-accepted-before-claim-cancellation";
    const { delivery: thirdDelivery } = await runG3ConcurrentInvocation(() => invokeProposal(proposal), async (signal) => {
      const accepted = await waitForNewRequest([firstExecutionId, secondExecutionId], signal);
      thirdExecutionId = accepted.id;
      acceptedBeforeClaim = accepted.state.tag === "Accepted" && accepted.claimedAt === undefined;
      if (!acceptedBeforeClaim) throw new Error("G3 pre-claim cancellation was already claimed");
      signal.throwIfAborted();
      await connectionReducer(options.operatorDbConnection, "requestExecutionCancel")({ executionId: thirdExecutionId });
      await waitFor(() => options.controllerDbConnection.db.relevantExecutions.id.find(thirdExecutionId)?.state.tag === "Cancelling",
        "confirmed pre-claim cancellation", timeoutMs, signal);
      // No controller subscription until cancellation is confirmed. Eve's
      // evaluation can still be completing its same-step receipt retry.
      await session!.start();
      await waitFor(() => isTerminal(options.controllerDbConnection.db.relevantExecutions.id.find(thirdExecutionId)),
        "accepted cancellation terminal receipt", timeoutMs, signal);
      acceptedCancellationTerminal = options.controllerDbConnection.db.relevantExecutions.id.find(thirdExecutionId) ?? undefined;
      return thirdExecutionId;
    });
    verifyDelivery(thirdDelivery, thirdExecutionId);

    phase = "review-and-reconcile";
    const mission = await waitForMission(agent, missionId, timeoutMs);
    const reviewedBy = identityText(options.operatorDbConnection.identity);
    const firstEvidence = postClaimEvidence.get(firstExecutionId);
    const targetEntityId = firstEvidence?.targetEntityId;
    if (!targetEntityId || !firstEvidence) throw new Error("actual post-claim target evidence is unavailable");
    await connectionReducer(options.operatorDbConnection, "recordObjectiveProgress")({
      missionId,
      objectiveId,
      expectedMissionRevision: mission.revision,
      evidence: {
        tag: "Finding",
        value: { observationIds: [firstEvidence.reviewObservationId], entityId: targetEntityId, reviewedBy },
      },
    });
    const afterReview = await waitForMission(agent, missionId, timeoutMs);
    if (afterReview.state.tag === "Closing") await connectionReducer(options.operatorDbConnection, "reconcileMission")({ missionId });
    await waitFor(() => {
      const row = agent!.snapshot().assignedMissions.find((candidate) => candidate.id === missionId);
      return row?.state.tag === "Succeeded";
    }, "mission reconciliation", timeoutMs);

    if (action) {
      const reconciled = await action.reconcile(binding);
      for (const receipt of reconciled) receipts.push(receipt);
    }

    addCheck("actualModule", true, "operator, agent, perception, and controller use generated DbConnection/WorldClient instances");
    addCheck("missionAssignment", agent.snapshot().assignedMissions.some((row) => row.id === missionId), "assigned mission is visible in the authorized generated agent view", [missionId]);
    addCheck("unitGrant", agent.snapshot().relevantUnitAssignments.some((row) => row.unitId === options.unitId && row.agentId === options.agentId && row.actionNames.includes("navigate@1")), "single Unit grant is visible with navigate@1", [options.unitId]);
    addCheck("trustedAgentCommand", options.invokeTrustedCommand !== undefined && firstAcceptedBeforeRetry, "proposal was delivered through the production Eve custom-command boundary and its returned receipt matched the generated row", [firstExecutionId]);
    addCheck("admissionClaim", firstControllerClaimed, "terminal generated execution retains claimedAt, controller identity, and epoch from the actual claim", [firstExecutionId]);
    addCheck("retainedControllerReceipt", controller.receipt(firstExecutionId)?.executionId === firstExecutionId, "reopened LocalController read the durable receipt", [firstExecutionId]);
    const measuredNavigateSuccess = hasMeasuredNavigateSuccess(firstTerminal, firstExecutionId);
    addCheck("measuredFeedback", actualWorldEvidence && measuredNavigateSuccess, "post-claim authorized perception produced a terminal generated Navigate completion with a Unit observation and matching local receipt", [firstEvidence?.unitObservationId ?? "", firstEvidence?.safeObservationId ?? "", firstTerminal?.receiptId ?? ""]);
    addCheck("reviewedObjectiveProgress", agent.snapshot().relevantMissionObjectiveProgress.some((row) => row.missionId === missionId && row.objectiveId === objectiveId), "operator reviewed Located finding is recorded by the module", [missionId, objectiveId]);
    addCheck("safeCancellation", runningCancellationTerminal?.state.tag === "Cancelled" && stopBeforeRelease && runningCancellationStopCalls === 1, "requestExecutionCancel interrupted the held execute before release exactly once", [secondExecutionId]);
    addCheck("acceptedBeforeClaimCancel", acceptedBeforeClaim && acceptedCancellationTerminal?.state.tag === "Cancelled" && heldExecutor.executeCalls === 2, "Accepted-before-claim cancellation closed without local execute/readmission", [thirdExecutionId]);
    addCheck("noDuplicateRetry", sameStepRetried && firstExecutionId.length > 0 && firstAcceptedBeforeRetry && new Set([firstExecutionId, secondExecutionId, thirdExecutionId]).size === 3, options.invokeTrustedCommand ? "actual Eve same-step retry reused the same generated execution identity" : "direct action-port ledger reopen/retry reused the same generated execution identity", [firstExecutionId]);
    if (!options.invokeTrustedCommand) {
      addCheck("directPortLostAckRetry", sameStepRetried && requestCalls === 1, "direct-port lost-ack retry reopened the ledger and observed the accepted generated row without a second reducer effect", [firstExecutionId]);
    } else {
      notRunChecks.push({ name: "directPortLostAckRetry", detail: "not run in actual Eve mode; Eve batch retry evidence is reported by noDuplicateRetry" });
    }
    addCheck("sourceAcquisitionTimesPreserved", sourceAcquisitionTimesPreserved, "synthetic source timestamps were preserved by the actual acquisition adapter");
    notRunChecks.push({ name: "processRestart", detail: "owned by Integration root server lifecycle" });
    notRunChecks.push({ name: "retainedDataAfterRestart", detail: "owned by Integration root server lifecycle" });
    notRunChecks.push({ name: "sameScopedIdentityAfterRestart", detail: "owned by Integration root server lifecycle" });
    addCheck("actualEve", options.invokeTrustedCommand !== undefined && actualEveEvidence, options.invokeTrustedCommand ? "returned Eve lifecycle, step, tool, and receipt evidence matched the generated execution" : "diagnostic direct-port path; actual Eve evidence was not supplied");

    return {
      mode: "loopback-spacetimedb",
      actualEve: options.invokeTrustedCommand !== undefined && actualEveEvidence,
      actualModule: true,
      checks: Object.fromEntries(observedChecks.map((check) => [check.name, check.result])),
      observedChecks,
      notRunChecks,
      evidence: [
        "generated-operator-mission-assignment",
        "generated-perception-frame-map-fixture",
        "authenticated-initial-stationary-simulation-pose",
        "durable-action-request-before-reducer-io",
        "ledger-reopen-same-execution-id",
        "generated-controller-claim",
        "post-claim-authorized-perception-feedback",
        "held-no-motion-running-cancellation",
        "accepted-before-claim-cancellation",
        "operator-reviewed-located-proof",
        "mission-close-and-reconcile",
      ],
      diagnostics,
      ids: { missionId, objectiveId, unitId: options.unitId, firstExecutionId, secondExecutionId, thirdExecutionId, mapId: fixture.mapId, frameId: fixture.spatialFrameId, observationId: fixture.observation.id, initialPoseObservationId },
      receipts,
    };
  } catch (error) {
    const diagnosticPath = join(resolve(options.runDirectory), `g3-failure-${suffix}.json`);
    // Persist before teardown: a pending session may need its unchanged
    // watchdog to finish. Never include connection configuration or tokens.
    try {
      await mkdir(resolve(options.runDirectory), { recursive: true });
      const executions = Array.from(options.controllerDbConnection.db.relevantExecutions)
        .filter((row) => row.missionId === missionId).map((row) => ({
          id: row.id, state: row.state.tag, controller: identityText(row.controller),
          controllerEpoch: row.controllerEpoch, claimedAt: row.claimedAt?.toISOString(),
          receiptId: row.receiptId, result: row.result, input: row.input,
          localReceipt: (() => {
            try { return controller?.receipt(row.id); }
            catch { return { unavailable: "local ledger is already closed" }; }
          })(),
        }));
      await writeFile(diagnosticPath, canonicalJson({
        phase, error: error instanceof Error ? error.message : String(error), diagnostics,
        missionId, unitId: options.unitId, firstExecutionId, secondExecutionId, thirdExecutionId,
        initialPoseObservationId, executions, observedChecks,
        executor: { executeCalls: heldExecutor.executeCalls, stopCalls: heldExecutor.stopCalls,
          pendingExecutionId: heldExecutor.pendingCommand?.executionId, released: heldExecutor.released },
        receipts: receipts.map((receipt) => ({ executionId: receipt.executionId, status: receipt.status, step: receipt.step })),
      }), { mode: 0o600 });
    } catch (persistenceError) {
      throw new AggregateError([error, persistenceError], "G3 failed and could not persist run diagnostics");
    }
    throw new Error(`G3 failed during ${phase}; diagnostics: ${diagnosticPath}`, { cause: error });
  } finally {
    await session?.stop().catch(() => undefined);
    controller?.close();
    if (ownsLedger) {
      try { ledger?.close(); } catch { /* already reopened/closed */ }
    }
    if (agentOwned) agent?.disconnect();
  }
}

async function waitForMission(client: WorldClient, missionId: string, timeoutMs: number): Promise<CurrentWorldSnapshot["assignedMissions"][number]> {
  let row: CurrentWorldSnapshot["assignedMissions"][number] | undefined;
  await waitFor(() => {
    row = client.snapshot().assignedMissions.find((candidate) => candidate.id === missionId);
    return row !== undefined;
  }, "assigned mission revision", timeoutMs);
  return row!;
}

function completionReceiptId(result: ExecutionResult): string | undefined {
  if (result.tag === "Cancelled") return result.value.localReceiptId;
  if (result.tag === "Failed") return result.value.localReceiptId;
  return result.value.completion.value.localReceiptId;
}

async function evidenceForExecution(
  perception: G3AuthorizedPerception | undefined,
  evidenceByExecution: Map<string, G3PostClaimEvidence>,
  execution: Execution,
  localReceipt: LocalReceipt,
  phase: "result" | "safe-closure",
): Promise<G3PostClaimEvidence> {
  if (!perception) throw new Error("authorized post-claim perception publisher is required for actual G3 evidence");
  const evidence = await perception.publishPostClaimEvidence({
    execution,
    receiptId: localReceipt.id,
    localReceipt,
    measuredState: {
      outcome: localReceipt.outcome,
      safeState: localReceipt.safeState,
      effect: "none",
    },
    phase,
  });
  if (!evidence.safeObservationId) {
    throw new Error("authorized post-claim perception returned no fresh safe observation identity");
  }
  if (phase === "result" && (!evidence.unitObservationId || !evidence.reviewObservationId || !evidence.targetEntityId)) {
    throw new Error("authorized result perception returned incomplete generated observation identity");
  }
  const observedAt = timestamp(evidence.observedAt);
  if (observedAt.microsSinceUnixEpoch <= execution.updatedAt.microsSinceUnixEpoch) {
    throw new Error("post-claim perception evidence is not newer than the claimed execution");
  }
  const normalized = { ...evidence, observedAt };
  evidenceByExecution.set(execution.id, normalized);
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsedActionReceipt(value: unknown, label: string): ActionReceipt {
  if (!isRecord(value) || typeof value.executionId !== "string" || typeof value.status !== "string" ||
      typeof value.requestFingerprint !== "string" || typeof value.acceptBy !== "string" ||
      typeof value.unitId !== "string" || typeof value.missionId !== "string" || typeof value.objectiveId !== "string" ||
      !isRecord(value.request) || !isRecord(value.request.input) || !isRecord(value.step) || typeof value.step.sessionId !== "string" ||
      typeof value.step.turnId !== "string" || !Number.isInteger(value.step.stepIndex)) {
    throw new Error(`actual Eve ${label} is not a parsed trusted action receipt`);
  }
  return value as unknown as ActionReceipt;
}

function requestBodyJson(request: RequestExecutionParams): string {
  // The command's parsed JSON uses lossless decimal u64 strings and an ISO
  // timestamp; direct-port receipts retain the native generated values.
  return canonicalJson({ ...request, acceptBy: typeof request.acceptBy === "string" ? request.acceptBy : request.acceptBy.toISOString() });
}

/** Compare every generated request field, including immutable authorization
 * pins, to the row observed while Eve was still running. No current-pin
 * recomputation is appropriate after a committed execution. */
export function assertG3ReceiptMatchesExecution(receipt: ActionReceipt, row: Execution): void {
  const recordedRequest: RequestExecutionParams = {
    executionId: row.id, unitId: row.unitId,
    assignment: row.agentId !== undefined && row.assignmentRevision !== undefined
      ? { agentId: row.agentId, revision: row.assignmentRevision } : undefined,
    missionLink: row.missionId !== undefined && row.objectiveId !== undefined && row.missionRevision !== undefined
      ? { missionId: row.missionId, objectiveId: row.objectiveId, expectedRevision: row.missionRevision } : undefined,
    input: row.input, bindingVersion: row.bindingVersion, targetVersion: row.targetVersion, acceptBy: row.acceptBy,
  };
  if (receipt.executionId !== row.id || receipt.unitId !== row.unitId || receipt.missionId !== row.missionId ||
      receipt.objectiveId !== row.objectiveId || receipt.acceptBy !== row.acceptBy.toISOString() ||
      requestBodyJson(receipt.request) !== requestBodyJson(recordedRequest)) {
    throw new Error("G3 receipt execution identity/body/pins/deadline differ from the observed generated row");
  }
}

async function verifyActualEveEvidence(
  evidence: ActualEveInvocationEvidence,
  proposal: TrustedActionProposal,
  agent: WorldClient,
  binding: TrustedWorldBinding,
  timeoutMs: number,
): Promise<{ readonly receipt: ActionReceipt; readonly retryReceipt?: ActionReceipt }> {
  if (!evidence || !evidence.receipt || !evidence.step || evidence.evidence.lifecycle.length === 0 ||
      !evidence.evidence.bashTool || evidence.evidence.actionCommandPath !== true) {
    throw new Error("actual Eve callback did not return complete lifecycle/tool/step evidence");
  }
  const receipt = parsedActionReceipt(evidence.receipt, "primary receipt");
  const retryReceipt = evidence.retryReceipt === undefined ? undefined : parsedActionReceipt(evidence.retryReceipt, "retry receipt");
  if (evidence.step.turnId === undefined || evidence.step.stepIndex === undefined) {
    throw new Error("actual Eve callback did not return a complete framework step");
  }
  const sameStep = (left: StepIdentity, right: StepIdentity): boolean =>
    left.sessionId === right.sessionId && left.turnId === right.turnId && left.stepIndex === right.stepIndex;
  const returnedStep: StepIdentity = { sessionId: evidence.step.sessionId, turnId: evidence.step.turnId, stepIndex: evidence.step.stepIndex };
  if (!sameStep(receipt.step, returnedStep) || (retryReceipt !== undefined && !sameStep(retryReceipt.step, returnedStep))) {
    throw new Error("actual Eve receipt step does not match the returned framework step");
  }
  if (retryReceipt &&
      (retryReceipt.executionId !== receipt.executionId ||
       retryReceipt.requestFingerprint !== receipt.requestFingerprint ||
       requestBodyJson(retryReceipt.request) !== requestBodyJson(receipt.request) ||
       retryReceipt.missionId !== receipt.missionId ||
       retryReceipt.objectiveId !== receipt.objectiveId ||
       retryReceipt.unitId !== receipt.unitId)) {
    throw new Error("actual Eve same-step retry changed execution identity or request body");
  }
  if (receipt.missionId !== proposal.missionId || receipt.objectiveId !== proposal.objectiveId ||
      receipt.unitId.length === 0 || receipt.request?.assignment?.agentId !== binding.agentId) {
    throw new Error("actual Eve receipt does not identify the requested mission/objective/owned action");
  }
  await waitFor(() => agent.snapshot().relevantExecutions.some((row) => row.id === receipt.executionId), "actual Eve execution visibility", timeoutMs);
  const rows = agent.snapshot().relevantExecutions.filter((candidate) => candidate.id === receipt.executionId);
  if (rows.length !== 1) throw new Error("actual Eve same-step retry did not resolve to one generated execution row");
  const row = rows[0];
  if (!row || row.agentId !== binding.agentId || row.unitId !== receipt.unitId || row.missionId !== receipt.missionId ||
      row.objectiveId !== receipt.objectiveId || identityText(row.requestedBy) !== binding.principal.principalId) {
    throw new Error("actual Eve receipt does not match the authorized generated execution row");
  }
  if (receipt.request?.executionId !== row.id || receipt.request.unitId !== row.unitId) {
    throw new Error("actual Eve receipt does not contain the generated request identity");
  }
  assertG3ReceiptMatchesExecution(receipt, row);
  if (retryReceipt) assertG3ReceiptMatchesExecution(retryReceipt, row);
  if (proposal.kind === "navigate") {
    const input = receipt.request.input;
    if (input.tag !== "Navigate" || input.value.mapId !== proposal.mapId || input.value.targetFrameId !== proposal.targetFrameId ||
        row.input.tag !== "Navigate" || row.input.value.mapId !== proposal.mapId || row.input.value.targetFrameId !== proposal.targetFrameId ||
        canonicalJson(row.input.value.target) !== canonicalJson(proposal.target)) {
      throw new Error("actual Eve receipt/request does not match the typed navigation proposal");
    }
  }
  return { receipt, ...(retryReceipt ? { retryReceipt } : {}) };
}
