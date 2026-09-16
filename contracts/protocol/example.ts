/** Illustrative fixture, not a live robot trace. No IO or motion occurs here.
 * Regions are rendered on the architecture page and checked against protocol.ts.
 */
import type {
  ActionDefinition, ActionRequest, Affordance, ApproachOutput, Association, Change,
  ControlAdmission, ControlReport, Entity, Execution, FrameRef, NewEvent,
  Observation, PackageRef, WorldDelta, WorldSnapshot,
} from "./protocol.js";

// region example-setup
export const perception: PackageRef = {
  name: "perception.rgb-lidar", version: "1.2.0", sha256: "a".repeat(64),
}; // illustrative immutable package pin, not a hash of a published build
export const executor: PackageRef = {
  name: "go2.approach", version: "1.0.0", sha256: "b".repeat(64),
};
export const host: PackageRef = {
  name: "nemeia.host", version: "1.0.0", sha256: "c".repeat(64),
}; // illustrative host build; completion events are host-produced, not executor-authored
export const approach: ActionDefinition = {
  action: { name: "robot.approach", version: 1 },
  description: "Approach a tracked target to a measured standoff distance.",
  input: { name: "robot.approach.input", version: 1 },
  output: { name: "robot.approach.output", version: 1 },
  actor: [{ component: "core.pose", maxAgeMs: 200 }, { component: "core.connection" }],
  target: { kind: "required", components: [{ component: "core.geometry", maxAgeMs: 500 }] },
}; // actual dispatch also checks connection, path, policy, and input against the installed implementation
export const robot: Entity = {
  id: "robot_go2_01", label: "Go2", components: {
    "core.connection": { version: 1, value: { state: "online" } },
    "core.pose": {
      version: 1, value: { frameId: "map", pose: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } },
      evidence: { observedAt: "2026-09-15T12:00:00.000Z", observationIds: ["obs_robot_pose_01"] },
    },
  },
}; // initial robot evidence already exists in the fixture's journal
export const initial: WorldSnapshot = {
  worldId: "world_lab", cursor: "c_40", entities: [robot], relationships: [], actions: [approach],
}; // cursors and IDs are readable placeholders, not values to parse
// endregion

// region example-observation
export const camera: FrameRef = {
  streamId: "go2.front.camera", sessionId: "sensor_session_01", sequence: 2048,
  capturedAt: "2026-09-15T12:00:00.000Z",
}; // transient frame identity, not an artifact or promise of stored bytes
export const lidar: FrameRef = {
  streamId: "go2.lidar", sessionId: "sensor_session_01", sequence: 991,
  capturedAt: "2026-09-15T12:00:00.000Z",
};
export const observation = {
  id: "obs_backpack_01", trackId: "track_27", inputs: [camera, lidar],
  retained: [], supersedes: [], transforms: [], // this fixture supplies geometry already in map
  semantic: {
    observedAt: camera.capturedAt,
    value: { hypotheses: [{ label: "backpack", score: 0.94 }] },
  },
  geometry: {
    observedAt: lidar.capturedAt,
    value: {
      kind: "boundingBox3D", frameId: "map",
      pose: { positionM: [2.4, -0.6, 0.35], orientation: [0, 0, 0, 1] },
      sizeM: [0.4, 0.3, 0.7], // full measured extents; no invented defaults
    },
  },
} satisfies Observation;
// endregion

// region example-event
export const observationEvent: NewEvent = {
  specversion: "1.0", id: "evt_observation_01", source: "urn:nemeia:perception:session-17",
  type: "dev.nemeia.observation.recorded.v1",
  time: "2026-09-15T12:00:00.020Z", datacontenttype: "application/json",
  data: { worldId: initial.worldId, producer: perception, causes: [], observation },
}; // CloudEvents envelope; source is checked against the authenticated producer
export const recordedObservation = {
  cursor: "c_41", recordedAt: "2026-09-15T12:00:00.030Z", event: observationEvent,
}; // journal receipt time does not overwrite the capturedAt/observedAt values
// endregion

// region example-world
export const backpack: Entity = {
  id: "entity_backpack_01", label: "Backpack", // association allocates identity, not label normalization
  components: {
    "core.semantic": {
      version: 1, value: observation.semantic.value,
      evidence: { observedAt: observation.semantic.observedAt, observationIds: [observation.id] },
    },
    "core.geometry": {
      version: 1, value: observation.geometry.value,
      evidence: { observedAt: observation.geometry.observedAt, observationIds: [observation.id] },
    },
  },
};
export const changes: Change[] = [
  { op: "entity.put", entity: backpack },
  { op: "relationship.put", relationship: {
    subjectId: robot.id, predicate: "observes", objectId: backpack.id,
    evidence: { observedAt: lidar.capturedAt, observationIds: [observation.id] },
  } },
]; // trusted projector commits the entire batch against c_41
export const delta: WorldDelta = { from: "c_41", to: "c_42", changes };
export const associations: Association[] = [{ observationId: observation.id, entityId: backpack.id }];
// world.changed records changes + associations together; replay rebuilds source/track bindings from those facts.
export const snapshot: WorldSnapshot = {
  ...initial, cursor: delta.to, entities: [robot, backpack],
  relationships: [{ subjectId: robot.id, predicate: "observes", objectId: backpack.id,
    evidence: { observedAt: lidar.capturedAt, observationIds: [observation.id] } }],
}; // scene and RobotWorldView read this same object, not a second entity registry
// endregion

// region example-dispatch
export const affordance: Affordance = {
  action: approach.action, actorId: robot.id, targetId: backpack.id,
  evaluatedAt: "2026-09-15T12:00:00.080Z", cursor: snapshot.cursor,
  availability: { available: true },
}; // discovery hint; no authority to send motion
export const request: ActionRequest = {
  requestId: "req_approach_01", action: approach.action,
  actorId: robot.id, targetId: backpack.id, input: { standoffM: 0.8 },
  expectedCursor: snapshot.cursor,
}; // client submits identity + intent; host supplies authentication and checks current evidence
export const accepted: Execution = {
  id: "exec_approach_01", request, executor, mode: "physical",
  binding: [{ entityId: backpack.id, component: "core.geometry", version: 1 },
    { entityId: robot.id, component: "core.pose", version: 1 }],
  createdAt: "2026-09-15T12:00:00.100Z", state: "accepted",
}; // accepted event and original request receipt commit together before executor starts
// endregion

// region example-control
export const admission: ControlAdmission = {
  executionId: accepted.id, robotId: robot.id, executor,
  limits: { maxLinearMps: 0.25, maxYawRadps: 0.4, watchdogMs: 250, maxDurationMs: 15_000 },
}; // local host policy supplies these bounds; the client cannot choose them
export const running: Execution = { ...accepted, state: "running" };
export const sent: ControlReport = {
  kind: "sent", sessionId: "control_01", sequence: 1,
  requested: { vxMps: 0.3, vyMps: 0, yawRadps: 0 },
  sent: { vxMps: 0.25, vyMps: 0, yawRadps: 0 }, confirmation: "sent",
}; // report after gate/driver dispatch; not proof of motion or completion
// Further commands and fresh observations continue; a missing command triggers the local watchdog.
// A remote deployment transports a JOSE grant; local execution does not need a signed envelope.
// endregion

// region example-completion
export const finalObservation: Observation = {
  ...observation, id: "obs_backpack_final",
  inputs: [{ ...camera, sequence: 2480, capturedAt: "2026-09-15T12:00:10.800Z" },
    { ...lidar, sequence: 1423, capturedAt: "2026-09-15T12:00:10.800Z" }],
  geometry: { ...observation.geometry, observedAt: "2026-09-15T12:00:10.800Z" },
}; // target is still at its measured map location; current robot pose arrives as separate evidence
export const finalPose: Entity = {
  ...robot, components: { ...robot.components, "core.pose": {
    version: 2, value: { frameId: "map", pose: {
      positionM: [1.6, -0.6, 0], orientation: [0, 0, 0, 1],
    } }, evidence: { observedAt: "2026-09-15T12:00:10.800Z", observationIds: ["obs_robot_pose_final"] },
  } },
}; // illustrative measured ground-plane distance to target center is 0.8 m
export const closed: ControlReport = {
  kind: "closed", sessionId: "control_01", cause: "finished", safeState: "confirmed",
}; // this fixture assumes the driver supplied confirming evidence
export const output: ApproachOutput = { distanceM: 0.8, observationId: finalObservation.id };
export const succeeded: Execution = {
  ...accepted, state: "succeeded", finishedAt: "2026-09-15T12:00:11.000Z", output,
}; // host verifies result schema, fresh target/robot evidence, and closed control session
// endregion

// region example-resume
export const completionEvent: NewEvent = {
  specversion: "1.0", id: "evt_execution_done", source: "urn:nemeia:host:lab",
  type: "dev.nemeia.execution.changed.v1", time: succeeded.finishedAt,
  datacontenttype: "application/json",
  data: { worldId: initial.worldId, producer: host,
    causes: ["evt_control_closed", "evt_final_world"], execution: succeeded },
}; // intermediate observation/world/control events are omitted from this compact fixture
// events({after: snapshot.cursor, limit: 100}, authenticatedContext) resumes after c_42.
// UI, attention and replay consume the same committed events; replay never dispatches commands.
// Repeating requestId req_approach_01 returns its original accepted receipt, not new motion.
// execution(exec_approach_01, authenticatedContext) returns the current succeeded state.
// endregion
