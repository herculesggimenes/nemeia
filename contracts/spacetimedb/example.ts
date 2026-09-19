import { Identity, Timestamp } from "spacetimedb";
import type { Row, LocalReceipt } from "./contracts.ts";
import type { ObservationInput, ApproachRequest, Completion } from "./values.ts";
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const operator = Identity.fromString("1".repeat(64));
const controller = Identity.fromString("2".repeat(64));
// Static fixtures only. Readable ID aliases stand in for production UUIDs. No network or robot IO.

// region inputs
export const camera = {
  streamId: "go2/camera", sessionId: "camera-session-1", sequence: 2048n,
  capturedAt: at("2026-09-19T12:00:00.010Z"), // image acquisition, not YOLOE/SAM3 completion
};
export const lidar = {
  streamId: "go2/lidar", sessionId: "lidar-session-1", sequence: 991n,
  capturedAt: at("2026-09-19T12:00:00.020Z"), // independently timed depth evidence
};
export const input: ObservationInput = {
  id: "observation-1", producerSession: "fusion-session-1", trackId: "track-7",
  entityId: undefined, // reducer resolves track association or allocates a new entity
  inputs: [camera, lidar], retained: [], supersedes: [], transforms: [],
  pose: undefined, // no robot pose update in this object observation
  semantic: {
    observedAt: camera.capturedAt,
    value: { hypotheses: [{ label: "backpack", score: 0.94 }] }, // perception hypothesis, not physical capability
  },
  geometry: {
    observedAt: lidar.capturedAt,
    value: { tag: "boundingBox3D", value: {
      frameId: "map",
      pose: { positionM: { x: 2.4, y: -0.6, z: 0.35 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      sizeM: { x: 0.4, y: 0.3, z: 0.7 }, // measured full extents; neither YOLOE nor SAM3 supplies depth alone
    } },
  },
}; // this fixture assumes already world-aligned evidence; real frame conversion must retain transform samples
// endregion

// region projection
export const backpack: Row<"entity"> = {
  id: "backpack-A", displayName: "Backpack candidate", kind: "object",
  createdAt: at("2026-09-19T12:00:00.040Z"), removedAt: undefined,
};
export const geometryRow: Row<"geometry"> = {
  entityId: backpack.id, value: input.geometry!.value,
  observedAt: input.geometry!.observedAt, observationId: input.id, version: 1n,
};
export const semanticRow: Row<"semantic"> = {
  entityId: backpack.id, value: input.semantic!.value,
  observedAt: input.semantic!.observedAt, observationId: input.id, version: 1n,
};
// ingest_observation commits observation + entity/track + supplied components + world_event atomically.
// Geometry-only updates leave semantic untouched; late labels never refresh geometry time.
// Authorized SDK subscriptions apply matching row changes together; no handwritten WorldDelta.
// endregion

// region mission
export const activeMission: Row<"mission"> = {
  id: "mission-1", owner: operator, // durable domain identity, independent of the decision client
  spec: {
    goal: "Approach the selected backpack", template: undefined, actorIds: ["go2-01"],
    objectives: [{ id: "approach", description: "Reach the measured standoff", dependsOn: [], optional: false,
      criterion: { tag: "approached", value: { actorId: "go2-01", targetId: backpack.id, standoffM: 0.8 } } }],
    maxLinearMps: 0.25, maxRunMs: 15_000, deadlineAt: at("2026-09-19T12:01:00.000Z"),
  }, // bind the target and authorize this specification before activating the mission
  state: { tag: "active" }, revision: 1n, closingOutcome: undefined,
  createdAt: at("2026-09-19T12:00:00.050Z"), updatedAt: at("2026-09-19T12:00:00.050Z"),
}; // typed fixture; createMission would commit mission + audit, not start the robot
// endregion

// region subscribed
export const subscribedClient = {
  clientId: "operator-agent-1", // logical consumer, independent from the UI or another worker
  missionId: activeMission.id, // follow mission lifecycle and objective credits, not a private goal string
  interests: ["mission and credits", "actor state", "candidate objects and evidence", "relevant relationships", "action bindings", "own executions"], // task scope through authorized views, not executable queries
  ready: true, // fixture assumes the required subscriptions have applied
  changedEntityIds: [backpack.id], // coalesced state changes; do not queue every perception update
  eventIds: ["task-message-1"], // separately delivered user instruction; retained until handled
  wakeReason: "task-message", // scheduling policy chooses a step; row delivery alone does not
} as const; // illustrative client state, not a new wire format or world table
// Other clients keep their own interests, inboxes and progress over the same world.
// endregion

// region prepared
export const preparedStep = {
  id: "step-1", clientId: subscribedClient.clientId, // one active reasoning step for this logical client
  contextId: "decision-context-1", // immutable context retained by the worker; shared with the decision below
  missionId: activeMission.id, missionRevision: activeMission.revision, // freeze the mission pin as well as evidence versions
  eventIds: [...subscribedClient.eventIds], // reserve this exact batch; later arrivals remain pending
  changedEntityIds: [...subscribedClient.changedEntityIds], // detach the coalesced changes for this step
  evidenceVersions: { geometry: geometryRow.version, semantic: semanticRow.version }, // detach latest committed relevant values
  inputs: ["authorized mission and ready objectives", "current world projection", "pending events", "relevant history"], // context recipe, not a provider prompt
} as const; // lifecycle summary, not a full PreparedStep or an implemented persistent inbox
// Subscriptions keep updating the client's read cache while inference runs; this input stays frozen.
// The outcome and progress are persisted before task-message-1 is acknowledged.
// Failed or superseded attempts retain unhandled events; they must not issue a late action.
// endregion

// region decision
export const decisionStage = {
  contextId: preparedStep.contextId, // exact context selected before inference starts
  missionId: activeMission.id, goal: activeMission.spec.goal, // intent comes from the accepted mission
  objectiveId: "approach", // focus this decision on one currently ready objective
  candidates: [{ key: "candidateA", entityId: backpack.id, semanticVersion: 1n, geometryVersion: 1n }],
  provider: "typesafe", // can be replaced by an LLM or rules without changing the execution protocol
  model: "jev-1.13.0", questionVersion: "target-match@1", // qualified, pinned definitions
  selectedEntityId: backpack.id, // illustrative choice, not an actual API response
};
// The worker converts bigint/Timestamp into its JSON projection and asks one bounded Choice question.
// Candidate keys also include none. On timeout, ambiguity or stale context, it abstains.
// A confidence value alone never grants permission; current requirements are checked in request_approach.
// endregion

// region accepted
export const request: ApproachRequest = {
  executionId: "execution-1", // same ID on every retry; execution row is the receipt
  actorId: "go2-01", targetId: backpack.id, standoffM: 0.8,
  expectedGeometryVersion: 1n, acceptBy: at("2026-09-19T12:00:01.000Z"),
  mission: { missionId: activeMission.id, objectiveId: "approach", expectedRevision: activeMission.revision }, // pin active mission and ready objective
};
export const binding: Row<"actionBinding"> = {
  actorId: request.actorId, version: 1n,
  executor: { name: "go2-approach", version: "1.0.0", sha256: "a".repeat(64) },
  mode: { tag: "physical" }, maxEvidenceAgeMs: 500,
  maxLinearMps: 0.25, maxRunMs: 15_000, toleranceM: 0.05, // illustrative policy, not qualified hardware limits
};
export const accepted: Row<"execution"> = {
  id: request.executionId, requestedBy: operator, actorId: request.actorId, missionId: activeMission.id,
  input: request, binding, targetGeometryVersion: geometryRow.version,
  state: { tag: "accepted" }, controller: undefined, controllerEpoch: undefined,
  createdAt: at("2026-09-19T12:00:00.150Z"), updatedAt: at("2026-09-19T12:00:00.150Z"), result: undefined,
}; // transaction inserts execution + execution.accepted audit row; no motion occurs inside it
// endregion

// region claimed
export const running: Row<"execution"> = {
  ...accepted, state: { tag: "running" }, controller, controllerEpoch: 4n,
  updatedAt: at("2026-09-19T12:00:00.180Z"),
};
export const reservedRobot: Row<"robotControl"> = {
  actorId: request.actorId, controller, epoch: 4n, activeExecutionId: request.executionId,
  stopLatched: false, safeStateConfirmed: true, observedAt: at("2026-09-19T12:00:00.170Z"),
};
// claim_execution checks actor ownership, epoch, fresh evidence, target pin and no active physical attempt.
// The execution transition, robot reservation and audit row commit together.
// The worker waits for confirmed state, reconciles its local receipt, then starts at most one attempt.
// endregion

// region local
export const localStarted: LocalReceipt = {
  id: "local-receipt-1", executionId: running.id, controllerEpoch: 4n,
  outcome: "running", safeState: "unknown", // delivery is not success or confirmation of physical state
};
// The controller persists admission before actuator IO and rejects changed duplicate requests.
// Navigation performs bounded motion; a local monotonic watchdog enforces the duration and health policy.
// If acknowledgement is lost, reconcile this receipt. Never allocate a fresh execution to hide uncertainty.
// Neither SpacetimeDB, Typesafe nor an LLM participates in each motor-control tick.
// endregion

// region measurements
export const finalActor: Row<"pose"> = {
  entityId: request.actorId, frameId: "map", version: 24n, observationId: "observation-actor-24",
  observedAt: at("2026-09-19T12:00:08.000Z"),
  value: { positionM: { x: 1.6, y: -0.6, z: 0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
};
export const finalTarget: Row<"geometry"> = {
  ...geometryRow, version: 2n, observationId: "observation-target-2",
  observedAt: at("2026-09-19T12:00:08.010Z"), // renewed measurement, same target location
};
export const localClosed: LocalReceipt = {
  ...localStarted, outcome: "succeeded", safeState: "confirmed",
};
export const completion: Completion = { tag: "succeeded", value: {
  distanceM: 0.8, actorObservationId: finalActor.observationId,
  targetObservationId: finalTarget.observationId, localReceiptId: localClosed.id,
} }; // ground-plane distance measured from final poses; not a copy of the requested goal
// endregion

// region finished
export const succeeded: Row<"execution"> = {
  ...running, state: { tag: "succeeded" }, result: completion,
  updatedAt: at("2026-09-19T12:00:08.050Z"),
};
// finish_execution checks authenticated controller/epoch, final evidence, pinned policy and safe closure.
// If cancellation committed first, success is rejected; the worker reports cancellation or failure instead.
// Terminal state + robot release + execution.finished audit row commit together.
// UI sees the new rows through subscriptions. Reconnect reads this terminal receipt and does not redispatch.
// endregion

// region mission-finished
export const approachCredit: Row<"missionCredit"> = {
  key: JSON.stringify([activeMission.id, "approach"]), // one immutable credit for this milestone, even after redelivery
  missionId: activeMission.id, objectiveId: "approach",
  evidence: { tag: "execution", value: { executionId: succeeded.id } }, // load and validate the durable measured receipt
  recordedAt: at("2026-09-19T12:00:08.060Z"),
};
export const closingMission: Row<"mission"> = {
  ...activeMission, state: { tag: "closing" }, closingOutcome: { tag: "succeeded" },
  revision: 2n, updatedAt: approachCredit.recordedAt,
}; // all required milestones credited; new action admission is now blocked
export const completedMission: Row<"mission"> = {
  ...closingMission, state: { tag: "succeeded" }, closingOutcome: undefined,
  revision: 3n, updatedAt: at("2026-09-19T12:00:08.070Z"),
}; // only after every linked attempt is safely closed; this fixture has one confirmed local receipt
// Mission credit, lifecycle and audit are authoritative; subscribers render them without writing progress.
// endregion
