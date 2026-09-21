import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

// Keep the canonical-json implementation owned by contracts while avoiding a
// second codec or making this package inherit that legacy file's loose typing.
const requireShared = createRequire(import.meta.url);
const { canonicalize } = requireShared("../../contracts/src/canonical-json.ts") as {
  canonicalize(value: unknown): string;
};

export type Vec3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };

/** Internal controller copy of a generated navigation value; not the module union. */
export type NavigationControllerPose = {
  frameId: string;
  mapId: string;
  basisMapRevision: bigint;
  targetPose: { positionM: Vec3; orientation: Quaternion };
};

/** Optional target geometry attached to an approach request, never a navigation pose. */
export type ApproachBoundingBox = {
  frameId: string;
  centerM: Vec3;
  sizeM: Vec3;
};

type ControllerCommandBase = {
  executionId: string;
  unitId: string;
  controllerEpoch: bigint;
  requestDigest: string;
  normalizedRequest: CanonicalJson;
  bindingPolicy: GeneratedBindingPolicy;
};

export type NavigationControllerCommand = ControllerCommandBase & {
  kind: "navigate@1";
  mapId: string;
  basisMapRevision: bigint;
  targetFrameId: string;
  targetPose: { positionM: Vec3; orientation: Quaternion };
};

export type ApproachControllerCommand = ControllerCommandBase & {
  kind: "approach@1";
  target: {
    targetId: string;
    geometryVersion: bigint;
    standoffM: number;
    bbox?: ApproachBoundingBox;
  };
};

export type ControllerCommand = NavigationControllerCommand | ApproachControllerCommand;

/** The generated module union consumed by the explicit adapter below. */
export type GeneratedActionIntent =
  | { tag: "navigate"; value: { mapId: string; basisMapRevision: bigint; targetFrameId: string; targetPose: { positionM: Vec3; orientation: Quaternion } } }
  | { tag: "approach"; value: { targetId: string; standoffM: number; expectedGeometryVersion: bigint; bbox?: ApproachBoundingBox } };

export type GeneratedBindingPolicy = {
  mode: "simulation" | "physical";
  maxRunMs: number;
  maxEvidenceAgeMs?: number;
  maxLinearMps?: number;
  toleranceM?: number;
  executor?: { name: string; version: string; sha256: string };
};

export type AcceptedExecution = {
  id: string;
  unitId: string;
  input: GeneratedActionIntent;
  state: "accepted" | "running";
  binding: { policy: GeneratedBindingPolicy };
  requestDigest?: string;
  normalizedRequest?: CanonicalJson;
};

export type ExecutionClaim = {
  executionId: string;
  unitId: string;
  controllerEpoch: bigint;
};

export type AcceptedExecutionClaim = {
  execution: AcceptedExecution;
  claim: ExecutionClaim;
};

export type NavigationCompletion = {
  action: "navigate@1";
  outcome: "succeeded" | "failed";
  finalPose?: NavigationControllerPose;
  localReceiptId: string;
  safeClosureReceiptId?: string;
  detail?: string;
};

export type ApproachCompletion = {
  action: "approach@1";
  outcome: "succeeded" | "failed";
  distanceM?: number;
  unitObservationId?: string;
  targetObservationId?: string;
  localReceiptId: string;
  safeClosureReceiptId?: string;
  detail?: string;
};

export type ActionCompletion = NavigationCompletion | ApproachCompletion;

export type LocalOutcome = "notStarted" | "running" | "succeeded" | "cancelled" | "failed" | "unknown";
export type SafeState = "confirmed" | "unknown";

export type LocalReceipt = {
  id: string;
  executionId: string;
  unitId: string;
  controllerEpoch: bigint;
  action: ControllerCommand["kind"];
  bindingPolicy: GeneratedBindingPolicy;
  requestDigest: string;
  normalizedRequest: CanonicalJson;
  outcome: LocalOutcome;
  safeState: SafeState;
  cancellationRequested: boolean;
  controllerEpochAtReceipt: bigint;
  completion?: ActionCompletion;
  lateFacts: readonly ReconciledFact[];
  admittedAt: Date;
  updatedAt: Date;
};

export type ReconciledFact = {
  outcome: LocalOutcome;
  safeState: SafeState;
  completion?: ActionCompletion;
  source?: "executor" | "late-receipt" | "operator";
  safeStateProof?: SafeStateProof;
};

export type SafeStateProof = {
  receiptId: string;
  observedAt: Date;
  producer: "local-controller" | "fake-no-motion";
  state: "confirmed";
};

export type ExecutorResult = {
  outcome: Extract<LocalOutcome, "succeeded" | "failed" | "cancelled" | "unknown">;
  safeState: SafeState;
  completion?: ActionCompletion;
  /** The simulator has no physical effect. A physical adapter is deliberately unsupported. */
  effect: "none";
};

export type StopResult = {
  safeState: SafeState;
  detail?: string;
};

export interface NoMotionExecutor {
  readonly kind: "fake-no-motion";
  execute(command: ControllerCommand, signal: AbortSignal): Promise<ExecutorResult>;
  stop(reason: string): Promise<StopResult>;
  proveSafeState(): Promise<StopResult>;
}

export type DiagnosticEvent = {
  name: string;
  executionId?: string;
  unitId: string;
  fields?: Readonly<Record<string, string | number | boolean>>;
};

export type DiagnosticSink = (event: DiagnosticEvent) => void;

export type LocalControllerOptions = {
  path: string;
  unitId: string;
  executor?: NoMotionExecutor;
  clock?: () => Date;
  monotonicMs?: () => number;
  diagnostics?: DiagnosticSink;
  initialEpoch?: bigint;
  maxRunMs?: number;
};

export type LocalControllerStatus = {
  unitId: string;
  controllerEpoch: bigint;
  stopLatched: boolean;
  safeState: SafeState;
  activeExecutionId?: string;
};

type SqliteStateRow = {
  unit_id: string;
  epoch: string;
  stop_latched: number;
  safe_state: SafeState;
  active_execution_id: string | null;
  updated_at: string;
};

type SqliteReceiptRow = {
  receipt_id: string;
  execution_id: string;
  unit_id: string;
  controller_epoch: string;
  action: ControllerCommand["kind"];
  binding_json: string;
  request_digest: string;
  request_json: string;
  outcome: LocalOutcome;
  safe_state: SafeState;
  cancellation_requested: number;
  completion_json: string | null;
  late_facts_json: string | null;
  admitted_at: string;
  updated_at: string;
};

export type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new LocalControllerError("invalid_request", `${name} must be finite`);
}

function assertPositive(value: number, name: string): void {
  assertFinite(value, name);
  if (value <= 0) throw new LocalControllerError("invalid_request", `${name} must be positive`);
}

function normalizeForDigest(value: unknown): CanonicalJson | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number") {
    assertFinite(value, "request number");
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new LocalControllerError("invalid_request", "invalid timestamp");
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => normalizeForDigest(item) ?? null);
  if (typeof value === "object") {
    const result: { [key: string]: CanonicalJson } = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = normalizeForDigest(child);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  throw new LocalControllerError("invalid_request", `unsupported request value: ${typeof value}`);
}

export function normalizedGeneratedRequestProjection(intent: GeneratedActionIntent): CanonicalJson {
  return normalizeForDigest(intent) as CanonicalJson;
}

export function normalizedGeneratedRequestDigest(intent: GeneratedActionIntent): string {
  const canonical = canonicalize(normalizedGeneratedRequestProjection(intent));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function stableReceiptId(executionId: string, requestDigest: string): string {
  if (!executionId || !requestDigest) throw new LocalControllerError("invalid_request", "receipt identity is incomplete");
  const value = canonicalize({ executionId, requestDigest });
  return `receipt:sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validateVec3(value: Vec3, name: string): void {
  for (const axis of ["x", "y", "z"] as const) assertFinite(value[axis], `${name}.${axis}`);
}

function validateQuaternion(value: Quaternion, name: string): void {
  for (const axis of ["x", "y", "z", "w"] as const) assertFinite(value[axis], `${name}.${axis}`);
  const norm = Math.hypot(value.x, value.y, value.z, value.w);
  if (Math.abs(norm - 1) > 1e-3) throw new LocalControllerError("invalid_request", `${name} must be a unit quaternion`);
}

function validateGeneratedIntent(intent: GeneratedActionIntent): void {
  if (!intent || typeof intent !== "object") throw new LocalControllerError("invalid_request", "generated action intent is required");
  if (intent.tag === "navigate") {
    if (!intent.value.mapId || !intent.value.targetFrameId || intent.value.basisMapRevision < 0n) {
      throw new LocalControllerError("invalid_request", "navigation intent requires map, basis revision, and target frame");
    }
    validateVec3(intent.value.targetPose.positionM, "targetPose.positionM");
    validateQuaternion(intent.value.targetPose.orientation, "targetPose.orientation");
    return;
  }
  if (intent.tag === "approach") {
    if (!intent.value.targetId) throw new LocalControllerError("invalid_request", "approach targetId is required");
    assertPositive(intent.value.standoffM, "standoffM");
    if (intent.value.expectedGeometryVersion < 0n) throw new LocalControllerError("invalid_request", "geometryVersion cannot be negative");
    if (intent.value.bbox) {
      if (!intent.value.bbox.frameId) throw new LocalControllerError("invalid_request", "approach bbox frameId is required");
      validateVec3(intent.value.bbox.centerM, "target.bbox.centerM");
      validateVec3(intent.value.bbox.sizeM, "target.bbox.sizeM");
      for (const axis of ["x", "y", "z"] as const) assertPositive(intent.value.bbox.sizeM[axis], `target.bbox.sizeM.${axis}`);
    }
    return;
  }
  throw new LocalControllerError("invalid_request", "unsupported generated action intent");
}

function validateCommand(command: ControllerCommand): void {
  if (!command.executionId || !command.unitId || !command.requestDigest) {
    throw new LocalControllerError("invalid_request", "accepted command identity is incomplete");
  }
  if (command.controllerEpoch < 0n) throw new LocalControllerError("invalid_request", "controllerEpoch cannot be negative");
  const computed = `sha256:${createHash("sha256").update(canonicalize(command.normalizedRequest), "utf8").digest("hex")}`;
  if (computed !== command.requestDigest) throw new LocalControllerError("invalid_request", "request digest does not match normalized request");
  if (command.bindingPolicy.mode !== "simulation" || !Number.isInteger(command.bindingPolicy.maxRunMs) || command.bindingPolicy.maxRunMs <= 0) {
    throw new LocalControllerError("invalid_request", "accepted binding is not a bounded simulation policy");
  }
  if (command.kind === "navigate@1") {
    if (!command.mapId || !command.targetFrameId || command.basisMapRevision < 0n) throw new LocalControllerError("invalid_request", "navigation command is incomplete");
    validateVec3(command.targetPose.positionM, "targetPose.positionM");
    validateQuaternion(command.targetPose.orientation, "targetPose.orientation");
    return;
  }
  if (command.kind === "approach@1") {
    if (!command.target.targetId) throw new LocalControllerError("invalid_request", "approach targetId is required");
    assertPositive(command.target.standoffM, "standoffM");
    if (command.target.geometryVersion < 0n) throw new LocalControllerError("invalid_request", "geometryVersion cannot be negative");
    return;
  }
  throw new LocalControllerError("invalid_request", "unsupported controller command");
}

/** Convert the generated accepted execution plus confirmed claim into the only command accepted by local control. */
export function adaptAcceptedExecutionClaim(input: AcceptedExecutionClaim): ControllerCommand {
  const { execution, claim } = input;
  if (!execution.id || execution.id !== claim.executionId || execution.unitId !== claim.unitId) {
    throw new LocalControllerError("claim_mismatch", "execution and claim identities do not match");
  }
  if (execution.state !== "accepted" && execution.state !== "running") {
    throw new LocalControllerError("claim_not_active", "only an accepted or running execution can reach local control");
  }
  if (execution.binding.policy.mode !== "simulation") throw new PhysicalAdapterDisabledError();
  validateGeneratedIntent(execution.input);
  const inputProjection = normalizedGeneratedRequestProjection(execution.input);
  const normalizedRequest = execution.normalizedRequest ?? inputProjection;
  if (execution.normalizedRequest && typeof execution.normalizedRequest === "object" && !Array.isArray(execution.normalizedRequest) &&
      "input" in execution.normalizedRequest &&
      canonicalize(execution.normalizedRequest.input) !== canonicalize(inputProjection)) {
    throw new LocalControllerError("request_normalization_mismatch", "complete normalized request does not contain the accepted input");
  }
  const computedDigest = `sha256:${createHash("sha256").update(canonicalize(normalizedRequest), "utf8").digest("hex")}`;
  if (execution.requestDigest !== undefined && execution.requestDigest !== computedDigest) {
    throw new LocalControllerError("request_digest_mismatch", "generated execution fingerprint does not match its input");
  }
  const base = {
    executionId: execution.id,
    unitId: execution.unitId,
    controllerEpoch: claim.controllerEpoch,
    requestDigest: computedDigest,
    normalizedRequest,
    bindingPolicy: execution.binding.policy,
  };
  if (execution.input.tag === "navigate") {
    return {
      ...base,
      kind: "navigate@1",
      mapId: execution.input.value.mapId,
      basisMapRevision: execution.input.value.basisMapRevision,
      targetFrameId: execution.input.value.targetFrameId,
      targetPose: execution.input.value.targetPose,
    };
  }
  return {
    ...base,
    kind: "approach@1",
    target: {
      targetId: execution.input.value.targetId,
      geometryVersion: execution.input.value.expectedGeometryVersion,
      standoffM: execution.input.value.standoffM,
      ...(execution.input.value.bbox ? { bbox: execution.input.value.bbox } : {}),
    },
  };
}

function cloneCompletion(completion: ActionCompletion | undefined): ActionCompletion | undefined {
  if (!completion) return undefined;
  return JSON.parse(JSON.stringify(normalizeForDigest(completion))) as ActionCompletion;
}

function toReceipt(row: SqliteReceiptRow): LocalReceipt {
  const completion = row.completion_json ? reviveCompletion(JSON.parse(row.completion_json)) : undefined;
  const lateFacts = row.late_facts_json ? (JSON.parse(row.late_facts_json) as unknown[]).map(reviveFact) : [];
  return {
    id: row.receipt_id,
    executionId: row.execution_id,
    unitId: row.unit_id,
    controllerEpoch: BigInt(row.controller_epoch),
    action: row.action,
    bindingPolicy: JSON.parse(row.binding_json) as GeneratedBindingPolicy,
    requestDigest: row.request_digest,
    normalizedRequest: JSON.parse(row.request_json) as CanonicalJson,
    outcome: row.outcome,
    safeState: row.safe_state,
    cancellationRequested: row.cancellation_requested === 1,
    controllerEpochAtReceipt: BigInt(row.controller_epoch),
    completion,
    lateFacts,
    admittedAt: new Date(row.admitted_at),
    updatedAt: new Date(row.updated_at),
  };
}

function reviveCompletion(value: unknown): ActionCompletion {
  if (!value || typeof value !== "object") throw new LocalControllerError("storage_corrupt", "stored completion is not an object");
  const completion = value as Record<string, unknown>;
  if (completion.action === "navigate@1" && completion.finalPose && typeof completion.finalPose === "object") {
    const finalPose = completion.finalPose as Record<string, unknown>;
    if (typeof finalPose.basisMapRevision === "string") finalPose.basisMapRevision = BigInt(finalPose.basisMapRevision);
  }
  return completion as unknown as ActionCompletion;
}

function reviveFact(value: unknown): ReconciledFact {
  if (!value || typeof value !== "object") throw new LocalControllerError("storage_corrupt", "stored reconciliation fact is not an object");
  const fact = value as Record<string, unknown>;
  if (fact.completion) fact.completion = reviveCompletion(fact.completion);
  if (fact.safeStateProof && typeof fact.safeStateProof === "object") {
    const proof = fact.safeStateProof as Record<string, unknown>;
    if (typeof proof.observedAt === "string") proof.observedAt = new Date(proof.observedAt);
  }
  return fact as unknown as ReconciledFact;
}

function sqliteValue(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  return value;
}

class ReceiptLedger {
  readonly db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS controller_state (
        unit_id TEXT PRIMARY KEY,
        epoch TEXT NOT NULL,
        stop_latched INTEGER NOT NULL CHECK (stop_latched IN (0, 1)),
        safe_state TEXT NOT NULL CHECK (safe_state IN ('confirmed', 'unknown')),
        active_execution_id TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_receipts (
        receipt_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL UNIQUE,
        unit_id TEXT NOT NULL,
        controller_epoch TEXT NOT NULL,
        action TEXT NOT NULL,
        binding_json TEXT NOT NULL,
        request_digest TEXT NOT NULL,
        request_json TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('notStarted', 'running', 'succeeded', 'cancelled', 'failed', 'unknown')),
        safe_state TEXT NOT NULL CHECK (safe_state IN ('confirmed', 'unknown')),
        cancellation_requested INTEGER NOT NULL CHECK (cancellation_requested IN (0, 1)),
        completion_json TEXT,
        late_facts_json TEXT,
        admitted_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_receipts_unit_state
        ON execution_receipts (unit_id, outcome);
    `);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
      throw error;
    }
  }

  state(unitId: string): SqliteStateRow | undefined {
    return this.db.prepare("SELECT * FROM controller_state WHERE unit_id = ?").get(unitId) as SqliteStateRow | undefined;
  }

  ensureState(unitId: string, initialEpoch: bigint, now: Date): SqliteStateRow {
    const existing = this.state(unitId);
    if (existing) return existing;
    this.db.prepare(`INSERT INTO controller_state
      (unit_id, epoch, stop_latched, safe_state, active_execution_id, updated_at)
      VALUES (?, ?, 1, 'unknown', NULL, ?)`)
      .run(unitId, initialEpoch.toString(10), now.toISOString());
    return this.state(unitId)!;
  }

  bumpEpoch(unitId: string, now: Date): SqliteStateRow {
    return this.transaction(() => {
      const state = this.state(unitId);
      if (!state) throw new LocalControllerError("storage_corrupt", "controller state is missing");
      const nextEpoch = BigInt(state.epoch) + 1n;
      this.db.prepare(`UPDATE controller_state
        SET epoch = ?, stop_latched = 1, safe_state = 'unknown', updated_at = ?
        WHERE unit_id = ?`)
        .run(nextEpoch.toString(10), now.toISOString(), unitId);
      return this.state(unitId)!;
    });
  }

  setState(input: {
    unitId: string;
    stopLatched: boolean;
    safeState: SafeState;
    activeExecutionId: string | null;
    now: Date;
  }): void {
    this.db.prepare(`UPDATE controller_state SET stop_latched = ?, safe_state = ?,
      active_execution_id = ?, updated_at = ? WHERE unit_id = ?`)
      .run(input.stopLatched ? 1 : 0, input.safeState, sqliteValue(input.activeExecutionId), input.now.toISOString(), input.unitId);
  }

  receipt(executionId: string): SqliteReceiptRow | undefined {
    return this.db.prepare("SELECT * FROM execution_receipts WHERE execution_id = ?").get(executionId) as SqliteReceiptRow | undefined;
  }

  receipts(unitId: string): SqliteReceiptRow[] {
    return this.db.prepare(`SELECT * FROM execution_receipts
      WHERE unit_id = ? ORDER BY admitted_at ASC, execution_id ASC`).all(unitId) as SqliteReceiptRow[];
  }

  insertReceipt(input: {
    receiptId: string;
    executionId: string;
    unitId: string;
    controllerEpoch: bigint;
  action: ControllerCommand["kind"];
  bindingPolicy: GeneratedBindingPolicy;
  requestDigest: string;
  requestJson: string;
    admittedAt: Date;
  }): void {
    this.db.prepare(`INSERT INTO execution_receipts
      (receipt_id, execution_id, unit_id, controller_epoch, action, binding_json, request_digest,
       request_json, outcome, safe_state, cancellation_requested, completion_json,
       late_facts_json, admitted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'notStarted', 'unknown', 0, NULL, NULL, ?, ?)`)
      .run(input.receiptId, input.executionId, input.unitId, input.controllerEpoch.toString(10), input.action,
        canonicalize(normalizeForDigest(input.bindingPolicy) as CanonicalJson), input.requestDigest, input.requestJson,
        input.admittedAt.toISOString(), input.admittedAt.toISOString());
  }

  updateReceipt(input: {
    executionId: string;
    outcome: LocalOutcome;
    safeState: SafeState;
    cancellationRequested?: boolean;
    completion?: ActionCompletion;
    lateFact?: ReconciledFact;
    now: Date;
  }): void {
    const current = this.receipt(input.executionId);
    if (!current) throw new LocalControllerError("not_found", `execution ${input.executionId} is not recorded`);
    const completionJson = input.completion ? canonicalize(normalizeForDigest(input.completion) as CanonicalJson) : current.completion_json;
    const lateFacts = current.late_facts_json ? (JSON.parse(current.late_facts_json) as unknown[]).map(reviveFact) : [];
    if (input.lateFact) {
      const candidate = canonicalize(normalizeForDigest(input.lateFact) as CanonicalJson);
      if (!lateFacts.some((fact) => canonicalize(normalizeForDigest(fact) as CanonicalJson) === candidate)) lateFacts.push(input.lateFact);
    }
    const lateFactsJson = lateFacts.length > 0 ? canonicalize(normalizeForDigest(lateFacts) as CanonicalJson) : current.late_facts_json;
    this.db.prepare(`UPDATE execution_receipts SET outcome = ?, safe_state = ?,
      cancellation_requested = ?, completion_json = ?, late_facts_json = ?, updated_at = ?
      WHERE execution_id = ?`)
      .run(input.outcome, input.safeState,
        input.cancellationRequested === undefined ? current.cancellation_requested : (input.cancellationRequested ? 1 : 0),
        sqliteValue(completionJson), sqliteValue(lateFactsJson), input.now.toISOString(), input.executionId);
  }
}

export class LocalControllerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "LocalControllerError";
  }
}

export class PhysicalAdapterDisabledError extends LocalControllerError {
  constructor() {
    super("physical_adapter_disabled", "physical local adapters are disabled until a separately approved qualification");
  }
}

export class FakeNoMotionExecutor implements NoMotionExecutor {
  readonly kind = "fake-no-motion" as const;
  executeCalls = 0;
  stopCalls = 0;
  readonly effects: string[] = [];

  async execute(command: ControllerCommand, _signal: AbortSignal): Promise<ExecutorResult> {
    this.executeCalls += 1;
    this.effects.push("none");
    const localReceiptId = stableReceiptId(command.executionId, command.requestDigest);
    if (command.kind === "navigate@1") {
      return {
        outcome: "succeeded",
        safeState: "confirmed",
        effect: "none",
        completion: {
          action: "navigate@1",
          outcome: "succeeded",
          finalPose: {
            frameId: command.targetFrameId,
            mapId: command.mapId,
            basisMapRevision: command.basisMapRevision,
            targetPose: command.targetPose,
          },
          localReceiptId,
          safeClosureReceiptId: localReceiptId,
          detail: "deterministic no-motion simulation fixture",
        },
      };
    }
    return {
      outcome: "succeeded",
      safeState: "confirmed",
      effect: "none",
      completion: {
        action: "approach@1",
        outcome: "succeeded",
        distanceM: command.target.standoffM,
        unitObservationId: `sim:unit:${command.unitId}`,
        targetObservationId: `sim:target:${command.target.targetId}`,
        localReceiptId,
        safeClosureReceiptId: localReceiptId,
        detail: "deterministic no-motion simulation fixture",
      },
    };
  }

  async stop(_reason: string): Promise<StopResult> {
    this.stopCalls += 1;
    return { safeState: "confirmed", detail: "fake no-motion executor is already stopped" };
  }

  async proveSafeState(): Promise<StopResult> {
    return { safeState: "confirmed", detail: "fake no-motion executor reports a safe state" };
  }
}

export class LocalController {
  readonly #ledger: ReceiptLedger;
  readonly #executor: NoMotionExecutor;
  readonly #clock: () => Date;
  readonly #monotonicMs: () => number;
  readonly #diagnostics?: DiagnosticSink;
  readonly #maxRunMs: number;
  readonly #unitId: string;
  #epoch: bigint;
  #watchdog?: ReturnType<typeof setTimeout>;
  #closed = false;
  #activeAbort?: AbortController;

  constructor(options: LocalControllerOptions) {
    if (!options.path) throw new LocalControllerError("invalid_config", "SQLite path is required");
    if (!options.unitId) throw new LocalControllerError("invalid_config", "unitId is required");
    if (options.maxRunMs !== undefined && (!Number.isInteger(options.maxRunMs) || options.maxRunMs <= 0)) {
      throw new LocalControllerError("invalid_config", "maxRunMs must be a positive integer");
    }
    this.#unitId = options.unitId;
    this.#clock = options.clock ?? (() => new Date());
    this.#monotonicMs = options.monotonicMs ?? (() => performance.now());
    this.#diagnostics = options.diagnostics;
    this.#maxRunMs = options.maxRunMs ?? 30_000;
    this.#executor = options.executor ?? new FakeNoMotionExecutor();
    if (this.#executor.kind !== "fake-no-motion") throw new PhysicalAdapterDisabledError();
    this.#ledger = new ReceiptLedger(options.path);
    const initialEpoch = options.initialEpoch ?? 1n;
    if (initialEpoch < 0n) throw new LocalControllerError("invalid_config", "initialEpoch cannot be negative");
    const existingState = this.#ledger.state(this.#unitId);
    const state = existingState
      ? this.#ledger.bumpEpoch(this.#unitId, this.#clock())
      : this.#ledger.ensureState(this.#unitId, initialEpoch, this.#clock());
    this.#epoch = BigInt(state.epoch);
    this.#emit({ name: "controller.started", unitId: this.#unitId, fields: { epoch: Number(this.#epoch) } });
  }

  get controllerEpoch(): bigint { return this.#epoch; }

  status(): LocalControllerStatus {
    this.#assertOpen();
    const state = this.#ledger.state(this.#unitId)!;
    return {
      unitId: this.#unitId,
      controllerEpoch: BigInt(state.epoch),
      stopLatched: state.stop_latched === 1,
      safeState: state.safe_state,
      ...(state.active_execution_id ? { activeExecutionId: state.active_execution_id } : {}),
    };
  }

  /** Return the durable receipt ledger for restart reconciliation. */
  receipts(): LocalReceipt[] {
    this.#assertOpen();
    return this.#ledger.receipts(this.#unitId).map(toReceipt);
  }

  /** Return one durable receipt without permitting a second execution attempt. */
  receipt(executionId: string): LocalReceipt | undefined {
    this.#assertOpen();
    const row = this.#ledger.receipt(executionId);
    return row ? toReceipt(row) : undefined;
  }

  async clearStop(): Promise<LocalControllerStatus> {
    this.#assertOpen();
    const safe = await this.#executor.proveSafeState();
    if (safe.safeState !== "confirmed") {
      this.#setState(true, "unknown", this.#activeExecutionId(), this.#clock());
      throw new LocalControllerError("safe_state_unknown", "cannot clear stop without fresh local safe-state confirmation");
    }
    this.#setState(false, "confirmed", this.#activeExecutionId(), this.#clock());
    this.#emit({ name: "controller.stop_cleared", unitId: this.#unitId });
    return this.status();
  }

  async start(command: ControllerCommand): Promise<LocalReceipt> {
    this.#assertOpen();
    validateCommand(command);
    if (command.unitId !== this.#unitId) throw new LocalControllerError("wrong_unit", "command targets another Unit");
    if (command.controllerEpoch !== this.#epoch) throw new LocalControllerError("fenced", "claim controller epoch is not current");
    const digest = command.requestDigest;
    const receiptId = stableReceiptId(command.executionId, digest);
    const existing = this.#ledger.receipt(command.executionId);
    if (existing) {
      if (existing.request_digest !== digest || existing.receipt_id !== receiptId || existing.unit_id !== this.#unitId) {
        throw new LocalControllerError("idempotency_conflict", "executionId is already bound to a different accepted request");
      }
      return toReceipt(existing);
    }
    const now = this.#clock();
    const state = this.#ledger.state(this.#unitId)!;
    if (state.stop_latched === 1) throw new LocalControllerError("stop_latched", "local stop is latched");
    if (state.active_execution_id) throw new LocalControllerError("unit_reserved", "Unit already has an active execution");
    const requestJson = canonicalize(command.normalizedRequest);
    this.#ledger.transaction(() => {
      this.#ledger.insertReceipt({
        receiptId,
        executionId: command.executionId,
        unitId: command.unitId,
        controllerEpoch: command.controllerEpoch,
        action: command.kind,
        bindingPolicy: command.bindingPolicy,
        requestDigest: digest,
        requestJson,
        admittedAt: now,
      });
      this.#ledger.setState({ unitId: this.#unitId, stopLatched: false, safeState: "unknown", activeExecutionId: command.executionId, now });
      this.#ledger.updateReceipt({ executionId: command.executionId, outcome: "running", safeState: "unknown", now });
    });
    this.#emit({ name: "execution.admitted", executionId: command.executionId, unitId: this.#unitId });
    this.#startWatchdog(command.executionId, Math.min(this.#maxRunMs, command.bindingPolicy.maxRunMs));
    const abort = new AbortController();
    this.#activeAbort = abort;
    let result: ExecutorResult;
    try {
      result = await this.#executor.execute(command, abort.signal);
    } catch (error) {
      result = { outcome: "unknown", safeState: "unknown", effect: "none", completion: undefined };
      this.#emit({ name: "execution.effect_unknown", executionId: command.executionId, unitId: this.#unitId, fields: { error: String(error) } });
    } finally {
      if (this.#activeAbort === abort) this.#activeAbort = undefined;
    }
    return this.#applyExecutorResult(command, result);
  }

  /**
   * Persist a cancellation receipt for an accepted request that was never
   * claimed. This path deliberately does not invoke the executor or clear a
   * stop; the host must first obtain a fresh local safe-state confirmation.
   */
  recordNotStartedCancellation(command: ControllerCommand): LocalReceipt {
    this.#assertOpen();
    validateCommand(command);
    if (command.unitId !== this.#unitId) throw new LocalControllerError("wrong_unit", "command targets another Unit");
    const existing = this.#ledger.receipt(command.executionId);
    const receiptId = stableReceiptId(command.executionId, command.requestDigest);
    if (existing) {
      if (existing.request_digest !== command.requestDigest || existing.receipt_id !== receiptId || existing.unit_id !== this.#unitId) {
        throw new LocalControllerError("idempotency_conflict", "executionId is already bound to a different accepted request");
      }
      return toReceipt(existing);
    }
    if (this.#activeExecutionId()) throw new LocalControllerError("unit_reserved", "Unit already has an active execution");
    const now = this.#clock();
    this.#ledger.transaction(() => {
      this.#ledger.insertReceipt({
        receiptId,
        executionId: command.executionId,
        unitId: command.unitId,
        controllerEpoch: command.controllerEpoch,
        action: command.kind,
        bindingPolicy: command.bindingPolicy,
        requestDigest: command.requestDigest,
        requestJson: canonicalize(command.normalizedRequest),
        admittedAt: now,
      });
      this.#ledger.updateReceipt({
        executionId: command.executionId,
        outcome: "cancelled",
        safeState: "confirmed",
        cancellationRequested: true,
        now,
      });
      this.#ledger.setState({ unitId: this.#unitId, stopLatched: true, safeState: "confirmed", activeExecutionId: null, now });
    });
    this.#emit({ name: "execution.cancelled_before_claim", executionId: command.executionId, unitId: this.#unitId });
    return toReceipt(this.#ledger.receipt(command.executionId)!);
  }

  async cancel(executionId: string): Promise<LocalReceipt> {
    this.#assertOpen();
    const row = this.#ledger.receipt(executionId);
    if (!row) throw new LocalControllerError("not_found", `execution ${executionId} is not recorded`);
    if (row.outcome === "succeeded" || row.outcome === "cancelled" || row.outcome === "failed") return toReceipt(row);
    const now = this.#clock();
    this.#ledger.updateReceipt({ executionId, outcome: row.outcome, safeState: "unknown", cancellationRequested: true, now });
    this.#setState(true, "unknown", executionId, now);
    this.#activeAbort?.abort("cancelled");
    const stopped = await this.#executor.stop("cancelled");
    return this.#closeFromStop(executionId, stopped, "cancelled");
  }

  async stop(reason: string): Promise<LocalReceipt | undefined> {
    this.#assertOpen();
    const now = this.#clock();
    const active = this.#activeExecutionId();
    this.#setState(true, "unknown", active, now);
    const stopped = await this.#executor.stop(reason);
    this.#emit({ name: "controller.stop", executionId: active, unitId: this.#unitId, fields: { reason } });
    if (!active) {
      if (stopped.safeState === "confirmed") this.#setState(true, "confirmed", null, this.#clock());
      return undefined;
    }
    return this.#closeFromStop(active, stopped, "failed");
  }

  /** Reconcile durable state after a restart or a delayed controller receipt. */
  reconcile(executionId: string, fact?: ReconciledFact): LocalReceipt {
    this.#assertOpen();
    const row = this.#ledger.receipt(executionId);
    if (!row) throw new LocalControllerError("not_found", `execution ${executionId} is not recorded`);
    if (row.outcome === "succeeded" || row.outcome === "cancelled" || row.outcome === "failed") {
      if (row.safe_state === "confirmed" && this.#activeExecutionId() === executionId) {
        this.#setState(true, "confirmed", null, this.#clock());
      }
      if (!fact) return toReceipt(this.#ledger.receipt(executionId)!);
      validateFact(fact);
      this.#ledger.updateReceipt({ executionId, outcome: row.outcome, safeState: row.safe_state, lateFact: fact, now: this.#clock() });
      return toReceipt(this.#ledger.receipt(executionId)!);
    }
    if (!fact) return toReceipt(row);
    validateFact(fact);
    const now = this.#clock();
    if (row.cancellation_requested) {
      const outcome = fact.safeState === "confirmed" ? "cancelled" : "unknown";
      this.#ledger.updateReceipt({ executionId, outcome, safeState: fact.safeState, cancellationRequested: true, lateFact: fact, now });
      if (fact.safeState === "confirmed") this.#setState(true, "confirmed", null, now);
      else this.#setState(true, "unknown", executionId, now);
      this.#clearWatchdog();
      return toReceipt(this.#ledger.receipt(executionId)!);
    }
    if (fact.safeState !== "confirmed" || fact.outcome === "unknown" || fact.outcome === "running") {
      this.#ledger.updateReceipt({ executionId, outcome: "unknown", safeState: fact.safeState, now });
      this.#setState(true, fact.safeState, executionId, now);
      return toReceipt(this.#ledger.receipt(executionId)!);
    }
    this.#ledger.updateReceipt({ executionId, outcome: fact.outcome, safeState: "confirmed", completion: fact.completion, now });
    this.#setState(false, "confirmed", null, now);
    this.#clearWatchdog();
    return toReceipt(this.#ledger.receipt(executionId)!);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearWatchdog();
    this.#activeAbort?.abort("controller_closed");
    this.#ledger.close();
  }

  #applyExecutorResult(command: ControllerCommand, result: ExecutorResult): LocalReceipt {
    if (result.effect !== "none") throw new LocalControllerError("executor_contract", "executor reported a physical effect");
    const row = this.#ledger.receipt(command.executionId);
    if (!row) throw new LocalControllerError("storage_corrupt", "admitted receipt disappeared");
    if (row.outcome === "succeeded" || row.outcome === "cancelled" || row.outcome === "failed") {
      this.#ledger.updateReceipt({ executionId: command.executionId, outcome: row.outcome, safeState: row.safe_state,
        lateFact: { outcome: result.outcome, safeState: result.safeState, completion: result.completion, source: "late-receipt" }, now: this.#clock() });
      return toReceipt(this.#ledger.receipt(command.executionId)!);
    }
    if (row.cancellation_requested) {
      const outcome = result.safeState === "confirmed" ? "cancelled" : "unknown";
      this.#ledger.updateReceipt({ executionId: command.executionId, outcome, safeState: result.safeState, cancellationRequested: true,
        lateFact: { outcome: result.outcome, safeState: result.safeState, completion: result.completion, source: "late-receipt" }, now: this.#clock() });
      if (result.safeState === "confirmed") this.#setState(true, "confirmed", null, this.#clock());
      else this.#setState(true, "unknown", command.executionId, this.#clock());
      this.#clearWatchdog();
      return toReceipt(this.#ledger.receipt(command.executionId)!);
    }
    if (result.safeState !== "confirmed" || result.outcome === "unknown") {
      this.#ledger.updateReceipt({ executionId: command.executionId, outcome: "unknown", safeState: result.safeState, now: this.#clock() });
      this.#setState(true, result.safeState, command.executionId, this.#clock());
      this.#clearWatchdog();
      return toReceipt(this.#ledger.receipt(command.executionId)!);
    }
    this.#ledger.updateReceipt({ executionId: command.executionId, outcome: result.outcome, safeState: "confirmed", completion: result.completion, now: this.#clock() });
    this.#setState(false, "confirmed", null, this.#clock());
    this.#clearWatchdog();
    this.#emit({ name: `execution.${result.outcome}`, executionId: command.executionId, unitId: this.#unitId });
    return toReceipt(this.#ledger.receipt(command.executionId)!);
  }

  #closeFromStop(executionId: string, stopped: StopResult, outcome: "cancelled" | "failed"): LocalReceipt {
    const now = this.#clock();
    if (stopped.safeState !== "confirmed") {
      this.#ledger.updateReceipt({ executionId, outcome: "unknown", safeState: "unknown", now });
      this.#setState(true, "unknown", executionId, now);
      this.#clearWatchdog();
      return toReceipt(this.#ledger.receipt(executionId)!);
    }
    const row = this.#ledger.receipt(executionId)!;
    this.#ledger.updateReceipt({ executionId, outcome, safeState: "confirmed", cancellationRequested: outcome === "cancelled" || row.cancellation_requested === 1, now });
    this.#setState(true, "confirmed", null, now);
    this.#clearWatchdog();
    return toReceipt(this.#ledger.receipt(executionId)!);
  }

  #startWatchdog(executionId: string, maxRunMs: number): void {
    this.#clearWatchdog();
    const startedAt = this.#monotonicMs();
    const check = async () => {
      if (this.#closed || this.#activeExecutionId() !== executionId) return;
      const elapsed = this.#monotonicMs() - startedAt;
      if (elapsed < maxRunMs) {
        this.#watchdog = setTimeout(() => { void check(); }, Math.max(1, maxRunMs - elapsed));
        return;
      }
      this.#emit({ name: "execution.watchdog_expired", executionId, unitId: this.#unitId, fields: { elapsedMs: elapsed } });
      this.#activeAbort?.abort("watchdog");
      const stopped = await this.#executor.stop("watchdog");
      this.#closeFromStop(executionId, stopped, "failed");
    };
    this.#watchdog = setTimeout(() => { void check(); }, maxRunMs);
  }

  #clearWatchdog(): void {
    if (this.#watchdog) clearTimeout(this.#watchdog);
    this.#watchdog = undefined;
  }

  #activeExecutionId(): string | undefined {
    const state = this.#ledger.state(this.#unitId);
    return state?.active_execution_id ?? undefined;
  }

  #setState(stopLatched: boolean, safeState: SafeState, activeExecutionId: string | null | undefined, now: Date): void {
    this.#ledger.setState({ unitId: this.#unitId, stopLatched, safeState, activeExecutionId: activeExecutionId ?? null, now });
  }

  #emit(event: DiagnosticEvent): void {
    try { this.#diagnostics?.(event); } catch { /* diagnostics cannot affect safety or durability */ }
  }

  #assertOpen(): void {
    if (this.#closed) throw new LocalControllerError("closed", "local controller is closed");
  }
}

function validateFact(fact: ReconciledFact): void {
  if (fact.outcome === "succeeded" && !fact.completion) {
    throw new LocalControllerError("invalid_receipt", "succeeded reconciliation requires completion evidence");
  }
  if (fact.completion) {
    const completion = fact.completion;
    if (completion.outcome !== "succeeded" && completion.outcome !== "failed") {
      throw new LocalControllerError("invalid_receipt", "completion outcome is invalid");
    }
  }
  if (fact.source === "operator") {
    if (!fact.safeStateProof || fact.safeStateProof.state !== "confirmed" || fact.safeState !== "confirmed") {
      throw new LocalControllerError("safe_state_proof_required", "operator facts require a measured local safe-state proof");
    }
    if (!(fact.safeStateProof.observedAt instanceof Date) || Number.isNaN(fact.safeStateProof.observedAt.getTime())) {
      throw new LocalControllerError("safe_state_proof_required", "operator safe-state proof timestamp is invalid");
    }
  }
}
