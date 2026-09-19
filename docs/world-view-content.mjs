// Website specification only. No worker, reducer, driver or SDK schema imports this file.
import { missionViewCode } from "./mission-model-content.mjs";
import { spatialTypesCode, navigationCode } from "./spatial-model-content.mjs";
export const scopeCode = `interface ReadScope {
  worldId: string; // World Master grants read access to the named world
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
  region?: Readonly<RegionRecord>; // a spatial region is an Entity with an extent, not a special identity system
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
  regions: readonly RegionView[]; // partial or bounded spaces; names and hypotheses can be absent
  entityIds: readonly string[]; // derived local membership, not an agent subscription or permission list
  unlocatedObservationIds: readonly string[]; // known evidence that cannot yet be positioned in this map
  localization: "localized" | "relocalization_required" | "unavailable"; // derived from current qualified evidence
} // Restoring map bytes does not restore knowledge of the Unit's current position.
interface LocalMapManifest extends MapCheckpoint {
  evidenceIndex: ResourceRef; // retained index of exact input observations/resources and source-session boundaries
  layers: readonly MapLayer[]; // complete retained products; each native payload includes frame and spatial metadata
  regionVersions: readonly { entityId: string; revision: bigint }[]; // exact archived region components at this checkpoint
  estimatorState?: ResourceRef; // optional versioned native export; not a guarantee of localization after restart
  producer: PackagePin; // exact mapper implementation; calibration/transform provenance stays with its inputs
} // Layers may be empty before metric mapping. Paged native products retain their full resource closure.
// Current region/entity components can advance independently of this checkpoint; expose their own basis revisions.
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
  projectRegion(input: {
    entityId: string; mapId: string; expectedRevision: bigint; // trusted spatial worker; zero creates a region component
    extent: RegionExtent; observationIds: readonly string[]; // validate retained checkpoint, aligned mask and spatial evidence
  }): Promise<void>; // compare revision; commit extent + evidence + audit, preserving any assigned name
  nameRegion(input: {
    entityId: string; expectedRevision: bigint; name: string | null; // World Master only; null clears the assigned name
  }): Promise<void>; // bound nonempty text; derive author/time; bump region revision + audit without changing geometry
} // No SLAM, blob IO or inference runs in the transaction.
// Region edits archive the prior component and preserve proof references; name changes never rewrite evidence.
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
    .concat('\n// For approached, require the specified target/standoff. For located or inspected, investigation may\n// precede place resolution. Require measured local targets within separately authorized exploration limits.\n// This action can support an investigation, but only the objective criterion determines progress.');
  return code;
}

export const v0Principles = [
  ["Durable world state", "shared knowledge independent of agent memory", "Observations accumulate into durable entities, evidence and progressive local maps. Mission progress, assignments and execution receipts share this world state. Agents read relevant projections; they do not own separate copies of the world. Persistence is a platform responsibility and survives worker restarts or Eve session resets.", "observe → commit → refine → recover → continue"],
  ["Progressive local map", "spatial structure grows before rooms have names", "A mapping system combines ranging with IMU/odometry and, where supported, visual measurements. It estimates Unit motion and accumulates surfaces or an occupancy representation with free, occupied and unknown space. Store these native products as retained resources, not one Entity per point or cell. Image detections add object knowledge without replacing the spatial map. Unknown depth stays unknown. A partial point cloud does not prove free space, full object dimensions or search coverage.", "range + motion estimates → accumulated spatial map · images → semantic evidence"],
  ["Regions, labels and objects", "map geometry → stable regions → revisable meaning", "Spatial processing delimits regions and observed connections from accumulated geometry. A region is an Entity with a versioned extent; it can remain partial and unnamed. Semantic workers propose room hypotheses. A World Master can assign a name such as Kitchen before the map is complete. Names are not unique IDs and do not change coordinate frames. Objects have independent tracks and evidence-backed located_in relations. Refining a boundary or renaming a region preserves identity and historical evidence; splitting or merging regions requires explicit identity review.", "space-2 + measured extent + Kitchen · backpack-A located_in space-1"],
  ["Calibrated perception fusion", "parallel geometry and vision, then qualified association", "Match camera detections or masks to compatible range measurements using acquisition times, camera intrinsics, distortion, sensor extrinsics and pose history. Compensate motion where needed and reject occluded or inconsistent matches. Preserve image-only observations when association is unsupported. A planar LiDAR cannot measure full object height; a partial surface cannot silently become a complete measured box. Associate repeated views into the same object only with evidence of continuity. Geometry, semantics and visibility keep independent times.", "mapping + image evidence → calibrated association → persistent object tracks"],
  ["Durability and recovery", "world persistence is independent of Eve history", "Persist current world rows, retained supporting observations and versioned map checkpoints. Store large geometry and optional native estimator exports as immutable resources. Validate retained bytes before advancing a checkpoint head atomically; preserve its exact evidence coverage. After a crash, restore the last committed head and reconcile later retained observations by their IDs, without pretending an audit log is a full scene recorder. A mapper that cannot resume its native state starts a new frame epoch until it can relocalize. An Eve reset changes conversation history, not map, mission, entity or execution identity.", "restored map ≠ localized Unit · durable world ≠ conversation transcript"],
  ["Automatic Unit awareness", "direct observations first; radius when usable", "Nemeia derives agent context from assigned Units. It always includes their permitted observations, mission dependencies and pending outcomes. A world-managed radius adds nearby shared state only when metric positions can be compared reliably. Discovery and unlocated evidence remain outside radius filtering. No agent-managed subscriptions or preselected entity list. As context grows, keep bounded relevant projections and authorized detail reads; absence from a prompt never deletes durable world knowledge.", "Unit observations + usable local neighborhood + mission dependencies → context"],
  ["Local frames and reconciliation", "one logical world; independent spatial views", "Every metric estimate names its frame and acquisition time. Register fresh frame identities after coordinate resets; never reinterpret old coordinates. Local sensor transforms remain necessary when fusing measurements. Cross-Unit alignment is optional: a qualified localization system publishes evidence-backed relationships between frames when available. Keep original local evidence and identity provenance; aligning maps does not prove two tracks are the same object. Agents can share non-spatial mission findings without aligned coordinates.", "local frame A · local frame B · evidence-backed relationship"],
  ["Spatial requirements belong to actions", "semantic destinations resolve to measured local goals", "A room description resolves to an evidenced region, then its current extent and a useful viewing or navigation pose. An unresolved description triggers observation or authorized exploration, not fabricated coordinates. navigate@1 targets a pose; approach@1 targets an observed entity at a standoff. Both require current localization and qualified local planning. The controller derives a Unit-specific cost/traversability view and checks live obstacles independently of mapping and LLM rates. Another Unit needs qualified alignment or independent reacquisition.", "kitchen → region identity → current extent → local pose → planner + control"],
];

export function renderWorldPlan({ section, proseRow }) {
  return section("local-world", "02a", "World memory & local maps", "The world retains accumulated knowledge across observations and restarts. Units can maintain independent spatial views and reconcile them through qualified frame relationships.", `<div class="abstraction-list">${v0Principles.map((row, i) => proseRow(i, ...row)).join("\n")}</div>`);
}

// Explicit planning deltas over the existing checked SDK scaffold. Do not edit runtime .ts files.
export function plannedTables(tables) {
  const removeColumn = (name, column) => { const table = tables.find(item => item.name === name); table.columns = table.columns.filter(([id]) => id !== column); };
  const describe = (name, column, description) => { tables.find(table => table.name === name).columns.find(([id]) => id === column)[2] = description; };
  const retype = (name, column, type) => { tables.find(table => table.name === name).columns.find(([id]) => id === column)[1] = type; };
  removeColumn("world_config", "frameId");
  tables.find(table => table.name === "world_config").columns.push(["awarenessPolicy", "AwarenessPolicy", "World-managed batching and optional metric radius; not agent-owned entity filters."]);
  for (const name of ["pose", "geometry"]) {
    const table = tables.find(item => item.name === name);
    table.columns.unshift(["key", "string", "PK. Canonical tuple [entityId, frameId]; one owning projection pipeline per facet/frame."]);
    describe(name, "entityId", "Indexed entity identity; retain independent local-frame estimates instead of one global value.");
    if (name === "geometry") table.columns.splice(2, 0, ["frameId", "string", "Registered local/sensor frame; 2D geometry still refers to its exact image and remains in pixels."]);
    else describe(name, "frameId", "Registered local reference frame and reset epoch; no shared world frame required.");
    describe(name, "version", "Monotonic revision within this entity/frame facet; action pins identify the frame and revision.");
  }
  describe("geometry", "value", "Geometry with its native frame; image boxes do not imply metric position or navigability.");
  const binding = tables.find(table => table.name === "action_binding");
  binding.columns.unshift(["key", "string", "PK. Canonical tuple [unitId, actionName]; each installed action has its own policy."]);
  binding.columns.splice(2, 0, ["actionName", "approach@1 | navigate@1", "Typed action implemented by this pinned executor; never supplied as arbitrary code."]);
  binding.columns.push(["headingToleranceRad", "Option<f64>", "Required positive finite heading tolerance for navigate@1; absent for approach@1."]);
  describe("action_binding", "unitId", "Indexed controllable entity; bindings share its single execution reservation.");
  describe("action_binding", "mode", "Simulation or physical implementation of the same action meaning.");
  describe("action_binding", "maxEvidenceAgeMs", "Maximum age of required Unit/localization evidence and target geometry when applicable.");
  describe("action_binding", "toleranceM", "Positive finite position error for navigation, or error around an approach standoff.");
  retype("execution", "input", "ActionIntent");
  retype("execution", "result", "Option<ActionCompletion>");
  removeColumn("execution", "targetGeometryVersion");
  describe("execution", "missionId", "Derived from input.value.mission; cannot differ from the accepted action intent.");
  describe("member", "role", "One role per identity; use separate worker credentials.");
  describe("unit_assignment", "unitId", "PK. Controllable entity; one command-owning agent at a time.");
  tables.find(table => table.name === "observation").columns.splice(3, 0,
    ["unitId", "string", "Originating Unit derived from authenticated producer scope; preserve across credential/session changes."],
    ["localMapId", "string", "Originating map context checked at ingestion; unlocated evidence remains attached without fabricated coordinates."]);
  describe("world_event", "kind", "Installed domain events, including observation.recorded, map.revision_committed, region.projected/named, mission and execution transitions; not every sensor callback.");
  describe("mission", "spec", "MissionSpec: immutable description, objectives and optional deadline/template; no hardware assignment.");
  const progress = tables.find(table => table.name === "mission_credit");
  progress.name = "mission_objective_progress";
  progress.accessor = "missionObjectiveProgress";
  describe("mission_objective_progress", "key", "PK. Canonical tuple [missionId, objectiveId]; one immutable completion proof, not a counter.");
  describe("mission_objective_progress", "evidence", "MissionEvidence loaded and validated by the world; a submitted status or percentage cannot advance progress.");
  describe("mission_objective_progress", "recordedAt", "Completion commit time; pending objectives are derived from the specification and need no row.");
  describe("mission_agent", "agentId", "Indexed agent identity. One agent can hold many assignments; the mission log derives from these rows.");
  const additions = [
    { name: "region", accessor: "region", columns: [
      ["entityId", "string", "PK. Existing Entity identity; region is a component, not a parallel identity system."],
      ["mapId", "string", "Indexed local map containing the extent; no assumed cross-map alignment."],
      ["revision", "u64", "Compare-and-set revision for extent/name edits. Archive prior component versions before replacement."],
      ["extent", "RegionExtent", "Retained checkpoint, occupancy layer and aligned region mask; explicitly partial or bounded."],
      ["observationIds", "string[]", "Retained spatial evidence used to establish this extent; labels cannot create geometry."],
      ["name", "Option<RegionName>", "World Master-assigned text, authenticated author and time; model hypotheses remain in semantic."],
    ] },
    { name: "spatial_frame", accessor: "spatialFrame", columns: [
      ["id", "string", "PK. Immutable namespaced frame identity; use a new ID after an origin reset."],
      ["unitId", "Option<string>", "Originating Unit; site frames need not belong to one Unit."],
      ["kind", "local_map | odom | body | sensor | site", "Frame role; axes and units follow the documented adapter convention."],
      ["createdAt", "Timestamp", "Registration time, not measurement time. Dynamic transforms remain timestamped evidence."],
    ] },
    { name: "local_map", accessor: "localMap", columns: [
      ["id", "string", "PK. Durable local map identity, independent of agent or Eve session."],
      ["unitId", "string", "Originating Unit; ownership does not imply a globally aligned map."],
      ["rootFrameId", "string", "Registered immutable local-map frame. Reuse only after verified relocalization."],
      ["revision", "u64", "Committed checkpoint revision; starts at zero before any checkpoint."],
      ["headRevisionId", "Option<string>", "Current retained map_revision; atomically advanced with revision and audit."],
      ["createdAt", "Timestamp", "Map creation time. Freshness comes from observations, not this row."],
    ] },
    { name: "map_revision", accessor: "mapRevision", columns: [
      ["id", "string", "PK. Canonical tuple [mapId, revision]; immutable once committed."],
      ["mapId", "string", "Indexed local_map identity; validate root frame and expected head."],
      ["revision", "u64", "Monotonic local checkpoint version; not a global subscription cursor."],
      ["parentRevision", "Option<u64>", "Predecessor checkpoint; preserve reachable history under retention policy."],
      ["manifest", "ResourceRef", "Retained LocalMapManifest: native spatial layers, region versions, exact evidence coverage and optional mapper state."],
      ["recordedAt", "Timestamp", "Commit time. Does not make old observations or localization fresh."],
    ] },
  ];
  return [...tables.filter(table => table.name !== "agent_subscription"), ...additions];
}

export { exampleRows as v0ExampleRows, exampleCode as v0FlowCode } from "./world-example-content.mjs";
