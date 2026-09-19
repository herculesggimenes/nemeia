import type { Identity, Timestamp, Infer } from "spacetimedb";
import type * as tables from "./schema.ts";
import type { ApproachRequest, Completion, ObservationInput } from "./values.ts";
import type { MissionSpec, MissionEvidence } from "./missions.ts";

type TableMap = Pick<typeof tables, "worldConfig" | "member" | "entity" | "pose" | "geometry" | "semantic" | "relation" | "observation" | "track" | "actionBinding" | "robotControl" | "mission" | "missionCredit" | "execution" | "worldEvent">;
export type Row<K extends keyof TableMap> = Infer<TableMap[K]["rowType"]>;

// region world-view
export interface WorldView {
  world: Readonly<Row<"worldConfig">>; // identifies this database's world and clock domain
  entities: ReadonlyMap<string, EntityView>; // join only authorized, subscribed component rows
  relationships: readonly Row<"relation">[]; // both endpoints are in this authorized world view
  actions: readonly Row<"actionBinding">[]; // approach@1 bindings, not a second action registry
  executions: readonly Row<"execution">[]; // only attempts this identity is allowed to see
  missions: ReadonlyMap<string, MissionView>; // authorized mission instances and their evidence-backed progress
  synchronized: boolean; // false while disconnected or until the required subscription is applied
} // presentation only: no writable snapshot, manual delta cursor or second authoritative world
export interface EntityView {
  entity: Readonly<Row<"entity">>; // identity and display metadata
  pose?: Readonly<Row<"pose">>; // absence means unknown, never an origin pose
  geometry?: Readonly<Row<"geometry">>; // absence means unknown, never a default box
  semantic?: Readonly<Row<"semantic">>; // classification is independent of geometry
  control?: Readonly<Row<"robotControl">>; // robot-only control projection
}
export interface Affordance {
  actorId: string; targetId: string; // identities for approach@1
  evaluatedAt: Timestamp; // explicit evaluation time; fresh rows still age without database writes
  available: boolean; reasons: readonly string[]; // read-only hint, not an execution grant
} // UI recomputes freshness locally; the reducer repeats all checks authoritatively
// endregion

// region mission-view
export interface MissionView {
  mission: Readonly<Row<"mission">>; // immutable specification plus authoritative lifecycle
  credits: readonly Row<"missionCredit">[]; // validated milestones; retained across client restarts
  completedObjectiveIds: readonly string[]; // derived from credits, not a separately writable counter
  readyObjectiveIds: readonly string[]; // uncredited objectives with all dependencies credited, while active and before deadline
} // UI and decision workers read the same mission; no per-LLM Mission or Run copy
// endregion

// Design contracts below describe semantic boundaries. They are NOT handwritten generated clients.
// Implementation generates reducer bindings from the completed SpacetimeDB module.

// region missions
export interface Missions {
  createMission(input: { id: string; spec: MissionSpec }): Promise<void>; // owner from identity; validate bound graph, limits and deadline; atomically activate + audit
  creditObjective(input: { missionId: string; objectiveId: string; evidence: MissionEvidence }): Promise<void>; // validate proof/readiness; atomically credit + audit and enter closing if all required objectives are met
  cancelMission(input: { missionId: string; expectedRevision: bigint }): Promise<void>; // idempotent if cancellation already requested; otherwise compare revision, block new work and cancel linked attempts
  reconcileMission(input: { missionId: string }): Promise<void>; // enforce deadline/completion; close only after all linked attempts have confirmed safe closure
} // owner/admin calls; no setProgress(), arbitrary success flag or model-controlled completion
// endregion

// region ingest
export interface PerceptionIngress {
  ingestObservation(input: ObservationInput): Promise<void>; // authorize producer; associate; atomically update supplied facets + audit
} // identical ID + principal + input retries are no-ops; changed duplicates conflict
// endregion

// region request
export interface ActionRequests {
  requestApproach(input: ApproachRequest): Promise<void>; // validate policy and evidence; insert one accepted execution + audit
} // duplicate same caller/body returns the existing receipt even after acceptBy; it does not run again
// endregion

// region claim
export interface ExecutionClaims {
  claimExecution(input: {
    executionId: string; // accepted attempt, or an identical claim retry by this controller
    controllerEpoch: bigint; // must match robot_control AND the local controller's persisted generation
  }): Promise<void>; // recheck pins/freshness; reserve actor and set running in the same transaction
} // do not steal a running attempt on timeout; a database fence alone cannot stop a physical robot
// endregion

// region cancel
export interface Cancellation {
  cancelExecution(input: { executionId: string }): Promise<void>; // transition accepted/running to cancelling; never imply physical stop
} // local controller confirms safe state before cancellation becomes terminal
// endregion

// region report
export interface ControlFeedback {
  reportControl(input: {
    actorId: string; controllerEpoch: bigint; // authenticated robot owner and current fence
    observedAt: Timestamp; // control acquisition time, not report arrival time
    stopLatched: boolean; safeStateConfirmed: boolean; // measured local state; uncertainty stays explicit
  }): Promise<void>; // update robot_control; cannot claim, clear a local latch or authorize motion
}
// endregion

// region finish
export interface ExecutionCompletion {
  finishExecution(input: {
    executionId: string; controllerEpoch: bigint; // same claimed attempt and controller generation
    result: Completion; // success includes measurement IDs and a durable safe-closure receipt
  }): Promise<void>; // validate outcome, commit terminal state + audit, release the active actor only if safe
} // if cancelling committed first, reject success; reconcile cancellation or failure instead
// endregion

// region configuration
export interface WorldAdministration {
  putMember(input: Row<"member">): Promise<void>; // admin-only enrollment; bound role, robot and producer package
  installApproach(input: Row<"actionBinding">): Promise<void>; // admin-only installation; increment version; never mutate an active pin
  removeEntity(input: { entityId: string }): Promise<void>; // reject active references; tombstone and remove components/relations atomically
  reconcileController(input: { actorId: string; newController: Identity; newEpoch: bigint; receiptId: string }): Promise<void>; // only after local safe stop and fence installation are verified
} // provisioning establishes the first admin out of band; never expose an unauthenticated bootstrap reducer
// endregion

// region controller
export interface LocalController {
  reconcile(executionId: string): Promise<LocalReceipt | undefined>; // inspect persistent outcome before considering any delivery
  start(input: {
    executionId: string; controllerEpoch: bigint; // immutable idempotency key plus installed local fence
    request: ApproachRequest; binding: Row<"actionBinding">; // exact accepted intent and tighter local limits
  }): Promise<LocalReceipt>; // persist before IO, reject changed duplicates, then bounded local navigation
  cancel(executionId: string): Promise<LocalReceipt>; // enter safe state locally; works without the world database
  stop(reason: string): Promise<LocalReceipt>; // latch stop locally first; do not depend on a subscription or cloud call
}
export interface LocalReceipt {
  id: string; executionId: string; controllerEpoch: bigint; // stable receipt identity and attempt correlation
  outcome: "notStarted" | "running" | "succeeded" | "cancelled" | "failed" | "unknown"; // sent is never succeeded
  safeState: "confirmed" | "unknown"; // uncertainty blocks new physical attempts
} // robot-local durable storage, not an extra remote table; independent monotonic watchdog and OS supervision
// endregion

// region resources
export interface EvidenceStorage {
  resolve(resourceId: string): Promise<{ url: string; expiresAt: Timestamp }>; // authenticated access to retained bytes; explicit missing/expired result
} // existing blob storage and media transport; no image/cloud byte arrays in live component tables
// endregion
