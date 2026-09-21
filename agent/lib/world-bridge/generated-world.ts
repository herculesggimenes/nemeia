import { WorldAuthorizationError } from "./authz.ts";
import { canonicalJson } from "../../../world-client/src/json.ts";
import type {
  CurrentWorldSnapshot,
  ReadEventHistoryArgs,
  ReadGeometryDetailArgs,
  ReadMapHistoryArgs,
  ReadObservationDetailArgs,
  ReadObservationHistoryArgs,
  ReadSpatialFrameDetailArgs,
  RelevantActionBindingRow,
  RelevantAgentRow,
  RelevantExecutionRow,
  RelevantMissionObjectiveProgressRow,
  RelevantUnitAssignmentRow,
  RelevantUnitControlRow,
  WorldClient,
} from "../../../world-client/src/index.ts";
import type { ResourceReferenceJson } from "../../../world-client/src/json.ts";
import type {
  JsonValue,
  MissionLogEntry,
  ResourceRef,
  WorldPrincipal,
  WorldReadPort,
  WorldDetailOperation,
  WorldDetailRequest,
  WorldDetailResult,
  WorldReadRequest,
  WorldViewProjection,
} from "./types.ts";

// Re-exporting this type keeps host composition on the generated client
// contract while ensuring it is erased from the runtime module graph.  The
// host must be loadable in an unconfigured Eve process without importing the
// generated SDK's extensionless runtime barrel.
export type { CurrentWorldSnapshot } from "../../../world-client/src/index.ts";

/** The native generated resource shape; JSON conversion remains world-client's concern. */
export type GeneratedResourceRef = ResourceRef;
export type GeneratedResourceReferenceJson = ResourceReferenceJson;

/** A real world-client or a deterministic test double over its public snapshot API. */
export type GeneratedWorldClient = Pick<WorldClient, "snapshot">
  & Partial<Pick<WorldClient, "readEventHistory" | "readGeometryDetail" | "readMapHistory" | "readObservationDetail" | "readObservationHistory" | "readSpatialFrameDetail">>;

export interface GeneratedWorldAttention {
  readonly generation: number;
  readonly sourceIds: readonly string[];
  readonly dirtyKeys: readonly string[];
  readonly mustHandleIds: readonly string[];
  readonly rescanRequired: boolean;
}

/** A durable public-channel delivery payload. The id is allocated by the WAL ledger. */
export interface GeneratedWorldWake extends GeneratedWorldAttention {
  readonly wakeId: string;
}

export interface GeneratedWorldReadPortOptions {
  readonly client: GeneratedWorldClient;
  /** The authoritative revision associated with the subscribed snapshot. */
  readonly snapshotRevision: (snapshot: CurrentWorldSnapshot) => string;
  /** Must validate the current Eve principal on every read. */
  readonly authorizeCurrentPrincipal: (request: WorldReadRequest | WorldDetailRequest) => void | Promise<void>;
  /** Durable coalescer/ledger state; never synthesize empty attention fields. */
  readonly attention: () => GeneratedWorldAttention;
  readonly acknowledgeAttention?: (generation: number) => void | Promise<void>;
  readonly maxMissions?: number;
  readonly maxRows?: number;
}

const DEFAULT_MAX_MISSIONS = 64;
const DEFAULT_MAX_ROWS = 256;

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
    throw new RangeError("generated world adapter limit is outside its bounded range");
  }
  return value;
}

function requireBoundedId(value: string, label: string): string {
  if (value.length === 0 || value.length > 512) throw new Error(`${label} is not bounded`);
  return value;
}

function boundedText(value: string, maxLength = 4096): { readonly value: string; readonly truncated: boolean } {
  if (value.length > maxLength) return { value: value.slice(0, maxLength), truncated: true };
  return { value, truncated: false };
}

function enumTag(value: unknown, label: string): string {
  if (value === null || typeof value !== "object" || !Object.hasOwn(value, "tag")) {
    throw new Error(`${label} is not a generated tagged value`);
  }
  const tag = (value as { readonly tag?: unknown }).tag;
  if (typeof tag !== "string" || tag.length === 0 || tag.length > 128) {
    throw new Error(`${label} has an invalid generated tag`);
  }
  return tag;
}

function timestamp(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && typeof (value as { toISOString?: unknown }).toISOString === "function") {
    const result = (value as { toISOString: () => unknown }).toISOString();
    if (typeof result === "string") return result;
  }
  throw new Error(`${label} is not a generated timestamp`);
}

/** Generated enums, timestamps, identities, u64 values, and ResourceRefs cross one JSON codec. */
function jsonValue(value: unknown): JsonValue {
  return JSON.parse(canonicalJson(value)) as JsonValue;
}

function boundedStrings(values: readonly string[], label: string, limit: number): string[] {
  return values.slice(0, limit).map((value) => requireBoundedId(value, label));
}

function attentionValue(value: GeneratedWorldAttention, limit: number): GeneratedWorldAttention {
  if (!Number.isSafeInteger(value.generation) || value.generation < 0) throw new RangeError("invalid world attention generation");
  return {
    generation: value.generation,
    sourceIds: boundedStrings(value.sourceIds, "attention source id", limit),
    dirtyKeys: boundedStrings(value.dirtyKeys, "dirty key", limit),
    mustHandleIds: boundedStrings(value.mustHandleIds, "must-handle id", limit),
    rescanRequired: value.rescanRequired,
  };
}

function boundedIds(values: readonly string[], limit: number): string[] {
  return values.slice(0, limit).map((value) => requireBoundedId(value, "generated id"));
}

function activeMissionIds(snapshot: CurrentWorldSnapshot, agentId: string, limit: number): Set<string> {
  return new Set(
    snapshot.relevantMissionAgents
      .filter((row) => row.agentId === agentId && row.active)
      .slice(0, limit)
      .map((row) => requireBoundedId(row.missionId, "mission id")),
  );
}

function missionLifecycle(value: unknown): MissionLogEntry["lifecycle"] {
  const tag = enumTag(value, "mission state");
  switch (tag) {
    case "Active": return "active";
    case "Closing": return "closing";
    case "Succeeded": return "succeeded";
    case "Failed": return "failed";
    case "Cancelled": return "cancelled";
    default: throw new Error(`unsupported generated mission state: ${tag}`);
  }
}

function missionLog(
  snapshot: CurrentWorldSnapshot,
  missionIds: ReadonlySet<string>,
  limit: number,
): MissionLogEntry[] {
  const rows = snapshot.assignedMissions
    .filter((row) => missionIds.has(row.id))
    .slice(0, limit)
    .sort((left, right) => left.id.localeCompare(right.id));
  return rows.map((row) => {
    const objectiveIds = row.spec.objectives.map((objective) => requireBoundedId(objective.id, "objective id"));
    const evidence = new Set(
      snapshot.relevantMissionObjectiveProgress
        .filter((progress) => progress.missionId === row.id)
        .map((progress) => progress.objectiveId),
    );
    const complete = new Set(objectiveIds.filter((objectiveId) => evidence.has(objectiveId)));
    const readyObjectiveIds = objectiveIds.filter((objectiveId) => {
      const objective = row.spec.objectives.find((candidate) => candidate.id === objectiveId);
      return objective !== undefined && !complete.has(objectiveId) && objective.dependsOn.every((dependency) => complete.has(dependency));
    });
    return {
      missionId: requireBoundedId(row.id, "mission id"),
      description: row.spec.description,
      lifecycle: missionLifecycle(row.state),
      objectives: row.spec.objectives.slice(0, limit).map((objective) => {
        const objectiveId = requireBoundedId(objective.id, "objective id");
        const progress = snapshot.relevantMissionObjectiveProgress.find(
          (candidate) => candidate.missionId === row.id && candidate.objectiveId === objectiveId,
        );
        return {
          objectiveId,
          description: objective.description,
          dependsOn: boundedIds(objective.dependsOn, limit),
          optional: objective.optional,
          criterion: jsonValue(objective.criterion),
          ...(progress === undefined ? {} : {
            progressEvidence: jsonValue(progress.evidence),
            recordedAt: timestamp(progress.recordedAt, "objective progress") ?? undefined,
          }),
        };
      }),
      readyObjectiveIds,
      pendingObjectiveIds: objectiveIds.filter((objectiveId) => !complete.has(objectiveId) && !readyObjectiveIds.includes(objectiveId)),
      deadlineAt: timestamp(row.spec.deadlineAt, "mission deadline"),
    } satisfies MissionLogEntry;
  });
}

function rowIds(rows: readonly { readonly id: string }[], limit: number): string[] {
  return boundedIds(rows.map((row) => row.id), limit);
}

function bindingSummary(rows: readonly RelevantActionBindingRow[], limit: number): JsonValue[] {
  return rows.slice(0, limit).map((row) => ({
    key: requireBoundedId(row.key, "action binding key"),
    unitId: requireBoundedId(row.unitId, "unit id"),
    actionName: requireBoundedId(row.actionName, "action name"),
    version: row.version.toString(10),
  }));
}

function agentSummary(rows: readonly RelevantAgentRow[], limit: number): JsonValue[] {
  return rows.slice(0, limit).map((row) => ({
    id: requireBoundedId(row.id, "agent id"),
    displayName: row.displayName,
    paused: row.paused,
    revision: row.revision.toString(10),
  }));
}

function executionSummary(rows: readonly RelevantExecutionRow[], limit: number): JsonValue[] {
  return rows.slice(0, limit).map((row) => ({
    id: requireBoundedId(row.id, "execution id"),
    agentId: row.agentId ?? null,
    unitId: requireBoundedId(row.unitId, "unit id"),
    missionId: row.missionId ?? null,
    objectiveId: row.objectiveId ?? null,
    state: enumTag(row.state, "execution state"),
    receiptId: row.receiptId ?? null,
    updatedAt: timestamp(row.updatedAt, "execution update") ?? null,
  }));
}

function assignmentSummary(rows: readonly RelevantUnitAssignmentRow[], limit: number): JsonValue[] {
  return rows.slice(0, limit).map((row) => ({
    unitId: requireBoundedId(row.unitId, "unit id"),
    agentId: row.agentId ?? null,
    revision: row.revision.toString(10),
    actionNames: boundedIds(row.actionNames, limit),
    expiresAt: timestamp(row.expiresAt, "assignment expiry") ?? null,
  }));
}

function controlSummary(rows: readonly RelevantUnitControlRow[], limit: number): JsonValue[] {
  return rows.slice(0, limit).map((row) => ({
    unitId: requireBoundedId(row.unitId, "unit id"),
    epoch: row.epoch.toString(10),
    activeExecutionId: row.activeExecutionId ?? null,
    stopLatched: row.stopLatched,
    safeStateConfirmed: row.safeStateConfirmed,
    observedAt: timestamp(row.observedAt, "unit control observation") ?? null,
  }));
}

function addressedMessageSummary(snapshot: CurrentWorldSnapshot, limit: number): JsonValue[] {
  return snapshot.addressedMessages.slice(0, limit).map((row) => {
    const content = boundedText(row.content);
    return {
      id: requireBoundedId(row.id, "addressed message id"),
      missionId: requireBoundedId(row.missionId, "addressed message mission id"),
      fromAgentId: requireBoundedId(row.fromAgentId, "addressed message sender"),
      toAgentId: requireBoundedId(row.toAgentId, "addressed message recipient"),
      content: content.value,
      contentTruncated: content.truncated,
      createdAt: timestamp(row.createdAt, "addressed message timestamp") ?? null,
    };
  });
}

function localMapSummary(snapshot: CurrentWorldSnapshot, limit: number): JsonValue[] {
  return snapshot.relevantLocalMaps.slice(0, limit).map((row) => ({
    id: requireBoundedId(row.id, "local map id"),
    unitId: requireBoundedId(row.unitId, "map unit id"),
    rootFrameId: requireBoundedId(row.rootFrameId, "map root frame id"),
    headRevision: row.headRevision === undefined ? null : row.headRevision.toString(10),
    updatedAt: timestamp(row.updatedAt, "local map update") ?? null,
  }));
}

function objectSummary(snapshot: CurrentWorldSnapshot, limit: number): JsonValue[] {
  return snapshot.relevantEntities.slice(0, limit).map((entity) => {
    const geometry = snapshot.relevantGeometry.filter((row) => row.entityId === entity.id).slice(0, limit);
    const semantic = snapshot.relevantSemantic.filter((row) => row.entityId === entity.id).slice(0, limit);
    const poses = snapshot.relevantPoses.filter((row) => row.entityId === entity.id).slice(0, limit);
    const supportObservationIds = [...new Set([
      ...geometry.map((row) => row.observationId),
      ...semantic.map((row) => row.observationId),
      ...poses.map((row) => row.observationId),
    ])].map((value) => requireBoundedId(value, "support observation id"));
    const hasDepthGeometry = geometry.some((row) => enumTag(row.value, "geometry value") !== "BoundingBox2D");
    return {
      id: requireBoundedId(entity.id, "entity id"),
      displayName: entity.displayName,
      kind: entity.kind,
      geometry: geometry.map((row) => ({
        key: requireBoundedId(row.key, "geometry key"),
        frameId: requireBoundedId(row.frameId, "geometry frame id"),
        observedAt: timestamp(row.observedAt, "geometry observation") ?? null,
        observationId: requireBoundedId(row.observationId, "geometry observation id"),
        version: row.version.toString(10),
        value: jsonValue(row.value),
      })),
      semantic: semantic.map((row) => ({
        frameId: row.frameId ?? null,
        observedAt: timestamp(row.observedAt, "semantic observation") ?? null,
        observationId: requireBoundedId(row.observationId, "semantic observation id"),
        version: row.version.toString(10),
        hypotheses: jsonValue(row.value.hypotheses),
      })),
      poses: poses.map((row) => ({
        key: requireBoundedId(row.key, "pose key"),
        frameId: requireBoundedId(row.frameId, "pose frame id"),
        observedAt: timestamp(row.observedAt, "pose observation") ?? null,
        observationId: requireBoundedId(row.observationId, "pose observation id"),
        version: row.version.toString(10),
        value: jsonValue(row.value),
      })),
      supportObservationIds,
      missingDepth: !hasDepthGeometry,
    } satisfies JsonValue;
  });
}

function unitStateSummary(snapshot: CurrentWorldSnapshot, limit: number): JsonValue[] {
  const unitIds = new Set([
    ...snapshot.relevantUnitAssignments.map((row) => row.unitId),
    ...snapshot.relevantUnitControls.map((row) => row.unitId),
  ]);
  return [...unitIds].slice(0, limit).map((unitId) => ({
    unitId: requireBoundedId(unitId, "unit id"),
    assignment: assignmentSummary(snapshot.relevantUnitAssignments.filter((row) => row.unitId === unitId), 1)[0] ?? null,
    control: controlSummary(snapshot.relevantUnitControls.filter((row) => row.unitId === unitId), 1)[0] ?? null,
    poses: snapshot.relevantPoses
      .filter((row) => row.entityId === unitId)
      .slice(0, limit)
      .map((row) => ({
        frameId: requireBoundedId(row.frameId, "unit pose frame id"),
        observedAt: timestamp(row.observedAt, "unit pose observation") ?? null,
        observationId: requireBoundedId(row.observationId, "unit pose observation id"),
        version: row.version.toString(10),
        value: jsonValue(row.value),
      })),
  }));
}

function acquisitionTimes(snapshot: CurrentWorldSnapshot, limit: number): string[] {
  const values = [
    ...snapshot.relevantGeometry.map((row) => row.observedAt),
    ...snapshot.relevantPoses.map((row) => row.observedAt),
    ...snapshot.relevantSemantic.map((row) => row.observedAt),
    ...snapshot.relevantUnitControls.map((row) => row.observedAt),
  ];
  return [...new Set(values.map((value) => timestamp(value, "authorized feed timestamp")).filter((value): value is string => value !== undefined))]
    .sort()
    .slice(0, limit);
}

function sourceIds(snapshot: CurrentWorldSnapshot): string[] {
  const feeds: Array<readonly unknown[]> = [
    snapshot.addressedMessages,
    snapshot.assignedMissions,
    snapshot.relevantFeedbackWatermarks ?? [],
    snapshot.relevantMissionAgents,
    snapshot.relevantMissionObjectiveProgress,
    snapshot.relevantAgents,
    snapshot.relevantUnitAssignments,
    snapshot.relevantUnitControls,
    snapshot.relevantActionBindings,
    snapshot.relevantExecutions,
    snapshot.relevantEntities,
    snapshot.relevantGeometry,
    snapshot.relevantLocalMaps,
    snapshot.relevantPoses,
    snapshot.relevantSemantic,
  ];
  const names = [
    "world.addressed_messages",
    "world.assigned_missions",
    "world.relevant_feedback_watermarks",
    "world.relevant_mission_agents",
    "world.relevant_mission_objective_progress",
    "world.relevant_agents",
    "world.relevant_unit_assignments",
    "world.relevant_unit_controls",
    "world.relevant_action_bindings",
    "world.relevant_executions",
    "world.relevant_entities",
    "world.relevant_geometry",
    "world.relevant_local_maps",
    "world.relevant_poses",
    "world.relevant_semantic",
  ];
  return names.filter((_name, index) => feeds[index].length > 0);
}

function projectionBytes(projection: WorldViewProjection): number {
  return Buffer.byteLength(canonicalJson(projection), "utf8");
}

function detailU64(value: string | undefined, label: string): bigint {
  if (value === undefined || !/^\d{1,20}$/u.test(value)) throw new Error(`${label} must be a decimal u64 string`);
  const result = BigInt(value);
  if (result > ((1n << 64n) - 1n)) throw new Error(`${label} is outside u64`);
  return result;
}

function detailId(value: string | undefined, label: string): string {
  if (value === undefined) throw new Error(`${label} is required`);
  return requireBoundedId(value, label);
}

export function createGeneratedWorldReadPort(options: GeneratedWorldReadPortOptions): WorldReadPort {
  const maxMissions = boundedLimit(options.maxMissions, DEFAULT_MAX_MISSIONS);
  const maxRows = boundedLimit(options.maxRows, DEFAULT_MAX_ROWS);
  return {
    async readProjection(request): Promise<WorldViewProjection> {
      requireBoundedId(request.worldId, "world id");
      requireBoundedId(request.agentId, "agent id");
      await options.authorizeCurrentPrincipal(request);
      const snapshot = options.client.snapshot();
      const readiness = snapshot.readiness.find((row) => row.worldId === request.worldId);
      if (readiness === undefined || !readiness.authorized || !readiness.synchronized || readiness.role.length === 0) {
        throw new WorldAuthorizationError("authorized world projection is unavailable");
      }
      const missionIds = activeMissionIds(snapshot, request.agentId, maxMissions);
      const missions = missionLog(snapshot, missionIds, maxMissions);
      const worldRevision = requireBoundedId(options.snapshotRevision(snapshot), "world revision");
      const attention = attentionValue(options.attention(), maxRows);
      const summary: Readonly<Record<string, JsonValue>> = {
        worldId: request.worldId,
        agentId: request.agentId,
        worldRevision,
        mode: readiness.mode,
        role: readiness.role,
        synchronized: readiness.synchronized,
        addressedMessages: addressedMessageSummary(snapshot, maxRows),
        agents: agentSummary(snapshot.relevantAgents, maxRows),
        localMaps: localMapSummary(snapshot, maxRows),
        objects: objectSummary(snapshot, maxRows),
        unitState: unitStateSummary(snapshot, maxRows),
        executions: executionSummary(snapshot.relevantExecutions, maxRows),
        actionBindings: bindingSummary(snapshot.relevantActionBindings, maxRows),
        evidence: snapshot.relevantMissionObjectiveProgress
          .filter((row) => missionIds.has(row.missionId))
          .slice(0, maxRows)
          .map((row) => ({
            missionId: requireBoundedId(row.missionId, "mission id"),
            objectiveId: requireBoundedId(row.objectiveId, "objective id"),
            evidence: jsonValue(row.evidence),
            recordedAt: timestamp(row.recordedAt, "objective progress") ?? null,
          })),
      };
      const projection: WorldViewProjection = {
        worldId: request.worldId,
        agentId: request.agentId,
        worldRevision,
        missionLog: missions,
        summary,
        sourceIds: [...new Set([...sourceIds(snapshot), ...attention.sourceIds])],
        dirtyKeys: attention.dirtyKeys,
        mustHandleIds: attention.mustHandleIds,
        rescanRequired: attention.rescanRequired,
        acquisitionTimes: acquisitionTimes(snapshot, maxRows),
        evidence: [],
        attentionGeneration: attention.generation,
      };
      if (projectionBytes(projection) > request.maxBytes) throw new WorldAuthorizationError("world projection exceeds its byte limit");
      return request.operation === "summary" || request.operation === "mission-log"
        ? projection
        : (() => { throw new WorldAuthorizationError("unsupported world read operation"); })();
    },
    async acknowledgeProjection(generation: number): Promise<void> {
      if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError("invalid world attention generation");
      await options.acknowledgeAttention?.(generation);
    },
    async readDetail(request): Promise<WorldDetailResult> {
      requireBoundedId(request.worldId, "world id");
      requireBoundedId(request.agentId, "agent id");
      await options.authorizeCurrentPrincipal(request);
      const snapshot = options.client.snapshot();
      const readiness = snapshot.readiness.find((row) => row.worldId === request.worldId);
      if (readiness === undefined || !readiness.authorized || !readiness.synchronized || readiness.role.length === 0) {
        throw new WorldAuthorizationError("authorized world detail is unavailable");
      }
      const worldRevision = requireBoundedId(options.snapshotRevision(snapshot), "world revision");
      const limit = boundedLimit(request.limit, 32);
      let sourceId: string;
      let value: unknown;
      switch (request.operation satisfies WorldDetailOperation) {
        case "observation-detail": {
          if (options.client.readObservationDetail === undefined) throw new WorldAuthorizationError("observation detail procedure is unavailable");
          const args: ReadObservationDetailArgs = { observationId: detailId(request.observationId, "observation id") };
          value = await options.client.readObservationDetail(args);
          sourceId = "world.procedure.read_observation_detail";
          break;
        }
        case "geometry-detail": {
          if (options.client.readGeometryDetail === undefined) throw new WorldAuthorizationError("geometry detail procedure is unavailable");
          const args: ReadGeometryDetailArgs = { key: detailId(request.key, "geometry key") };
          value = await options.client.readGeometryDetail(args);
          sourceId = "world.procedure.read_geometry_detail";
          break;
        }
        case "map-history": {
          if (options.client.readMapHistory === undefined) throw new WorldAuthorizationError("map history procedure is unavailable");
          const args: ReadMapHistoryArgs = {
            mapId: detailId(request.mapId, "map id"),
            afterRevision: detailU64(request.afterRevision ?? "0", "after revision"),
            limit,
          };
          value = await options.client.readMapHistory(args);
          sourceId = "world.procedure.read_map_history";
          break;
        }
        case "observation-history": {
          if (options.client.readObservationHistory === undefined) throw new WorldAuthorizationError("observation history procedure is unavailable");
          const args: ReadObservationHistoryArgs = {
            afterSequence: detailU64(request.afterSequence ?? "0", "after sequence"),
            limit,
          };
          value = await options.client.readObservationHistory(args);
          sourceId = "world.procedure.read_observation_history";
          break;
        }
        case "event-history": {
          if (options.client.readEventHistory === undefined) throw new WorldAuthorizationError("event history procedure is unavailable");
          const args: ReadEventHistoryArgs = {
            subjectId: detailId(request.subjectId, "event subject id"),
            afterSequence: detailU64(request.afterSequence ?? "0", "after sequence"),
            limit,
          };
          value = await options.client.readEventHistory(args);
          sourceId = "world.procedure.read_event_history";
          break;
        }
        case "spatial-frame-detail": {
          if (options.client.readSpatialFrameDetail === undefined) throw new WorldAuthorizationError("spatial frame detail procedure is unavailable");
          const args: ReadSpatialFrameDetailArgs = { frameId: detailId(request.frameId, "spatial frame id") };
          value = await options.client.readSpatialFrameDetail(args);
          sourceId = "world.procedure.read_spatial_frame_detail";
          break;
        }
      }
      const result: WorldDetailResult = {
        worldId: request.worldId,
        agentId: request.agentId,
        worldRevision,
        sourceId,
        value: jsonValue(value),
      };
      if (Buffer.byteLength(canonicalJson(result), "utf8") > request.maxBytes) {
        throw new WorldAuthorizationError("world detail exceeds its byte limit");
      }
      return result;
    },
  };
}
