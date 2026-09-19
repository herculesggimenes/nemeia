import { schema, table, t } from "spacetimedb/server";
import { ApproachRequest, Completion, ExecutionState, Geometry, Mode, ObservationInput, PackagePin, Pose3, Role, Semantic } from "./values.ts";

// These tables and the two functions below are checked SDK examples, not a deployed module.
// Column documentation on the page is generated from these declarations and comments.

export const worldConfig = table({ name: "world_config", public: false }, {
  id: t.u8().primaryKey(), // Singleton key = 0; one database owns one world.
  worldId: t.string().unique(), // Stable world identity; database names may change.
  frameId: t.string(), // Shared frame, e.g. map; namespace device frames in adapters.
  mode: Mode, // Never mix live timestamps and simulation time in one database.
  clockErrorBoundMs: t.u32(), // Maximum accepted acquisition-clock uncertainty.
});

export const member = table({ name: "member", public: false }, {
  identity: t.identity().primaryKey(), // Verified SpacetimeDB caller; never trust a submitted principal ID.
  role: Role, // One role per identity in this slice; use separate worker credentials.
  robotId: t.option(t.string()), // Controller/perception scope; absent for world-wide reader/operator roles.
  producerSession: t.option(t.string()), // Current worker session; restart creates a new identity for tracks.
  package: t.option(PackagePin), // Authorized producer code; asserted during deployment, not caller-selected.
});

export const entity = table({ name: "entity", public: false }, {
  id: t.string().primaryKey(), // Opaque UUID; never inferred from the detected label.
  displayName: t.string(), // Human-readable name; no authority or association meaning.
  kind: t.string(), // Closed deployment vocabulary: robot, object or region.
  createdAt: t.timestamp(), // Database creation time, not sensor time.
  removedAt: t.option(t.timestamp()), // Tombstone prevents identity reuse; readers exclude removed entities.
});

export const pose = table({ name: "pose", public: false }, {
  entityId: t.string().primaryKey(), // One current pose component per entity.
  frameId: t.string(), // World-scoped reference frame.
  value: Pose3, // Measured translation and unit quaternion.
  observedAt: t.timestamp(), // Acquisition time; polling never refreshes it.
  observationId: t.string(), // Exact evidence in observation or its retained archive.
  version: t.u64(), // Monotonically increasing revision for this component and entity.
});

export const geometry = table({ name: "geometry", public: false }, {
  entityId: t.string().primaryKey(), // One current geometry component; image boxes remain image-space values.
  value: Geometry, // Typed shape union; this action accepts only boundingBox3D in the world frame.
  observedAt: t.timestamp(), // Geometry acquisition time independent of semantic evidence.
  observationId: t.string(), // Observation that supplied this geometry.
  version: t.u64(), // Pins the target the user actually selected.
});

export const semantic = table({ name: "semantic", public: false }, {
  entityId: t.string().primaryKey(), // Classification attaches to identity, not vice versa.
  value: Semantic, // Labels and scores; no invented collision shape or action capability.
  observedAt: t.timestamp(), // Semantic acquisition time, not the latest geometry time.
  observationId: t.string(), // Evidence that supplied the hypotheses.
  version: t.u64(), // Independent semantic component revision.
});

export const relation = table({ name: "relation", public: false }, {
  key: t.string().primaryKey(), // Canonical JSON tuple [subjectId,predicate,objectId]; collision-safe encoding.
  subjectId: t.string().index("btree"), // Existing, non-removed source entity.
  predicate: t.string(), // Installed domain meaning, e.g. observed_by; not free-form authorization.
  objectId: t.string().index("btree"), // Existing, non-removed destination entity.
  observationId: t.option(t.string()), // Evidence for an observed relation; absent for configured relations.
});

export const observation = table({ name: "observation", public: false }, {
  id: t.string().primaryKey(), // Same UUID as input.id; deduplicate before assigning an entity.
  producer: t.identity(), // ctx.sender, bound to an authorized producer role and package.
  package: PackagePin, // Immutable code provenance copied from member at ingestion.
  entityId: t.string().index("btree"), // Recorded association decision, never recomputed on replay.
  input: ObservationInput, // Supplied facets, original times, frames, transforms and fusion references.
  recordedAt: t.timestamp(), // Database receipt time; not evidence freshness.
});

export const track = table({ name: "track", public: false }, {
  key: t.string().primaryKey(), // Canonical JSON tuple [producerIdentity,producerSession,trackId].
  entityId: t.string().index("btree"), // Associated entity; session changes do not merge same-label objects.
  lastObservationId: t.string(), // Latest accepted evidence for this association.
});

export const actionBinding = table({ name: "action_binding", public: false }, {
  actorId: t.string().primaryKey(), // One approach@1 binding per actor in this deliberately narrow slice.
  version: t.u64(), // Immutable revision copied into accepted executions.
  executor: PackagePin, // Exact installed implementation; never chosen by the requesting client.
  mode: Mode, // Same approach meaning; simulation or physical executor.
  maxEvidenceAgeMs: t.u32(), // Freshness policy for pose and target geometry.
  maxLinearMps: t.f64(), // Positive configured speed cap; local gate can impose a tighter cap.
  maxRunMs: t.u32(), // Bounded execution duration measured locally with a monotonic clock.
  toleranceM: t.f64(), // Allowed measured error around the requested center-to-center standoff.
});

export const robotControl = table({ name: "robot_control", public: false }, {
  actorId: t.string().primaryKey(), // One physical control owner per robot.
  controller: t.identity(), // Allowed claimant and feedback producer for this robot.
  epoch: t.u64(), // Fencing generation also enforced by the persistent local controller.
  activeExecutionId: t.option(t.string()), // At most one active physical attempt; claim updates this atomically.
  stopLatched: t.bool(), // Projection of the local stop latch; false is not proof of permission to move.
  safeStateConfirmed: t.bool(), // Last measured controller confirmation; retain uncertainty on lost feedback.
  observedAt: t.timestamp(), // Acquisition time of the local control report.
});

export const execution = table({ name: "execution", public: false }, {
  id: t.string().primaryKey(), // input.executionId; execution row is also the durable retry receipt.
  requestedBy: t.identity().index("btree"), // Caller who owns this attempt and idempotency key.
  actorId: t.string().index("btree"), // Indexed routing to the robot controller.
  input: ApproachRequest, // Immutable normalized request; changed retries with the same ID conflict.
  binding: actionBinding.rowType, // Exact action policy, mode and executor pinned at acceptance.
  targetGeometryVersion: t.u64(), // Target revision checked again at claim; movement never silently retargets.
  state: ExecutionState, // accepted, running, cancelling, succeeded, cancelled or failed.
  controller: t.option(t.identity()), // Assigned only by a successful claim transaction.
  controllerEpoch: t.option(t.u64()), // Claimed local control generation; reject old feedback.
  createdAt: t.timestamp(), // Acceptance time at the database.
  updatedAt: t.timestamp(), // Most recent committed lifecycle transition.
  result: t.option(Completion), // Present only in a terminal state; success includes measured evidence.
});

export const worldEvent = table({ name: "world_event", public: false }, {
  sequence: t.u64().primaryKey().autoInc(), // Local audit ordering; not a subscription cursor and gaps are allowed.
  id: t.string().unique(), // UUID retained on export; one domain decision per row.
  kind: t.string(), // Closed names: observation.recorded, execution.accepted/claimed/cancel_requested/finished, configuration.changed, entity.removed.
  subjectId: t.string().index("btree"), // Entity or execution whose decision was recorded.
  actor: t.identity(), // Authenticated producer of this decision.
  recordedAt: t.timestamp(), // Database transaction time.
  detail: t.string(), // Short audit explanation; never parse it to reconstruct world state.
}); // Ordinary persisted table, NOT SpacetimeDB's transient event-table feature.

// region module
export const db = schema({
  worldConfig, member, entity, pose, geometry, semantic, relation,
  observation, track, actionBinding, robotControl, execution, worldEvent,
}); // no public base tables; expose authorized views instead
export default db;
// endregion

// region reducer
export const cancel_execution = db.reducer(
  { executionId: t.string() }, // caller identity comes from ctx.sender, not this input
  (ctx, { executionId }) => {
    const caller = ctx.db.member.identity.find(ctx.sender);
    const row = ctx.db.execution.id.find(executionId);
    if (!caller || !row) throw new Error("not_found_or_forbidden");
    const owns = row.requestedBy.isEqual(ctx.sender);
    if (caller.role.tag !== "admin" && !(caller.role.tag === "operator" && owns)) {
      throw new Error("forbidden");
    }
    if (row.state.tag !== "accepted" && row.state.tag !== "running") return; // idempotent; terminal states stay immutable
    ctx.db.execution.id.update({ ...row, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
    ctx.db.worldEvent.insert({
      sequence: 0n, id: ctx.newUuidV4().toString(), // autoInc assigns the audit sequence
      kind: "execution.cancel_requested", subjectId: row.id, actor: ctx.sender,
      recordedAt: ctx.timestamp, detail: "Await local safe-state confirmation",
    }); // both writes commit or both roll back
  },
); // returns no domain object; observe the authorized execution view for the resulting row
// endregion

// region view
export const visible_executions = db.view(
  { name: "visible_executions", public: true },
  t.array(execution.rowType), // an identity-scoped view, not a public execution table
  (ctx) => {
    const caller = ctx.db.member.identity.find(ctx.sender);
    if (!caller) return [];
    if (caller.role.tag === "admin" || caller.role.tag === "viewer") return [...ctx.db.execution.iter()];
    if (caller.role.tag === "operator") return [...ctx.db.execution.requestedBy.filter(ctx.sender)];
    if (caller.role.tag === "controller" && caller.robotId !== undefined) {
      return [...ctx.db.execution.actorId.filter(caller.robotId)];
    }
    return []; // perception credentials cannot inspect command history
  },
); // SDK subscriptions receive a consistent initial result and committed changes
// endregion
