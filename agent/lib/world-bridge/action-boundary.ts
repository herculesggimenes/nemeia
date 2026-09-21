import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "spacetimedb";
import type {
  ActionIntent,
  CurrentWorldSnapshot,
  NavigateIntent,
  RequestExecutionParams,
  WorldClient,
} from "../../../world-client/src/index.ts";
import { canonicalJson as generatedCanonicalJson } from "../../../world-client/src/json.ts";
import { assertBindingMatches, assertSamePrincipal, WorldAuthorizationError } from "./authz.ts";
import { DeliveryLedger } from "./delivery-ledger.ts";
import type { StepIdentity, TrustedWorldBinding } from "./types.ts";

/**
 * The only action values accepted from an Eve model/custom command.
 *
 * Unit, world, principal, step, credentials, revisions, deadlines, execution
 * ids, and idempotency keys are deliberately absent. The host supplies the
 * binding and step, while the authorized generated snapshot supplies every
 * admission pin.
 */
export type TrustedActionProposal =
  | {
      readonly kind: "navigate";
      readonly missionId: string;
      readonly objectiveId: string;
      readonly mapId: string;
      readonly targetFrameId?: string;
      readonly target: {
        readonly positionM: { readonly x: number; readonly y: number; readonly z: number };
        readonly orientation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
      };
    }
  | {
      readonly kind: "approach";
      readonly missionId: string;
      readonly objectiveId: string;
      readonly targetId: string;
      readonly standoffM: number;
    };

type NavigateTarget = Extract<TrustedActionProposal, { readonly kind: "navigate" }>["target"];

export interface TrustedActionHostContext {
  /** Authenticated Eve session binding; never sourced from proposal JSON. */
  readonly binding: TrustedWorldBinding;
  /** Framework-provided identity for this exact step; never model-selected. */
  readonly step: StepIdentity;
}

export type TrustedActionWorld = Pick<WorldClient, "snapshot" | "requestExecution">;

export type ActionReceiptStatus =
  | "proposed"
  | "uncertain"
  | "accepted"
  | "running"
  | "cancelling"
  | "succeeded"
  | "cancelled"
  | "failed";

export interface ActionReceipt {
  readonly executionId: string;
  readonly status: ActionReceiptStatus;
  readonly worldState?: "Accepted" | "Running" | "Cancelling" | "Succeeded" | "Cancelled" | "Failed";
  readonly worldReceiptId?: string;
  readonly requestFingerprint: string;
  readonly request: RequestExecutionParams;
  readonly acceptBy: string;
  readonly unitId: string;
  readonly missionId: string;
  readonly objectiveId: string;
  readonly step: StepIdentity;
}

export interface TrustedActionPort {
  propose(proposal: TrustedActionProposal, binding?: TrustedWorldBinding): Promise<ActionReceipt>;
  status(binding?: TrustedWorldBinding): Promise<ActionReceipt | undefined>;
  reconcile(binding?: TrustedWorldBinding): Promise<readonly ActionReceipt[]>;
}

export interface TrustedActionBoundaryOptions {
  readonly ledger: DeliveryLedger;
  readonly world: TrustedActionWorld;
  readonly hostContext: () => TrustedActionHostContext | Promise<TrustedActionHostContext>;
  /** Optional host-side auth recheck. Snapshot readiness remains mandatory. */
  readonly authorizeCurrentPrincipal?: (binding: TrustedWorldBinding) => void | Promise<void>;
  /** Inject a deterministic native Timestamp in tests; production uses SDK time. */
  readonly now?: () => Timestamp;
}

export class ActionBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "ActionBoundaryError";
    this.code = code;
  }
}

export class ActionBoundaryConflictError extends ActionBoundaryError {
  constructor(code: string, message = code) {
    super(code, message);
    this.name = "ActionBoundaryConflictError";
  }
}

type ActionName = "navigate@1" | "approach@1";
type GeneratedState = NonNullable<NonNullable<CurrentWorldSnapshot["relevantExecutions"][number]["state"]>>["tag"];
type KnownState = "Accepted" | "Running" | "Cancelling" | "Succeeded" | "Cancelled" | "Failed";

interface CurrentSelection {
  readonly proposal: TrustedActionProposal;
  readonly actionName: ActionName;
  readonly unitId: string;
  readonly assignmentRevision: bigint;
  readonly missionRevision: bigint;
  readonly targetVersion: bigint;
  readonly bindingVersion: bigint;
  readonly acceptBy: Timestamp;
  readonly requestInput: ActionIntent;
}

interface StoredActionRow {
  readonly intentId: string;
  readonly fingerprint: string;
  readonly status: string;
  readonly acceptBy: string;
  readonly worldState?: string;
  readonly worldReceiptId?: string;
  readonly requestJson: string;
  readonly requestDigest: string;
  readonly proposalJson: string;
  readonly worldId: string;
  readonly agentId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly unitId: string;
  readonly missionId: string;
  readonly objectiveId: string;
}

const TERMINAL_STATUSES = new Set<ActionReceiptStatus>(["succeeded", "cancelled", "failed"]);
const TERMINAL_WORLD_STATES = new Set<KnownState>(["Succeeded", "Cancelled", "Failed"]);
const ensuredDatabases = new WeakSet<object>();

/**
 * world-client's canonical codec intentionally recognizes its own native
 * Timestamp class. During the current workspace transition agent and
 * world-client may resolve separate copies of spacetimedb, so normalize the
 * SDK's documented structural timestamp before delegating to that codec. This
 * preserves microseconds while retaining its bigint-lossless/key-sorted rules.
 */
function normalizeGeneratedNative(value: unknown, seen: WeakSet<object>): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") {
    const candidate = value as { readonly __timestamp_micros_since_unix_epoch__?: unknown; readonly toISOString?: unknown };
    if (typeof candidate.__timestamp_micros_since_unix_epoch__ === "bigint" && typeof candidate.toISOString === "function") {
      return (candidate.toISOString as () => string)();
    }
    if (seen.has(value)) throw new TypeError("cannot canonicalize cyclic generated value");
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => normalizeGeneratedNative(item, seen));
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeGeneratedNative(child, seen)]));
    } finally {
      seen.delete(value);
    }
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return generatedCanonicalJson(normalizeGeneratedNative(value, new WeakSet<object>()));
}

function ensureActionReceiptSchema(ledger: DeliveryLedger): void {
  const db = ledger.db;
  if (ensuredDatabases.has(db)) return;
  const columns = new Set(
    (db.prepare("PRAGMA table_info(action_receipt)").all() as Record<string, unknown>[]).map((row) => String(row.name)),
  );
  const additions: readonly [string, string][] = [
    ["world_id", "TEXT"],
    ["agent_id", "TEXT"],
    ["session_id", "TEXT"],
    ["turn_id", "TEXT"],
    ["step_index", "INTEGER"],
    ["action_step_key", "TEXT"],
    ["proposal_json", "TEXT"],
    ["request_json", "TEXT"],
    ["request_digest", "TEXT"],
    ["unit_id", "TEXT"],
    ["mission_id", "TEXT"],
    ["objective_id", "TEXT"],
    ["last_error", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE action_receipt ADD COLUMN ${name} ${definition}`);
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS action_receipt_step_key_unique ON action_receipt(action_step_key) WHERE action_step_key IS NOT NULL",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS action_receipt_scope_status_idx ON action_receipt(world_id, agent_id, unit_id, status, updated_at)",
  );
  ensuredDatabases.add(db);
}

function boundedString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\u0000")) {
    throw new ActionBoundaryError("invalid_proposal", `${field} is not a bounded string`);
  }
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ActionBoundaryError("invalid_proposal", `${field} must be finite`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ActionBoundaryError("invalid_proposal", `${field} contains an unsupported field`);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionBoundaryError("invalid_proposal", `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function pose(value: unknown): NavigateTarget {
  const root = record(value, "target");
  exactKeys(root, ["positionM", "orientation"], "target");
  const position = record(root.positionM, "target.positionM");
  const orientation = record(root.orientation, "target.orientation");
  exactKeys(position, ["x", "y", "z"], "target.positionM");
  exactKeys(orientation, ["x", "y", "z", "w"], "target.orientation");
  const result = {
    positionM: {
      x: finiteNumber(position.x, "target.positionM.x"),
      y: finiteNumber(position.y, "target.positionM.y"),
      z: finiteNumber(position.z, "target.positionM.z"),
    },
    orientation: {
      x: finiteNumber(orientation.x, "target.orientation.x"),
      y: finiteNumber(orientation.y, "target.orientation.y"),
      z: finiteNumber(orientation.z, "target.orientation.z"),
      w: finiteNumber(orientation.w, "target.orientation.w"),
    },
  } as const;
  const norm = Math.hypot(result.orientation.x, result.orientation.y, result.orientation.z, result.orientation.w);
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) {
    throw new ActionBoundaryError("invalid_proposal", "target quaternion must be normalized");
  }
  return result;
}

/** Parse the untrusted JSON shape without accepting authority or bigint pins. */
export function parseTrustedActionProposal(value: unknown): TrustedActionProposal {
  const root = record(value, "action proposal");
  const kind = root.kind;
  if (kind === "navigate") {
    const hasTargetFrameId = Object.hasOwn(root, "targetFrameId");
    exactKeys(
      root,
      hasTargetFrameId
        ? ["kind", "missionId", "objectiveId", "mapId", "targetFrameId", "target"]
        : ["kind", "missionId", "objectiveId", "mapId", "target"],
      "navigate proposal",
    );
    const targetFrameId = hasTargetFrameId ? boundedString(root.targetFrameId, "targetFrameId") : undefined;
    return {
      kind,
      missionId: boundedString(root.missionId, "missionId"),
      objectiveId: boundedString(root.objectiveId, "objectiveId"),
      mapId: boundedString(root.mapId, "mapId"),
      ...(targetFrameId === undefined ? {} : { targetFrameId }),
      target: pose(root.target),
    };
  }
  if (kind === "approach") {
    exactKeys(root, ["kind", "missionId", "objectiveId", "targetId", "standoffM"], "approach proposal");
    const standoffM = finiteNumber(root.standoffM, "standoffM");
    if (standoffM <= 0) throw new ActionBoundaryError("invalid_proposal", "standoffM must be positive");
    return {
      kind,
      missionId: boundedString(root.missionId, "missionId"),
      objectiveId: boundedString(root.objectiveId, "objectiveId"),
      targetId: boundedString(root.targetId, "targetId"),
      standoffM,
    };
  }
  throw new ActionBoundaryError("invalid_proposal", "action kind must be navigate or approach");
}

function actionName(proposal: TrustedActionProposal): ActionName {
  return proposal.kind === "navigate" ? "navigate@1" : "approach@1";
}

function timestampMicros(value: unknown): bigint {
  if (value instanceof Timestamp) return value.microsSinceUnixEpoch;
  if (value instanceof Date) return BigInt(value.getTime()) * 1_000n;
  if (value !== null && typeof value === "object" && typeof (value as { microsSinceUnixEpoch?: unknown }).microsSinceUnixEpoch === "bigint") {
    return (value as { microsSinceUnixEpoch: bigint }).microsSinceUnixEpoch;
  }
  throw new ActionBoundaryError("invalid_world_snapshot", "world timestamp is not a native generated timestamp");
}

function timestampIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && typeof (value as { toISOString?: unknown }).toISOString === "function") {
    return (value as { toISOString: () => string }).toISOString();
  }
  throw new ActionBoundaryError("invalid_world_snapshot", "world timestamp is not serializable");
}

function timestampFromIso(value: string): Timestamp {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u.exec(value);
  if (!match) throw new ActionBoundaryError("ledger_corrupt", "persisted action deadline is not an exact UTC timestamp");
  const millis = Date.parse(`${match[1]}.000Z`);
  if (!Number.isFinite(millis)) throw new ActionBoundaryError("ledger_corrupt", "persisted action deadline is invalid");
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  return new Timestamp(BigInt(millis) * 1_000n + fraction);
}

function decimalBigInt(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new ActionBoundaryError("ledger_corrupt", `${field} is not a lossless decimal bigint`);
  }
  try {
    return BigInt(value);
  } catch {
    throw new ActionBoundaryError("ledger_corrupt", `${field} is not a valid bigint`);
  }
}

function knownState(value: unknown): KnownState {
  if (value === null || typeof value !== "object" || typeof (value as { tag?: unknown }).tag !== "string") {
    throw new ActionBoundaryError("invalid_world_snapshot", "execution state is not a generated enum");
  }
  const tag = (value as { tag: string }).tag;
  if (!["Accepted", "Running", "Cancelling", "Succeeded", "Cancelled", "Failed"].includes(tag)) {
    throw new ActionBoundaryError("invalid_world_snapshot", `unsupported generated execution state ${tag}`);
  }
  return tag as KnownState;
}

function statusForWorldState(state: KnownState): ActionReceiptStatus {
  return state.toLowerCase() as ActionReceiptStatus;
}

function canonicalDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stepKey(binding: TrustedWorldBinding, step: StepIdentity): string {
  return canonicalDigest({
    worldId: binding.worldId,
    agentId: binding.agentId,
    sessionId: step.sessionId,
    turnId: step.turnId,
    stepIndex: step.stepIndex,
  });
}

function validateStep(step: StepIdentity): void {
  boundedString(step.sessionId, "sessionId");
  boundedString(step.turnId, "turnId");
  if (!Number.isSafeInteger(step.stepIndex) || step.stepIndex < 0) {
    throw new ActionBoundaryError("invalid_host_context", "stepIndex is not a safe framework step index");
  }
}

function millisDeadline(now: Timestamp, maxRunMs: number): Timestamp {
  if (!Number.isSafeInteger(maxRunMs) || maxRunMs <= 0 || maxRunMs > 0xffffffff) {
    throw new ActionBoundaryError("invalid_action_binding", "maxRunMs is outside the generated u32 range");
  }
  return new Timestamp(now.microsSinceUnixEpoch + BigInt(maxRunMs) * 1_000n);
}

function minTimestamp(left: Timestamp, right: Timestamp): Timestamp {
  return left.microsSinceUnixEpoch <= right.microsSinceUnixEpoch ? left : right;
}

function snapshotReadiness(snapshot: CurrentWorldSnapshot, binding: TrustedWorldBinding): void {
  const readiness = snapshot.readiness.find((row) => row.worldId === binding.worldId);
  if (readiness === undefined || !readiness.authorized || !readiness.synchronized) {
    throw new WorldAuthorizationError("authorized generated world snapshot is unavailable");
  }
  if (!["agent", "world_operator", "admin"].includes(readiness.role)) {
    throw new WorldAuthorizationError("current principal cannot propose a trusted action");
  }
}

function missionFor(snapshot: CurrentWorldSnapshot, proposal: TrustedActionProposal, binding: TrustedWorldBinding, allowClosed: boolean) {
  const mission = snapshot.assignedMissions.find((row) => row.id === proposal.missionId);
  if (mission === undefined) throw new ActionBoundaryError("mission_not_assigned", "mission is not in the authorized snapshot");
  const membership = snapshot.relevantMissionAgents.find(
    (row) => row.missionId === proposal.missionId && row.agentId === binding.agentId && row.active,
  );
  if (membership === undefined) throw new WorldAuthorizationError("agent is not an active mission participant");
  const state = String((mission.state as { tag?: unknown }).tag);
  if (!allowClosed && state !== "Active") throw new ActionBoundaryError("mission_not_active", "mission is not active");
  const objective = mission.spec.objectives.find((row) => row.id === proposal.objectiveId);
  if (objective === undefined) throw new ActionBoundaryError("objective_missing", "objective is not in the authorized mission");
  return { mission, objective };
}

function grantFor(
  snapshot: CurrentWorldSnapshot,
  binding: TrustedWorldBinding,
  name: ActionName,
  now: Timestamp,
  requestedUnitId?: string,
) {
  const ownRows = snapshot.relevantUnitAssignments.filter((row) => row.agentId === binding.agentId);
  const rows = ownRows.filter((row) => row.actionNames.includes(name));
  const usable = rows.filter((row) => row.expiresAt === undefined || timestampMicros(row.expiresAt) > now.microsSinceUnixEpoch);
  if (requestedUnitId !== undefined) {
    const row = usable.find((candidate) => candidate.unitId === requestedUnitId);
    if (row === undefined) {
      if (rows.some((candidate) => candidate.unitId === requestedUnitId)) {
        throw new WorldAuthorizationError("unit grant is expired or revoked");
      }
      throw new WorldAuthorizationError("unit action is not granted to this agent");
    }
    return row;
  }
  if (usable.length === 0) {
    if (rows.length > 0) throw new WorldAuthorizationError("unit grant is expired or revoked");
    throw new WorldAuthorizationError("unit action is not granted to this agent");
  }
  if (usable.length !== 1) throw new ActionBoundaryError("ambiguous_unit_grant", "one current own Unit grant is required");
  return usable[0];
}

function bindingFor(snapshot: CurrentWorldSnapshot, unitId: string, name: ActionName) {
  const row = snapshot.relevantActionBindings.find((candidate) => candidate.unitId === unitId && candidate.actionName === name);
  if (row === undefined) throw new ActionBoundaryError("action_binding_missing", "current action binding is not installed");
  if (String((row.policy.mode as { tag?: unknown }).tag) !== "Simulation") {
    throw new ActionBoundaryError("physical_adapter_not_qualified", "physical action adapters are not enabled by this boundary");
  }
  if (!Number.isFinite(row.policy.maxLinearMps) || row.policy.maxLinearMps <= 0 ||
      !Number.isFinite(row.policy.toleranceM) || row.policy.toleranceM < 0) {
    throw new ActionBoundaryError("invalid_action_binding", "current action binding has invalid limits");
  }
  return row;
}

function geometryVersion(snapshot: CurrentWorldSnapshot, targetId: string): bigint {
  const entity = snapshot.relevantEntities.find((row) => row.id === targetId && row.removedAt === undefined);
  if (entity === undefined) throw new ActionBoundaryError("target_entity_missing", "target is not in the authorized snapshot");
  const rows = snapshot.relevantGeometry.filter(
    (row) => row.entityId === targetId && String((row.value as { tag?: unknown }).tag) === "BoundingBox3D",
  );
  if (rows.length === 0) throw new ActionBoundaryError("target_geometry_missing", "current 3D geometry evidence is unavailable");
  return rows.reduce((latest, row) => row.version > latest ? row.version : latest, 0n);
}

function controlFor(snapshot: CurrentWorldSnapshot, unitId: string) {
  const control = snapshot.relevantUnitControls.find((row) => row.unitId === unitId);
  if (control === undefined || control.stopLatched || !control.safeStateConfirmed) {
    throw new ActionBoundaryError("unit_not_safe_for_admission", "current Unit safe state is not confirmed");
  }
  return control;
}

function nonterminalExecution(snapshot: CurrentWorldSnapshot, unitId: string, except?: string) {
  const row = snapshot.relevantExecutions.find((candidate) => {
    if (candidate.unitId !== unitId || candidate.id === except) return false;
    return !TERMINAL_WORLD_STATES.has(knownState(candidate.state));
  });
  return row;
}

function actionInput(proposal: TrustedActionProposal, targetVersion: bigint, mapRootFrameId?: string): ActionIntent {
  if (proposal.kind === "navigate") {
    const input: NavigateIntent = {
      mapId: proposal.mapId,
      basisRevision: targetVersion,
      targetFrameId: proposal.targetFrameId ?? mapRootFrameId ?? "",
      target: proposal.target,
    };
    return { tag: "Navigate", value: input } as ActionIntent;
  }
  return {
    tag: "Approach",
    value: {
      targetId: proposal.targetId,
      standoffM: proposal.standoffM,
      expectedGeometryVersion: targetVersion,
    },
  } as ActionIntent;
}

function acceptByFor(now: Timestamp, binding: { readonly policy: { readonly maxRunMs: number } }, assignmentExpiresAt: unknown, missionDeadlineAt: unknown): Timestamp {
  let result = millisDeadline(now, binding.policy.maxRunMs);
  if (assignmentExpiresAt !== undefined) result = minTimestamp(result, new Timestamp(timestampMicros(assignmentExpiresAt)));
  if (missionDeadlineAt !== undefined) result = minTimestamp(result, new Timestamp(timestampMicros(missionDeadlineAt)));
  if (result.microsSinceUnixEpoch <= now.microsSinceUnixEpoch) {
    throw new ActionBoundaryError("execution_acceptance_expired", "current grant or mission deadline is not in the future");
  }
  return result;
}

function makeSelection(
  snapshot: CurrentWorldSnapshot,
  proposal: TrustedActionProposal,
  binding: TrustedWorldBinding,
  now: Timestamp,
  options: { readonly requireSafe: boolean; readonly allowClosedMission: boolean },
): CurrentSelection {
  const name = actionName(proposal);
  const { mission, objective } = missionFor(snapshot, proposal, binding, options.allowClosedMission);
  const assignment = grantFor(snapshot, binding, name, now);
  const installed = bindingFor(snapshot, assignment.unitId, name);
  if (proposal.kind === "approach") {
    if (String((objective.criterion as { tag?: unknown }).tag) !== "Approached") {
      throw new ActionBoundaryError("action_objective_mismatch", "approach is not the current objective action");
    }
    const criterion = (objective.criterion as { value?: { targetId?: unknown; standoffM?: unknown } }).value;
    if (criterion?.targetId !== proposal.targetId || criterion.standoffM !== proposal.standoffM) {
      throw new ActionBoundaryError("action_objective_mismatch", "approach target does not match the objective");
    }
  }
  let targetVersion: bigint;
  let input: ActionIntent;
  if (proposal.kind === "navigate") {
    const map = snapshot.relevantLocalMaps.find((row) => row.id === proposal.mapId && row.unitId === assignment.unitId);
    if (map === undefined || map.headRevision === undefined) throw new ActionBoundaryError("navigation_map_missing", "current local map revision is unavailable");
    if (proposal.targetFrameId !== undefined && proposal.targetFrameId !== map.rootFrameId) {
      throw new ActionBoundaryError("navigation_frame_stale", "target frame is not the current map root frame");
    }
    targetVersion = map.headRevision;
    input = actionInput(proposal, targetVersion, map.rootFrameId);
  } else {
    targetVersion = geometryVersion(snapshot, proposal.targetId);
    input = actionInput(proposal, targetVersion);
  }
  if (options.requireSafe) {
    controlFor(snapshot, assignment.unitId);
    const active = nonterminalExecution(snapshot, assignment.unitId);
    if (active !== undefined) throw new ActionBoundaryError("unit_operation_pending", "Unit has an active execution");
  }
  const acceptBy = acceptByFor(now, installed, assignment.expiresAt, mission.spec.deadlineAt);
  return {
    proposal,
    actionName: name,
    unitId: assignment.unitId,
    assignmentRevision: assignment.revision,
    missionRevision: mission.revision,
    targetVersion,
    bindingVersion: installed.version,
    acceptBy,
    requestInput: input,
  };
}

function requestFor(selection: CurrentSelection, executionId: string, binding: TrustedWorldBinding): RequestExecutionParams {
  return {
    executionId,
    unitId: selection.unitId,
    assignment: { agentId: binding.agentId, revision: selection.assignmentRevision },
    missionLink: {
      missionId: selection.proposal.missionId,
      objectiveId: selection.proposal.objectiveId,
      expectedRevision: selection.missionRevision,
    },
    input: selection.requestInput,
    bindingVersion: selection.bindingVersion,
    targetVersion: selection.targetVersion,
    acceptBy: selection.acceptBy,
  };
}

function decodeRequest(value: string): RequestExecutionParams {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ActionBoundaryError("ledger_corrupt", "persisted action request is invalid JSON");
  }
  const root = record(parsed, "persisted request");
  const assignmentValue = root.assignment === undefined ? undefined : record(root.assignment, "persisted assignment");
  const missionValue = root.missionLink === undefined ? undefined : record(root.missionLink, "persisted mission link");
  const input = record(root.input, "persisted action input");
  const inputTag = input.tag;
  if (inputTag !== "Navigate" && inputTag !== "Approach") throw new ActionBoundaryError("ledger_corrupt", "persisted action enum is invalid");
  const inputValue = record(input.value, "persisted action value");
  const decodedInput: ActionIntent = inputTag === "Navigate"
    ? {
        tag: "Navigate",
        value: {
          mapId: boundedString(inputValue.mapId, "persisted mapId"),
          basisRevision: decimalBigInt(inputValue.basisRevision, "persisted basisRevision"),
          targetFrameId: boundedString(inputValue.targetFrameId, "persisted targetFrameId"),
          target: pose(inputValue.target),
        },
      } as ActionIntent
    : {
        tag: "Approach",
        value: {
          targetId: boundedString(inputValue.targetId, "persisted targetId"),
          standoffM: finiteNumber(inputValue.standoffM, "persisted standoffM"),
          expectedGeometryVersion: decimalBigInt(inputValue.expectedGeometryVersion, "persisted expectedGeometryVersion"),
        },
      } as ActionIntent;
  return {
    executionId: boundedString(root.executionId, "persisted executionId"),
    unitId: boundedString(root.unitId, "persisted unitId"),
    assignment: assignmentValue === undefined ? undefined : {
      agentId: boundedString(assignmentValue.agentId, "persisted assignment agentId"),
      revision: decimalBigInt(assignmentValue.revision, "persisted assignment revision"),
    },
    missionLink: missionValue === undefined ? undefined : {
      missionId: boundedString(missionValue.missionId, "persisted missionId"),
      objectiveId: boundedString(missionValue.objectiveId, "persisted objectiveId"),
      expectedRevision: decimalBigInt(missionValue.expectedRevision, "persisted mission revision"),
    },
    input: decodedInput,
    bindingVersion: decimalBigInt(root.bindingVersion, "persisted binding version"),
    targetVersion: decimalBigInt(root.targetVersion, "persisted target version"),
    acceptBy: timestampFromIso(boundedString(root.acceptBy, "persisted acceptBy")),
  };
}

function rowFrom(value: Record<string, unknown>): StoredActionRow {
  const requestJson = value.request_json;
  const proposalJson = value.proposal_json;
  const worldId = value.world_id;
  const agentId = value.agent_id;
  const sessionId = value.session_id;
  const turnId = value.turn_id;
  const stepIndex = value.step_index;
  if ([requestJson, proposalJson, worldId, agentId, sessionId, turnId, stepIndex].some((item) => item === null || item === undefined)) {
    throw new ActionBoundaryError("ledger_corrupt", "action receipt lacks its durable request identity");
  }
  return {
    intentId: String(value.intent_id),
    fingerprint: String(value.fingerprint),
    status: String(value.status),
    acceptBy: String(value.accept_by),
    ...(value.world_state === null || value.world_state === undefined ? {} : { worldState: String(value.world_state) }),
    ...(value.world_receipt_id === null || value.world_receipt_id === undefined ? {} : { worldReceiptId: String(value.world_receipt_id) }),
    requestJson: String(requestJson),
    requestDigest: String(value.request_digest),
    proposalJson: String(proposalJson),
    worldId: String(worldId),
    agentId: String(agentId),
    sessionId: String(sessionId),
    turnId: String(turnId),
    stepIndex: Number(stepIndex),
    unitId: String(value.unit_id),
    missionId: String(value.mission_id),
    objectiveId: String(value.objective_id),
  };
}

function receiptFrom(row: StoredActionRow): ActionReceipt {
  const request = decodeRequest(row.requestJson);
  const status = row.status as ActionReceiptStatus;
  if (!["proposed", "uncertain", "accepted", "running", "cancelling", "succeeded", "cancelled", "failed"].includes(status)) {
    throw new ActionBoundaryError("ledger_corrupt", `unknown action receipt status ${row.status}`);
  }
  return {
    executionId: row.intentId,
    status,
    ...(row.worldState === undefined ? {} : { worldState: row.worldState as ActionReceipt["worldState"] }),
    ...(row.worldReceiptId === undefined ? {} : { worldReceiptId: row.worldReceiptId }),
    requestFingerprint: row.fingerprint,
    request,
    acceptBy: row.acceptBy,
    unitId: row.unitId,
    missionId: row.missionId,
    objectiveId: row.objectiveId,
    step: { sessionId: row.sessionId, turnId: row.turnId, stepIndex: row.stepIndex },
  };
}

function worldRowMatches(row: CurrentWorldSnapshot["relevantExecutions"][number], request: RequestExecutionParams): void {
  if (row.id !== request.executionId || row.unitId !== request.unitId || row.agentId !== request.assignment?.agentId ||
      row.missionId !== request.missionLink?.missionId || row.objectiveId !== request.missionLink?.objectiveId ||
      row.bindingVersion !== request.bindingVersion || row.targetVersion !== request.targetVersion ||
      timestampMicros(row.acceptBy) !== timestampMicros(request.acceptBy) ||
      canonicalJson(row.input) !== canonicalJson(request.input)) {
    throw new ActionBoundaryConflictError("execution_body_conflict", "world execution body differs from the persisted generated request");
  }
}

function stepFor(row: StoredActionRow): StepIdentity {
  return { sessionId: row.sessionId, turnId: row.turnId, stepIndex: row.stepIndex };
}

function proposalFromRow(row: StoredActionRow): TrustedActionProposal {
  let value: unknown;
  try {
    value = JSON.parse(row.proposalJson) as unknown;
  } catch {
    throw new ActionBoundaryError("ledger_corrupt", "persisted action proposal is invalid JSON");
  }
  return parseTrustedActionProposal(value);
}

function dbRowByStep(ledger: DeliveryLedger, key: string): StoredActionRow | undefined {
  const row = ledger.db.prepare("SELECT * FROM action_receipt WHERE action_step_key = ?").get(key) as Record<string, unknown> | undefined;
  return row === undefined ? undefined : rowFrom(row);
}

function dbRowsForScope(ledger: DeliveryLedger, binding: TrustedWorldBinding): StoredActionRow[] {
  const rows = ledger.db
    .prepare("SELECT * FROM action_receipt WHERE world_id = ? AND agent_id = ? AND request_json IS NOT NULL ORDER BY created_at")
    .all(binding.worldId, binding.agentId) as Record<string, unknown>[];
  return rows.map(rowFrom);
}

function persistRequest(
  ledger: DeliveryLedger,
  binding: TrustedWorldBinding,
  host: TrustedActionHostContext,
  proposal: TrustedActionProposal,
  request: RequestExecutionParams,
): StoredActionRow {
  ensureActionReceiptSchema(ledger);
  const proposalJson = canonicalJson(proposal);
  const requestJson = canonicalJson(request);
  const requestDigest = `sha256:${canonicalDigest(request)}`;
  const key = stepKey(binding, host.step);
  const existing = dbRowByStep(ledger, key);
  if (existing !== undefined) {
    if (existing.proposalJson !== proposalJson) {
      throw new ActionBoundaryConflictError("step_body_conflict", "the framework step already has a different action proposal");
    }
    return existing;
  }
  const now = new Date().toISOString();
  // The ID is allocated once in the trusted host operation before this
  // transaction. Persist the exact same ID that is inside request_json; never
  // replace it with a second ledger-generated identity here.
  const executionId = request.executionId;
  ledger.db.exec("BEGIN IMMEDIATE");
  try {
    const concurrent = dbRowByStep(ledger, key);
    if (concurrent !== undefined) {
      if (concurrent.proposalJson !== proposalJson) throw new ActionBoundaryConflictError("step_body_conflict", "the framework step already has a different action proposal");
      ledger.db.exec("COMMIT");
      return concurrent;
    }
    ledger.db
      .prepare(
        `INSERT INTO action_receipt
         (intent_id, fingerprint, invocation_sequence, status, accept_by, world_state, world_receipt_id,
          created_at, updated_at, world_id, agent_id, session_id, turn_id, step_index, action_step_key,
          proposal_json, request_json, request_digest, unit_id, mission_id, objective_id, last_error)
         VALUES (?, ?, 0, 'proposed', ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        executionId,
        requestDigest,
        timestampIso(request.acceptBy),
        now,
        now,
        binding.worldId,
        binding.agentId,
        host.step.sessionId,
        host.step.turnId,
        host.step.stepIndex,
        key,
        proposalJson,
        requestJson,
        requestDigest,
        request.unitId,
        request.missionLink?.missionId ?? "",
        request.missionLink?.objectiveId ?? "",
      );
    ledger.db.exec("COMMIT");
  } catch (error) {
    try { ledger.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  }
  const inserted = dbRowByStep(ledger, key);
  if (inserted === undefined) throw new ActionBoundaryError("ledger_write_failed", "durable action request disappeared after commit");
  return inserted;
}

function updateReceipt(ledger: DeliveryLedger, row: StoredActionRow, input: { status: ActionReceiptStatus; worldState?: KnownState; worldReceiptId?: string; error?: string }): StoredActionRow {
  ledger.db
    .prepare(
      `UPDATE action_receipt
       SET status = ?, world_state = ?, world_receipt_id = ?, last_error = ?, updated_at = ?
       WHERE intent_id = ?`,
    )
    .run(input.status, input.worldState ?? null, input.worldReceiptId ?? null, input.error ?? null, new Date().toISOString(), row.intentId);
  const result = ledger.db.prepare("SELECT * FROM action_receipt WHERE intent_id = ?").get(row.intentId) as Record<string, unknown> | undefined;
  if (result === undefined) throw new ActionBoundaryError("ledger_write_failed", "action receipt disappeared after update");
  return rowFrom(result);
}

function currentGrantForStoredRequest(
  snapshot: CurrentWorldSnapshot,
  binding: TrustedWorldBinding,
  request: RequestExecutionParams,
  now: Timestamp,
  requireActiveMission: boolean,
): void {
  const inputName = request.input.tag === "Navigate" ? "navigate@1" : request.input.tag === "Approach" ? "approach@1" : undefined;
  if (inputName === undefined || request.assignment?.agentId !== binding.agentId) throw new WorldAuthorizationError("stored action is not owned by the current agent");
  const grant = snapshot.relevantUnitAssignments.find((candidate) => candidate.unitId === request.unitId && candidate.agentId === binding.agentId);
  if (grant === undefined || !grant.actionNames.includes(inputName) || grant.revision !== request.assignment.revision ||
      (grant.expiresAt !== undefined && timestampMicros(grant.expiresAt) <= now.microsSinceUnixEpoch)) {
    throw new WorldAuthorizationError("stored action grant is revoked or expired");
  }
  const installed = snapshot.relevantActionBindings.find((candidate) => candidate.unitId === request.unitId && candidate.actionName === inputName);
  if (installed === undefined || installed.version !== request.bindingVersion) {
    throw new ActionBoundaryError("action_binding_revision_conflict", "stored action binding is stale");
  }
  if (request.missionLink !== undefined) {
    const mission = snapshot.assignedMissions.find((candidate) => candidate.id === request.missionLink?.missionId);
    const membership = snapshot.relevantMissionAgents.find(
      (candidate) => candidate.missionId === request.missionLink?.missionId && candidate.agentId === binding.agentId && candidate.active,
    );
    if (mission === undefined || membership === undefined || mission.revision !== request.missionLink.expectedRevision) {
      throw new WorldAuthorizationError("stored action mission authority is revoked or stale");
    }
    if (requireActiveMission && String((mission.state as { tag?: unknown }).tag) !== "Active") {
      throw new ActionBoundaryError("mission_not_active", "mission is no longer active");
    }
  }
}

async function currentWorld(
  options: TrustedActionBoundaryOptions,
  binding: TrustedWorldBinding,
): Promise<CurrentWorldSnapshot> {
  if (options.authorizeCurrentPrincipal !== undefined) await options.authorizeCurrentPrincipal(binding);
  const snapshot = options.world.snapshot();
  snapshotReadiness(snapshot, binding);
  return snapshot;
}

function sameBinding(left: TrustedWorldBinding, right: TrustedWorldBinding): void {
  assertBindingMatches(left, right.worldId, right.agentId);
  assertSamePrincipal(left.principal, right.principal);
}

function reconcileRow(
  ledger: DeliveryLedger,
  row: StoredActionRow,
  snapshot: CurrentWorldSnapshot,
): StoredActionRow {
  const request = decodeRequest(row.requestJson);
  const worldRow = snapshot.relevantExecutions.find((candidate) => candidate.id === row.intentId);
  if (worldRow === undefined) {
    return updateReceipt(ledger, row, { status: "uncertain", error: "world execution is not yet visible; delivery remains uncertain" });
  }
  worldRowMatches(worldRow, request);
  const state = knownState(worldRow.state);
  return updateReceipt(ledger, row, {
    status: statusForWorldState(state),
    worldState: state,
    worldReceiptId: worldRow.receiptId,
  });
}

/**
 * Observe a committed execution before consulting mutable grant/map/mission
 * pins. This is read authority only: the current authenticated snapshot must
 * contain the same owned execution and the full generated body must match the
 * durable request. A visible terminal row therefore remains reconcilable after
 * a later grant, roster, mission, or perception revision.
 */
function visibleExecutionForReceipt(
  snapshot: CurrentWorldSnapshot,
  binding: TrustedWorldBinding,
  row: StoredActionRow,
  request: RequestExecutionParams,
): CurrentWorldSnapshot["relevantExecutions"][number] | undefined {
  const worldRow = snapshot.relevantExecutions.find((candidate) => candidate.id === row.intentId);
  if (worldRow === undefined) return undefined;
  if (worldRow.agentId !== binding.agentId || request.assignment?.agentId !== binding.agentId) {
    throw new WorldAuthorizationError("execution is not owned by the current agent");
  }
  worldRowMatches(worldRow, request);
  return worldRow;
}

function receiptWithRequest(row: StoredActionRow): ActionReceipt {
  return receiptFrom(row);
}

export function createTrustedActionPort(options: TrustedActionBoundaryOptions): TrustedActionPort {
  ensureActionReceiptSchema(options.ledger);
  let serial: Promise<unknown> = Promise.resolve();
  const runSerialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serial.then(operation, operation);
    serial = next.then(() => undefined, () => undefined);
    return next;
  };

  const resolveHost = async (provided?: TrustedWorldBinding): Promise<TrustedActionHostContext> => {
    const host = await options.hostContext();
    validateStep(host.step);
    assertBindingMatches(host.binding, host.binding.worldId, host.binding.agentId);
    if (provided !== undefined) sameBinding(provided, host.binding);
    return host;
  };

  const propose = (proposalValue: TrustedActionProposal, provided?: TrustedWorldBinding): Promise<ActionReceipt> => runSerialized(async () => {
    const proposal = parseTrustedActionProposal(proposalValue);
    const host = await resolveHost(provided);
    const binding = host.binding;
    const snapshot = await currentWorld(options, binding);
    const now = options.now?.() ?? Timestamp.now();
    const key = stepKey(binding, host.step);
    const existing = dbRowByStep(options.ledger, key);
    if (existing !== undefined) {
      if (existing.proposalJson !== canonicalJson(proposal)) {
        throw new ActionBoundaryConflictError("step_body_conflict", "the framework step already has a different action proposal");
      }
      const request = decodeRequest(existing.requestJson);
      // A committed world row is authoritative for receipt observation. Do
      // this before recomputing current map/geometry pins: perception may have
      // advanced after admission, and the retry must report the same receipt.
      if (visibleExecutionForReceipt(snapshot, binding, existing, request) !== undefined) {
        return receiptWithRequest(reconcileRow(options.ledger, existing, snapshot));
      }
      currentGrantForStoredRequest(snapshot, binding, request, now, !TERMINAL_STATUSES.has(existing.status as ActionReceiptStatus));
      const selection = makeSelection(snapshot, proposal, binding, now, { requireSafe: false, allowClosedMission: true });
      if (request.unitId !== selection.unitId || request.bindingVersion !== selection.bindingVersion ||
          request.targetVersion !== selection.targetVersion || request.missionLink?.expectedRevision !== selection.missionRevision ||
          request.input.tag !== selection.requestInput.tag || canonicalJson(request.input) !== canonicalJson(selection.requestInput)) {
        throw new ActionBoundaryConflictError("action_pins_stale", "current authorized pins differ from the persisted generated request");
      }
      const current = receiptWithRequest(existing);
      if (TERMINAL_STATUSES.has(current.status)) return current;
      if (timestampMicros(request.acceptBy) <= now.microsSinceUnixEpoch) {
        throw new ActionBoundaryConflictError("execution_acceptance_expired", "persisted action acceptance deadline has passed; no new deadline is generated");
      }
      try {
        await options.world.requestExecution(request);
        return receiptWithRequest(updateReceipt(options.ledger, existing, { status: "accepted" }));
      } catch {
        return receiptWithRequest(updateReceipt(options.ledger, existing, { status: "uncertain", error: "request outcome is uncertain" }));
      }
    }

    const selection = makeSelection(snapshot, proposal, binding, now, { requireSafe: true, allowClosedMission: false });
    const pending = dbRowsForScope(options.ledger, binding).filter(
      (row) => row.unitId === selection.unitId && !TERMINAL_STATUSES.has(row.status as ActionReceiptStatus),
    );
    for (const row of pending) {
      const authorized = decodeRequest(row.requestJson);
      // A visible committed row settles the old delivery even when its grant,
      // mission roster, or target pins have since changed. Only an operation
      // with no visible committed row needs current mutation authority below.
      if (visibleExecutionForReceipt(snapshot, binding, row, authorized) === undefined) {
        currentGrantForStoredRequest(snapshot, binding, authorized, now, false);
      }
      const reconciled = reconcileRow(options.ledger, row, snapshot);
      if (!TERMINAL_STATUSES.has(reconciled.status as ActionReceiptStatus)) {
        throw new ActionBoundaryConflictError("unit_operation_unknown", "a previous Unit operation remains pending or uncertain");
      }
    }
    if (nonterminalExecution(snapshot, selection.unitId) !== undefined) {
      throw new ActionBoundaryConflictError("unit_operation_pending", "the Unit has an active execution that must be reconciled");
    }
    const request = requestFor(selection, `exec_${randomUUID()}`, binding);
    const persisted = persistRequest(options.ledger, binding, host, proposal, request);
    const exactRequest = decodeRequest(persisted.requestJson);
    try {
      await options.world.requestExecution(exactRequest);
      return receiptWithRequest(updateReceipt(options.ledger, persisted, { status: "accepted" }));
    } catch {
      return receiptWithRequest(updateReceipt(options.ledger, persisted, { status: "uncertain", error: "request outcome is uncertain" }));
    }
  });

  const status = (provided?: TrustedWorldBinding): Promise<ActionReceipt | undefined> => runSerialized(async () => {
    const host = await resolveHost(provided);
    const snapshot = await currentWorld(options, host.binding);
    const row = dbRowByStep(options.ledger, stepKey(host.binding, host.step));
    if (row === undefined) return undefined;
    const request = decodeRequest(row.requestJson);
    if (visibleExecutionForReceipt(snapshot, host.binding, row, request) !== undefined) {
      return receiptWithRequest(reconcileRow(options.ledger, row, snapshot));
    }
    currentGrantForStoredRequest(snapshot, host.binding, request, options.now?.() ?? Timestamp.now(), false);
    return receiptWithRequest(reconcileRow(options.ledger, row, snapshot));
  });

  const reconcile = (provided?: TrustedWorldBinding): Promise<readonly ActionReceipt[]> => runSerialized(async () => {
    const host = await resolveHost(provided);
    const snapshot = await currentWorld(options, host.binding);
    const rows = dbRowsForScope(options.ledger, host.binding);
    const results: ActionReceipt[] = [];
    for (const row of rows) {
      if (TERMINAL_STATUSES.has(row.status as ActionReceiptStatus)) continue;
      const request = decodeRequest(row.requestJson);
      if (visibleExecutionForReceipt(snapshot, host.binding, row, request) === undefined) {
        // Reconciliation itself is read-only. It may settle a visible row
        // after revocation; without a visible row, current mutation authority
        // is only relevant if a later retry wants to resend this request.
        // Keep an unknown delivery unknown and never allocate a replacement.
      }
      results.push(receiptWithRequest(reconcileRow(options.ledger, row, snapshot)));
    }
    return results;
  });

  return { propose, status, reconcile };
}
