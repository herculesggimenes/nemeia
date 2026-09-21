import { schema, table, t } from "spacetimedb/server";
import { AwarenessPolicy, ReadScope } from "./agents.ts";
import { MissionEvidence, MissionSpec, MissionState, MissionOutcome } from "./missions.ts";
import {
  ActionBindingPolicy,
  ActionIntent,
  ExecutionResult,
  ExecutionSafetyProof,
  ExecutionState,
  Geometry,
  Mode,
  ObservationInput,
  PackagePin,
  Pose3,
  Role,
  Semantic,
  ResourceRef,
} from "./values.ts";

export const worldConfig = table({ name: "world_config", public: false }, {
  id: t.u8().primaryKey(),
  worldId: t.string().unique(),
  clockErrorBoundMs: t.u32(),
  mode: Mode,
  awarenessPolicy: AwarenessPolicy,
});

export const member = table({ name: "member", public: false }, {
  identity: t.identity().primaryKey(),
  role: Role,
  unitId: t.option(t.string()),
  producerSession: t.option(t.string()),
  package: t.option(PackagePin),
});

export const entity = table({ name: "entity", public: false }, {
  id: t.string().primaryKey(),
  displayName: t.string(),
  kind: t.string(),
  createdAt: t.timestamp(),
  removedAt: t.option(t.timestamp()),
});

export const pose = table({
  name: "pose",
  public: false,
  indexes: [{ accessor: "byEntityFrame", algorithm: "btree", columns: ["entityId", "frameId"] as const }],
}, {
  key: t.string().primaryKey(),
  entityId: t.string().index("btree"),
  frameId: t.string().index("btree"),
  value: Pose3,
  observedAt: t.timestamp(),
  observationId: t.string(),
  version: t.u64(),
});

export const geometry = table({
  name: "geometry",
  public: false,
  indexes: [{ accessor: "byEntityFrame", algorithm: "btree", columns: ["entityId", "frameId"] as const }],
}, {
  key: t.string().primaryKey(),
  entityId: t.string().index("btree"),
  frameId: t.string().index("btree"),
  value: Geometry,
  observedAt: t.timestamp(),
  observationId: t.string(),
  version: t.u64(),
});

export const semantic = table({
  name: "semantic",
  public: false,
}, {
  entityId: t.string().primaryKey(),
  frameId: t.option(t.string()),
  value: Semantic,
  observedAt: t.timestamp(),
  observationId: t.string(),
  version: t.u64(),
});

export const relation = table({ name: "relation", public: false }, {
  key: t.string().primaryKey(),
  subjectId: t.string().index("btree"),
  predicate: t.string(),
  objectId: t.string().index("btree"),
  observationId: t.option(t.string()),
});

export const observation = table({ name: "observation", public: false }, {
  sequence: t.u64().primaryKey().autoInc(),
  id: t.string().unique(),
  producer: t.identity().index("btree"),
  package: PackagePin,
  unitId: t.string().index("btree"),
  entityId: t.string().index("btree"),
  input: ObservationInput,
  inputFingerprint: t.string(),
  recordedAt: t.timestamp(),
});

export const track = table({ name: "track", public: false }, {
  key: t.string().primaryKey(),
  producer: t.identity().index("btree"),
  producerSession: t.string(),
  trackId: t.string(),
  entityId: t.string().index("btree"),
  lastObservationId: t.string(),
});

export const actionBinding = table({ name: "action_binding", public: false }, {
  key: t.string().primaryKey(),
  unitId: t.string().index("btree"),
  actionName: t.string(),
  version: t.u64(),
  policy: ActionBindingPolicy,
});

export const unitControl = table({ name: "unit_control", public: false }, {
  unitId: t.string().primaryKey(),
  controller: t.identity(),
  epoch: t.u64(),
  activeExecutionId: t.option(t.string()),
  stopLatched: t.bool(),
  safeStateConfirmed: t.bool(),
  observedAt: t.timestamp(),
});

export const mission = table({ name: "mission", public: false }, {
  id: t.string().primaryKey(),
  owner: t.identity().index("btree"),
  spec: MissionSpec,
  state: MissionState,
  revision: t.u64(),
  closingOutcome: t.option(MissionOutcome),
  feedbackSequence: t.option(t.u64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
});

export const missionObjectiveProgress = table({ name: "mission_objective_progress", public: false }, {
  key: t.string().primaryKey(),
  missionId: t.string().index("btree"),
  objectiveId: t.string(),
  evidence: MissionEvidence,
  recordedAt: t.timestamp(),
});

export const agent = table({ name: "agent", public: false }, {
  id: t.string().primaryKey(),
  principal: t.identity().unique(),
  displayName: t.string(),
  readScope: ReadScope,
  paused: t.bool(),
  revision: t.u64(),
});

export const missionAgent = table({ name: "mission_agent", public: false }, {
  key: t.string().primaryKey(),
  missionId: t.string().index("btree"),
  agentId: t.string().index("btree"),
  active: t.bool(),
});

export const unitAssignment = table({
  name: "unit_assignment",
  public: false,
  indexes: [{ accessor: "byAgent", algorithm: "btree", columns: ["agentId"] as const }],
}, {
  unitId: t.string().primaryKey(),
  agentId: t.option(t.string()),
  revision: t.u64(),
  actionNames: t.array(t.string()),
  expiresAt: t.option(t.timestamp()),
  updatedAt: t.timestamp(),
});

export const agentMessage = table({ name: "agent_message", public: false }, {
  id: t.string().primaryKey(),
  missionId: t.string().index("btree"),
  fromAgentId: t.string().index("btree"),
  toAgentId: t.string().index("btree"),
  content: t.string(),
  createdAt: t.timestamp(),
});

export const execution = table({
  name: "execution",
  public: false,
  indexes: [
    { accessor: "byMission", algorithm: "btree", columns: ["missionId"] as const },
    { accessor: "byReceipt", algorithm: "btree", columns: ["receiptId"] as const },
  ],
}, {
  id: t.string().primaryKey(),
  requestedBy: t.identity().index("btree"),
  agentId: t.option(t.string()),
  unitId: t.string().index("btree"),
  missionId: t.option(t.string()),
  objectiveId: t.option(t.string()),
  missionRevision: t.option(t.u64()),
  assignmentRevision: t.option(t.u64()),
  requestFingerprint: t.string(),
  acceptBy: t.timestamp(),
  input: ActionIntent,
  binding: ActionBindingPolicy,
  bindingVersion: t.u64(),
  targetVersion: t.u64(),
  claimedAt: t.option(t.timestamp()),
  targetFrameId: t.option(t.string()),
  targetBasisObservationId: t.option(t.string()),
  state: ExecutionState,
  controller: t.option(t.identity()),
  controllerEpoch: t.option(t.u64()),
  createdAt: t.timestamp(),
  updatedAt: t.timestamp(),
  result: t.option(ExecutionResult),
  receiptId: t.option(t.string()),
  safeStateProof: t.option(ExecutionSafetyProof),
});

export const worldEvent = table({ name: "world_event", public: false }, {
  sequence: t.u64().primaryKey().autoInc(),
  id: t.string().unique(),
  kind: t.string(),
  subjectId: t.string().index("btree"),
  principal: t.identity(),
  recordedAt: t.timestamp(),
  detail: t.string(),
});

export const spatialFrame = table({ name: "spatial_frame", public: false }, {
  id: t.string().primaryKey(),
  unitId: t.string().index("btree"),
  sourceSession: t.string(),
  originEpoch: t.u64(),
  parentFrameId: t.option(t.string()),
  createdAt: t.timestamp(),
});

export const localMap = table({ name: "local_map", public: false }, {
  id: t.string().primaryKey(),
  unitId: t.string().index("btree"),
  rootFrameId: t.string().index("btree"),
  headRevision: t.option(t.u64()),
  updatedAt: t.timestamp(),
});

export const mapRevision = table({ name: "map_revision", public: false }, {
  key: t.string().primaryKey(),
  mapId: t.string().index("btree"),
  revision: t.u64(),
  rootFrameId: t.string().index("btree"),
  parentRevision: t.option(t.u64()),
  manifest: ResourceRef,
  evidenceIndex: ResourceRef,
  estimatorState: t.option(ResourceRef),
  inputObservationIds: t.array(t.string()),
  manifestDigest: t.string().unique(),
  requestFingerprint: t.string(),
  recordedAt: t.timestamp(),
});

export const db = schema({
  worldConfig,
  member,
  entity,
  pose,
  geometry,
  semantic,
  relation,
  observation,
  track,
  actionBinding,
  unitControl,
  mission,
  missionObjectiveProgress,
  agent,
  missionAgent,
  unitAssignment,
  agentMessage,
  execution,
  worldEvent,
  spatialFrame,
  localMap,
  mapRevision,
});

export type WorldDb = typeof db;
