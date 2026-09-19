import type { Identity, Timestamp, Infer } from "spacetimedb";
import type * as tables from "./schema.ts";
import type { ApproachRequest, Completion, ObservationInput } from "./values.ts";
import type { MissionSpec, MissionEvidence } from "./missions.ts";

type TableMap = Pick<typeof tables, "worldConfig" | "member" | "entity" | "pose" | "geometry" | "semantic" | "relation" | "observation" | "track" | "actionBinding" | "unitControl" | "mission" | "missionCredit" | "agent" | "missionAgent" | "unitAssignment" | "agentSubscription" | "agentMessage" | "execution" | "worldEvent">;
export type Row<K extends keyof TableMap> = Infer<TableMap[K]["rowType"]>;

// region world-view
export interface WorldView {
  world: Readonly<Row<"worldConfig">>; // identifies this database's world and clock domain
  entities: ReadonlyMap<string, EntityView>; // join only authorized, subscribed component rows
  units: ReadonlyMap<string, UnitView>; // derived controllable subset of entities, keyed by the same entity IDs
  relationships: readonly Row<"relation">[]; // both endpoints are in this authorized world view
  actions: readonly Row<"actionBinding">[]; // approach@1 bindings, not a second action registry
  executions: readonly Row<"execution">[]; // only attempts this identity is allowed to see
  missions: ReadonlyMap<string, MissionView>; // authorized mission instances and their evidence-backed progress
  agents: ReadonlyMap<string, AgentView>; // authorized logical participants; not embedded inside robot entities
  synchronized: boolean; // false while disconnected or until the required subscription is applied
} // presentation only: no writable snapshot, manual delta cursor or second authoritative world
export interface EntityView {
  entity: Readonly<Row<"entity">>; // identity and display metadata
  pose?: Readonly<Row<"pose">>; // absence means unknown, never an origin pose
  geometry?: Readonly<Row<"geometry">>; // absence means unknown, never a default box
  semantic?: Readonly<Row<"semantic">>; // classification is independent of geometry
  control?: Readonly<Row<"unitControl">>; // local execution state when this entity is controllable
}
export interface Affordance {
  unitId: string; targetId: string; // identities for approach@1
  evaluatedAt: Timestamp; // explicit evaluation time; fresh rows still age without database writes
  available: boolean; reasons: readonly string[]; // read-only hint, not an execution grant
} // UI recomputes freshness locally; the reducer repeats all checks authoritatively
// endregion

// region unit-agent-view
export interface UnitView extends EntityView {
  bindings: readonly Row<"actionBinding">[]; // nonempty installed capabilities make this entity a Unit; no separate Unit identity/table
  assignment?: Readonly<Row<"unitAssignment">>; // which agent may request actions; not a physical execution reservation
} // Go2, vacuum and simulated robot are Units; a chair is normally only an Entity
export interface AgentView {
  agent: Readonly<Row<"agent">>; // durable decision-maker; read scope and pause are world-managed configuration
  missions: readonly Row<"missionAgent">[]; // many agents may contribute to one mission
  assignments: readonly Row<"unitAssignment">[]; // zero, one or many controlled Units; expiry still needs evaluation
  subscriptions: readonly Row<"agentSubscription">[]; // multiple interests/cadences feed a single inbox
} // runtime scheduling lives with the worker; administrative pause does not imply idle or disconnected
// endregion

// region mission-view
export interface MissionView {
  mission: Readonly<Row<"mission">>; // immutable specification plus authoritative lifecycle
  credits: readonly Row<"missionCredit">[]; // validated milestones; retained across client restarts
  participants: readonly Row<"missionAgent">[]; // shared team membership, independent from objective credit and Unit control
  completedObjectiveIds: readonly string[]; // derived from credits, not a separately writable counter
  readyObjectiveIds: readonly string[]; // uncredited objectives with all dependencies credited, while active and before deadline
} // UI and decision workers read the same mission; no per-LLM Mission or Run copy
// endregion

// Design contracts below describe semantic boundaries. They are NOT handwritten generated clients.
// Implementation generates reducer bindings from the completed SpacetimeDB module.

// region missions
export interface Missions {
  createMission(input: { id: string; spec: MissionSpec }): Promise<void>; // World Master only; owner from identity; validate graph, targets and deadline; activate + audit
  creditObjective(input: { missionId: string; objectiveId: string; evidence: MissionEvidence }): Promise<void>; // validate proof/readiness; atomically credit + audit and enter closing if all required objectives are met
  cancelMission(input: { missionId: string; expectedRevision: bigint }): Promise<void>; // idempotent if cancellation already requested; otherwise compare revision, block new work and cancel linked attempts
  reconcileMission(input: { missionId: string }): Promise<void>; // enforce deadline/completion; close only after all linked attempts have confirmed safe closure
} // World Master creates/cancels; active assigned agents may submit proof; trusted reconciliation never invents evidence
// endregion

// region world-masters
export interface WorldMasters {
  configureAgent(input: Omit<Row<"agent">, "revision">, expectedRevision: bigint): Promise<void>; // enroll an agent principal or edit read scope/pause; server assigns revision; zero expects creation
  assignMission(input: { missionId: string; agentId: string; active: boolean; expectedRevision: bigint }): Promise<void>; // validate roster edit; bump mission revision; reconcile revoked agent's linked attempts
  assignUnit(input: { unitId: string; agentId?: string; actionNames: string[]; expiresAt?: Timestamp; expectedRevision: bigint }): Promise<void>; // compare grant revision; revoke old authority, bump revision and cancel/reconcile affected work
} // World Master is an authorized client role, not a mandatory service or singleton; paused agents cannot start new work
// Ownership transfer and grant expiry are NOT physical stop; reservation stays until the local executor confirms safety.
// World Masters inspect the whole recorded world but cannot rewrite measured evidence or bypass local interlocks.
// endregion

// region coordination
export interface AgentCoordination {
  putSubscription(input: Omit<Row<"agentSubscription">, "revision">, expectedRevision: bigint): Promise<void>; // own agent or World Master; validate interest within grants; server bumps revision; zero expects creation
  sendMessage(input: { id: string; missionId: string; toAgentId: string; content: string }): Promise<void>; // derive sender; bound size/rate; require both agents' active participation; persist + audit idempotently
} // shared world rows coordinate facts; messages carry requests/explanations, never permissions or objective credit
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
    controllerEpoch: bigint; // must match unit_control AND the local controller's persisted generation
  }): Promise<void>; // recheck pins/freshness; reserve unit and set running in the same transaction
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
    unitId: string; controllerEpoch: bigint; // authenticated local executor, not the assigned reasoning agent
    observedAt: Timestamp; // control acquisition time, not report arrival time
    stopLatched: boolean; safeStateConfirmed: boolean; // measured local state; uncertainty stays explicit
  }): Promise<void>; // update unit_control; cannot claim, clear a local latch or authorize motion
}
// endregion

// region finish
export interface ExecutionCompletion {
  finishExecution(input: {
    executionId: string; controllerEpoch: bigint; // same claimed attempt and controller generation
    result: Completion; // success includes measurement IDs and a durable safe-closure receipt
  }): Promise<void>; // validate outcome, commit terminal state + audit, release the active unit only if safe
} // if cancelling committed first, reject success; reconcile cancellation or failure instead
// endregion

// region configuration
export interface WorldAdministration {
  putMember(input: Row<"member">): Promise<void>; // admin-only enrollment; bound role, Unit and producer package
  installApproach(input: Row<"actionBinding">): Promise<void>; // admin-only installation; increment version; never mutate an active pin
  removeEntity(input: { entityId: string }): Promise<void>; // reject active references; tombstone and remove components/relations atomically
  reconcileController(input: { unitId: string; newController: Identity; newEpoch: bigint; receiptId: string }): Promise<void>; // only after local safe stop and fence installation are verified
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
