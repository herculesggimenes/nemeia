// Website specification only. No worker, reducer, driver or SDK schema imports this file.
import { missionViewCode } from "./mission-model-content.mjs";
import { spatialTypesCode, navigationCode } from "./spatial-model-content.mjs";
export const scopeCode = `interface ReadScope {
  worldId: string; // World Operator grants read access to the named world
} // Interest is derived automatically; no entity allowlist or agent-managed subscription.
interface AwarenessPolicy {
  radiusM?: number; // optional world-managed radius in a usable metric frame; not sensor coverage or safety clearance
  minIntervalMs: number; // cap ordinary inference wakes; not a polling requirement
  maxBatchWaitMs: number; // desired batching bound, subject to compute budget
} // Direct Unit observations, mission dependencies and pending outcomes do not depend on a radius.
// This scope grants world-level visibility; radius filtering is interest selection, not access control.
// Grants determine permission. Automatic Unit awareness selects relevant content within that permission.`;

export const objectCode = {
  "spatial-map": spatialTypesCode,
  "navigation": navigationCode,
  "mission-view": missionViewCode,
  "world-view": `// Authorized read projection over durable world records.
interface WorldView {
  worldId: string; // shared durable domain, not a promise of one coordinate system
  entities: ReadonlyMap<string, EntityView>; // authorized identities and current evidence-backed facets
  localMaps: readonly LocalMapView[]; // independent progressive maps; alignment is not assumed
  units: ReadonlyMap<string, UnitView>; // controllable entities, with the same entity IDs
  missions: ReadonlyMap<string, MissionView>; // intent and verified progress survive an Eve session reset
  agents: ReadonlyMap<string, AgentView>; // logical decision-makers and their authorized assignments
  relationships: readonly Row<"relation">[]; // configured or evidenced links; not automatic spatial alignment
  executions: readonly Row<"execution">[]; // durable intent and receipts, when an action is used
  actions: readonly Row<"actionBinding">[]; // installed capabilities; unavailable actions carry explicit reasons
  synchronized: boolean; // fresh authorized subscription state, not proof of live localization
} // Read projection over durable world records, never another writable snapshot or Eve memory store.
interface EntityView {
  entity: Readonly<Row<"entity">>; // stable identity; provisional association does not prove global identity
  poses: readonly Row<"pose">[]; // frame-qualified estimates; never force one global pose
  geometries: readonly Row<"geometry">[]; // preserve image-space evidence and local metric estimates separately
  semantic?: Readonly<Row<"semantic">>; // model hypotheses do not fabricate positions or assign human names
  control?: Readonly<Row<"unitControl">>; // measured local control projection for a Unit
}
interface Affordance {
  unitId: string; targetId?: string; // action-specific target; observation alone need not be spatially located
  evaluatedAt: Timestamp; // evidence continues to age without a new database write
  available: boolean; reasons: readonly string[]; // e.g. target_unlocated or relocalization_required
} // Check only the spatial requirements of this action; admission repeats them against current evidence.`,
  "local-map": `interface LocalMapView {
  map: Readonly<LocalMapRecord>; // durable identity, root frame and committed checkpoint head
  frames: readonly SpatialFrameRecord[]; // immutable frame identities, including distinct reset epochs
  checkpoint?: Readonly<MapRevisionRecord>; // absent before the first map checkpoint; observations still persist
  layers: readonly MapLayer[]; // checkpoint products: accumulated surfaces and/or occupancy, not just object detections
  entityIds: readonly string[]; // derived local membership, not an agent subscription or permission list
  unlocatedObservationIds: readonly string[]; // known evidence that cannot yet be positioned in this map
  localization: "localized" | "relocalization_required" | "unavailable"; // derived from current qualified evidence
} // Restoring map bytes does not restore knowledge of the Unit's current position.
interface LocalMapManifest extends MapCheckpoint {
  evidenceIndex: ResourceRef; // retained index of exact input observations/resources and source-session boundaries
  layers: readonly MapLayer[]; // complete retained products; each native payload includes frame and spatial metadata
  estimatorState?: ResourceRef; // optional versioned native export; not a guarantee of localization after restart
  producer: PackagePin; // exact mapper implementation; calibration/transform provenance stays with its inputs
} // Layers may be empty before metric mapping. Paged native products retain their full resource closure.
// Current entity components can advance independently of this checkpoint; expose their own basis revisions.
// Publish all referenced bytes first, then atomically commit map_revision + local_map head + audit.
// Keep evidence and checkpoint ancestry reachable under retention policy; never publish a dangling head.`,
  "unit-agent-view": `interface UnitView extends EntityView {
  bindings: readonly Row<"actionBinding">[]; // installed controllable capabilities; no second Unit identity
  assignment?: Readonly<Row<"unitAssignment">>; // command authority, not an execution reservation
  localMapId?: string; // current local mapping context; absent or unlocalized does not erase observations
}
interface AgentView {
  agent: Readonly<Row<"agent">>; // stable identity and world-managed access/pause
  missionLog: MissionLog; // all assigned missions and their progress; not one mission per agent
  assignments: readonly Row<"unitAssignment">[]; // authoritative Unit grants
  localMapIds: readonly string[]; // derived awareness of assigned Units; the agent does not choose subscriptions
} // Eve owns runtime history. Nemeia owns recoverable world memory and derives bounded step context.`,
};

export const worldMemoryCode = `interface WorldMemory {
  createLocalMap(input: { id: string; unitId: string; rootFrameId: string }): Promise<void>; // authorized mapper; register a unique frame epoch and durable map identity
  commitMapRevision(input: {
    mapId: string; expectedRevision: bigint; // compare-and-set prevents concurrent checkpoint heads
    manifest: ResourceRef; // immutable retained manifest and complete verified reference closure
  }): Promise<bigint>; // identical manifest retry returns its revision; otherwise atomically advance head + audit
  readLocalMap(input: { mapId: string; revision?: bigint }): Promise<LocalMapView>; // authorized checkpoint plus current frame-qualified records
} // No SLAM, blob IO or inference runs in the transaction.
// A trusted storage/mapper boundary verifies retained bytes before the commit. Reducers verify its receipt.
// Observation ingestion has its own idempotent commits; map checkpoints record their exact input coverage.
// Restore persisted state after restart; require new localization evidence before spatial action.`;

export const coordinationCode = `interface AgentCoordination {
  sendMessage(input: { id: string; missionId: string; toAgentId: string; content: string }): Promise<void>; // authenticate sender, validate participants and retain bounded messages
} // No subscription-management API: Nemeia derives awareness from Unit assignments and world-managed policy.
// Messages support coordination; they cannot grant control or declare objectives complete.`;

export function objectPlanningCode(id, code) {
  if (id === "geometry") return code.concat('\nexport type Pose3 = Infer<typeof Pose3>;\nexport type FrameRef = Infer<typeof FrameRef>;\nexport type ResourceRef = Infer<typeof ResourceRef>;');
  if (id === "evidence") return code.replace('  producerSession: t.string()', '  localMapId: t.string(), // originating local-map context, validated against producer authority; retain even for unlocated evidence\n  producerSession: t.string()').concat('\nexport type PackagePin = Infer<typeof PackagePin>;\nexport type TransformSample = Infer<typeof TransformSample>;');
  if (id === "action") return code
    .replace('mission and ready approached objective this attempt advances', 'mission and ready objective this attempt serves; investigation actions do not themselves complete it')
    .replace('  expectedGeometryVersion: t.u64()', '  expectedGeometryFrameId: t.string(), // identify the exact frame-qualified target facet; require a usable transform to the executor\n  expectedGeometryVersion: t.u64()')
    .concat('\n// For approached, require the specified target/standoff. For located, an investigation needs no known destination. Require measured local targets within separately authorized exploration limits.\n// This action can support an investigation, but only the objective criterion determines progress.');
  return code;
}

export const v0Principles = [
  ["Durable world state", "shared knowledge independent of agent memory", "Observations accumulate into durable entities, evidence and progressive local maps. Mission progress, assignments and execution receipts share this world state. Agents read relevant projections; they do not own separate copies of the world. Persistence is a platform responsibility and survives worker restarts or Eve session resets.", "observe → commit → refine → recover → continue"],
  ["Progressive local map", "measured space, not a room hierarchy", "A mapping system combines ranging with IMU/odometry and, where supported, visual measurements. It estimates Unit motion and accumulates surfaces or an occupancy representation with free, occupied and unknown space. Store these native products as retained resources, not one Entity per point or cell. Image detections add object knowledge without replacing the spatial map. Unknown depth stays unknown. A partial point cloud does not prove free space, full object dimensions or search coverage.", "range + motion estimates → accumulated spatial map · images → semantic evidence"],
  ["Observed objects", "identity, measurements and supporting evidence", "Perception associates repeated observations into object tracks. Each object can have image evidence, semantic hypotheses and a measured local position or shape when available. Missing depth stays missing. The agent can explain a location as beside the sofa using those observations; that interpretation does not require a room entity, a region boundary or a new annotation record.", "map + observed objects + evidence → agent interpretation"],
  ["Calibrated perception fusion", "parallel geometry and vision, then qualified association", "Match camera detections or masks to compatible range measurements using acquisition times, camera intrinsics, distortion, sensor extrinsics and pose history. Compensate motion where needed and reject occluded or inconsistent matches. Preserve image-only observations when association is unsupported. A planar LiDAR cannot measure full object height; a partial surface cannot silently become a complete measured box. Associate repeated views into the same object only with evidence of continuity. Geometry, semantics and visibility keep independent times.", "mapping + image evidence → calibrated association → persistent object tracks"],
  ["Durability and recovery", "world persistence is independent of Eve history", "Persist current world rows, retained supporting observations and versioned map checkpoints. Store large geometry and optional native estimator exports as immutable resources. Validate retained bytes before advancing a checkpoint head atomically; preserve its exact evidence coverage. After a crash, restore the last committed head and reconcile later retained observations by their IDs, without pretending an audit log is a full scene recorder. A mapper that cannot resume its native state starts a new frame epoch until it can relocalize. An Eve reset changes conversation history, not map, mission, entity or execution identity.", "restored map ≠ localized Unit · durable world ≠ conversation transcript"],
  ["Automatic Unit awareness", "direct observations first; radius when usable", "Nemeia derives agent context from assigned Units. It always includes their permitted observations, mission dependencies and pending outcomes. A world-managed radius adds nearby shared state only when metric positions can be compared reliably. Discovery and unlocated evidence remain outside radius filtering. No agent-managed subscriptions or preselected entity list. As context grows, keep bounded relevant projections and authorized detail reads; absence from a prompt never deletes durable world knowledge.", "Unit observations + usable local neighborhood + mission dependencies → context"],
  ["Local frames and reconciliation", "one logical world; independent spatial views", "Every metric estimate names its frame and acquisition time. Register fresh frame identities after coordinate resets; never reinterpret old coordinates. Local sensor transforms remain necessary when fusing measurements. Cross-Unit alignment is optional: a qualified localization system publishes evidence-backed relationships between frames when available. Keep original local evidence and identity provenance; aligning maps does not prove two tracks are the same object. Agents can share non-spatial mission findings without aligned coordinates.", "local frame A · local frame B · evidence-backed relationship"],
  ["Spatial requirements belong to actions", "choose a local goal; let local systems handle motion", "The agent chooses a useful viewing pose from the measured map and object evidence. navigate@1 targets that pose; approach@1 targets an observed entity at a standoff. Both require current localization, authority and qualified local planning. The controller checks live obstacles independently of mapping and LLM rates. A description alone supplies neither coordinates nor motion permission.", "observed object → useful viewpoint → local planner + control"],
];

export function renderWorldPlan({ section, proseRow }) {
  return section("local-world", "02a", "World memory & local maps", "The world retains accumulated knowledge across observations and restarts. Units can maintain independent spatial views and reconcile them through qualified frame relationships.", `<div class="abstraction-list">${v0Principles.map((row, i) => proseRow(i, ...row)).join("\n")}</div>`);
}

// Table inventory and columns are generated directly from the frozen module.

export { exampleRows as v0ExampleRows, exampleCode as v0FlowCode } from "./world-example-content.mjs";
