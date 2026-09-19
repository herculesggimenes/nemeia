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

export const v0ExampleRows = [
  ["mission", "Find the backpack · inspect the passage", "search + inspection · shared world", "The World Master asks Navigator to find a blue backpack in the living area and inspect the passage to the kitchen. Neither room, passage nor backpack has a known entity or location at assignment. The objectives retain those place descriptions. Discovery is part of the work; evidence-backed findings must establish the intended places before review can complete either objective."],
  ["team", "Assign Navigator and grant Go2", "one mission log · one Unit · separate authority", "The World Master creates both missions, assigns them to Navigator and separately grants Go2 control. Nemeia derives awareness from Go2 observations, its usable local neighborhood and both mission dependencies. Neither assignment starts the robot or creates a separate Eve loop."],
  ["prepared", "Choose an investigation from the mission log", "read known evidence → identify a gap → choose a viewpoint", "Navigator reads both assignments and sees that the place references are unresolved. It first examines Go2’s current observations and any retained local knowledge. No kitchen destination is available to navigate to. Exploration seeks information that could identify the rooms and their connections; it does not require knowing their names or complete layout in advance."],
  ["discovery", "Accumulate spatial structure before naming rooms", "range + motion estimates → surfaces + free / occupied / unknown space", "The mapping pipeline integrates repeated range acquisitions with IMU/odometry, producing poses and a growing local map. Camera measurements may also support motion estimation. Image perception runs alongside it. The first checkpoint has spatial structure but no kitchen, living-area or opening entity. A navigation system can select a viewing pose on known traversable space near an unexplored boundary. Exploration still needs separate authorization and a qualified local controller."],
  ["navigation", "Navigate to a map-derived viewpoint", "pose intent → admission → local planner → measured receipt", "Navigator chooses a useful viewpoint proposed from the mapped surroundings, not coordinates inferred from a room name. navigate@1 carries that local pose and its map context. The installed controller plans and replans using current localization, Unit-specific traversability and live obstacles. It can reject an unsafe or unreachable goal. Mapping and perception continue during motion; arrival supplies another view, not an inspection result."],
  ["inputs", "Associate camera evidence with measured surfaces", "image detection + calibrated ranging → persistent object track", "YOLOE detects a backpack candidate in an image. A spatial worker uses synchronized acquisitions, camera calibration, sensor extrinsics and motion estimates to associate compatible range points with that track. It retains the visible surface as a point cloud, without inventing full dimensions. Unsupported associations remain image-only. Repeated views refine backpack-A while the surrounding map continues growing independently. SAM3 can refine an ambiguous mask without blocking mapping or control."],
  ["projection", "Delimit regions in the accumulated map", "growing geometry → partial regions + observed connections", "Further views extend the occupancy/surface products. Spatial processing delimits two partially explored spaces and their connecting passage; retained masks identify their extents in the map. Semantic workers attach living-area and kitchen hypotheses from the supporting views. Labels do not create these regions or prove connectivity. Object tracks and located_in relations retain separate evidence; a moving backpack is not baked permanently into room structure."],
  ["naming", "Assign names without changing spatial identity", "World Master annotation · stable region IDs", "The World Master reviews the mapped regions and supporting views, then names space-1 Living area and space-2 Kitchen. Either region may still be partial. Names help resolve mission language; they do not make a region complete, unique or safe. More observations can refine the same extent, and a later rename leaves identity and accepted historical findings intact."],
  ["findings", "Compile the next step and report both findings", "one evidence set → two independently reviewed outcomes", "The adapter compiles both mission summaries and new evidence into one frozen Eve context. Navigator proposes a backpack match and an obstructed-passage report. Both cite obs-2, but each must satisfy its own criterion. These are typed draft findings, not trusted facts or completion flags. The reviewer checks the proposed place identities, object match and last-seen location separately from the passage extent and obstruction evidence. Competing kitchen candidates require more evidence or clarification; the agent cannot silently select one."],
  ["mission-finished", "Accept findings and close each mission", "review → durable objective progress → safe closure", "For these review policies, the World Master submits each accepted finding through Missions.recordObjectiveProgress. The backpack mission may close while passage review remains pending. Finding an obstruction successfully completes the inspection; clearing it was never requested. Unknown visibility cannot complete inspection, and a clear report would require evidence covering the entire named region. Neither outcome authorizes traversal."],
  ["resume", "Recover the world and resume useful work", "world state and accepted progress survive an Eve reset", "A restarted agent reloads both assignments, accepted findings, retained observations, map checkpoints and execution receipts. It reconstructs outstanding work from those records. Draft reasoning is not objective progress. If Go2 has lost localization, the map remains readable but spatial actions wait for qualified localization or a new frame."],
];

export const v0FlowCode = {
  mission: `// Mission creation inputs; no robot commands or database writes run on this page.
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const backpackSpec = {
  description: "Find the blue backpack in the living area and report where it was last seen.",
  objectives: [{
    id: "locate", description: "Identify the requested backpack and report its evidenced location.",
    dependsOn: [], optional: false,
    criterion: { tag: "located", value: {
      description: "Blue backpack",
      searchArea: { tag: "description", value: { text: "the living area" } }, // no room entity or coordinates yet
      maxAgeMs: 60_000, review: "world_master", // example acceptance policy; not an automatic detector verdict
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"),
} satisfies MissionSpec;
const passageSpec = {
  description: "Inspect the passage to the kitchen and report anything obstructing it.",
  objectives: [{
    id: "inspect", description: "Report whether the defined passage is obstructed, with evidence.",
    dependsOn: [], optional: false,
    criterion: { tag: "inspected", value: {
      region: { tag: "description", value: { text: "the passage to the kitchen" } },
      question: "Is anything obstructing this passage?", // finding the intended passage is part of the work
      maxAgeMs: 60_000, review: "world_master", // obstructed can be a successful inspection result
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"),
} satisfies MissionSpec;
const creationInputs = [
  { id: "mission-1", spec: backpackSpec },
  { id: "mission-2", spec: passageSpec },
] satisfies Parameters<Missions["createMission"]>[0][];
// Both PlaceTargets are descriptions: no living-area, kitchen or passage IDs exist at assignment.
// Mission creation records intent. It does not require resolving these places or supply a destination.
// No Unit, route, viewpoint, motor speed or execution duration is part of either MissionSpec.
// Not found yet is not success; declaring a bounded search exhausted needs a separate coverage criterion.`,
  team: `const missionAssignments = [
  { missionId: "mission-1", agentId: "navigator", active: true, expectedRevision: 1n },
  { missionId: "mission-2", agentId: "navigator", active: true, expectedRevision: 1n },
] satisfies Parameters<WorldMasters["assignMission"]>[0][];
const unitGrant = {
  unitId: "go2-01", agentId: "navigator", actionNames: ["navigate@1", "approach@1"],
  expectedRevision: 0n, expiresAt: at("2026-09-19T12:06:00Z"),
} satisfies Parameters<WorldMasters["assignUnit"]>[0];
// World Master submits creation, assignment and Unit grant as separate operations.
// Each mission is now at revision 2; this first Unit grant produces assignment revision 1.
// Participation is not command authority. Command authority is not a physical execution reservation.
// Both assignments share one Eve agent loop and automatically prepared Unit awareness.
// The grant does not turn a room name into a geofence. Local exploration limits are independently enforced.`,
  prepared: `// Decision-context excerpt, not another writable world table.
const initialContext = {
  agentId: "navigator", unitId: "go2-01",
  missionLogSummary: [
    { missionId: "mission-1", objectiveId: "locate", progress: "pending", need: "accepted match and location" },
    { missionId: "mission-2", objectiveId: "inspect", progress: "pending", need: "passage inspection" },
  ],
  relevantKnowledge: {
    unresolvedPlaces: ["the living area", "the passage to the kitchen"],
    placeCandidateIds: [], backpackCandidateIds: [], // nothing has been identified from these descriptions yet
    nextInvestigation: "inspect current sensor evidence", // not a command to drive to an unknown destination
  },
};
// The first useful step is observation, not navigateTo(kitchen). No geometry is invented for a place name.
// Read retained evidence before revisiting locations; do not treat old negative detections as exhaustive.
// Exploration chooses an information gap. Navigation reaches a viewpoint. Perception supplies evidence.
// A second mission stays active while attention is on the first; focus changes no deadlines.`,
  discovery: `// Resource handles below stand for verified retained bytes, not fabricated hashes or live sensor access.
declare const retained: {
  occupancy1: ResourceRef; surface1: ResourceRef; occupancy2: ResourceRef; surface2: ResourceRef;
  camera13: ResourceRef; camera14: ResourceRef; lidar14: ResourceRef; backpackSurface: ResourceRef;
  calibration: ResourceRef; fusionReceipt: ResourceRef;
  livingMask: ResourceRef; kitchenMask: ResourceRef; passageMask: ResourceRef; evidenceIndex: ResourceRef;
};
declare const mapperPackage: PackagePin; // exact installed mapping implementation
const firstCheckpoint = {
  mapId: "local-map-1", frameId: "go2/map:epoch-7", revision: 1n,
  layers: [
    { kind: "occupancy", resource: retained.occupancy1, observedAt: at("2026-09-19T12:00:05Z") },
    { kind: "surface", resource: retained.surface1, observedAt: at("2026-09-19T12:00:05Z") },
  ], // outputs of repeated range + motion estimation, not a semantic detector result
} satisfies MapCheckpoint & { layers: MapLayer[] };
// Retained obs-layout-1 indexes the acquisitions, pose history and calibration behind this checkpoint.
// Grid payload defines origin, resolution and occupancy encoding; unknown cells remain unknown.
// No room labels or room entities are needed for this map to exist and keep growing.
// Planar ranging can support a floor map; it cannot supply a backpack's full 3D dimensions.
// A qualified viewpoint selector proposes a reachable pose beside, not inside, unknown space.
// If exploration permission or qualified navigation is absent, observe in place or ask for help.`,
  navigation: `// Example pose supplied by the local viewpoint selector after validating the mapped neighborhood.
const navigationInput = {
  executionId: "d0cb5435-aed4-45b5-933c-fb47b29cff42", // stable retry identity for this attempt
  unitId: "go2-01", assignment: { agentId: "navigator", revision: 1n },
  mapId: firstCheckpoint.mapId, basisMapRevision: firstCheckpoint.revision,
  frameId: firstCheckpoint.frameId,
  targetPose: { positionM: { x: 1.2, y: -0.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  acceptBy: at("2026-09-19T12:00:08Z"), // admission/claim deadline, not a command duration
  mission: { missionId: "mission-2", objectiveId: "inspect", expectedRevision: 2n },
} satisfies NavigateRequest;
// ActionRequests.requestNavigate normalizes this as { tag: "navigate", value: navigationInput }.
// Admission checks the current map/localization, ready objective, Unit grant and exploration limits.
// Coordinates illustrate an adapter-selected pose; they are not inferred from the words living area or kitchen.
// This adapter uses a ground-projected navigation pose; z = 0 here is not a command for Go2 body height.
// Claim reserves Go2 across all missions; robot-local planning and obstacle checks run at their own rates.
// accepted → claimed → local motion → measured arrival at 12:00:12 → confirmed safe-closure receipt.
// Retry by executionId. An unknown physical outcome holds the reservation until reconciled.
// Linking an action to an inspection explains its purpose; arrival does NOT satisfy inspected.
// Live obstacle and footprint checks remain robot-local; persisted occupancy can be incomplete or stale.`,
  inputs: `const cameraFrame = {
  streamId: "go2/camera", sessionId: "camera-7", sequence: 141n, capturedAt: at("2026-09-19T12:00:13Z"),
} satisfies FrameRef;
const fusionImage = { ...cameraFrame, sequence: 151n, capturedAt: at("2026-09-19T12:00:14Z") };
const lidarFrame = {
  streamId: "go2/lidar", sessionId: "lidar-7", sequence: 99n, capturedAt: at("2026-09-19T12:00:14.010Z"),
} satisfies FrameRef;
declare const acquisitionTransforms: TransformSample[]; // calibrated, timestamped transforms used for this pair
// Typed facet excerpts; ingestion additionally supplies authenticated producer/association and localMapId.
const candidateObservation = {
  id: "obs-1", inputs: [cameraFrame], retained: [retained.camera13],
  semantic: { observedAt: cameraFrame.capturedAt, value: {
    hypotheses: [{ label: "backpack", score: 0.94 }, { label: "blue", score: 0.91 }],
  } },
} satisfies Pick<ObservationInput, "id" | "inputs" | "retained" | "semantic">;
const locatedObservation = {
  id: "obs-2", inputs: [fusionImage, lidarFrame], supersedes: ["obs-1"],
  retained: [retained.camera14, retained.lidar14, retained.backpackSurface, retained.calibration, retained.fusionReceipt],
  transforms: acquisitionTransforms,
  geometry: { observedAt: lidarFrame.capturedAt, value: { tag: "pointCloud", value: {
    frameId: firstCheckpoint.frameId, resource: retained.backpackSurface,
  } } }, // only the associated measured surface; no inferred full box or height
} satisfies Pick<ObservationInput, "id" | "inputs" | "retained" | "transforms" | "supersedes" | "geometry">;
// The fusion receipt retains timing checks, intrinsics/distortion, extrinsics and pose history used.
// Reject inconsistent/occluded associations; one nearest LiDAR return is not sufficient.
// Association binds both observations to backpack-A. More views refine it, not create same-label duplicates.
// obs-3 retains the wider passage view; obs-layout-2 retains the accumulated layout/room evidence at 12:00:18.
// Without qualified association, keep obs-1 as image evidence and do not submit unsupported metric geometry.`,
  projection: `const expandedCheckpoint = {
  mapId: firstCheckpoint.mapId, frameId: firstCheckpoint.frameId, revision: 2n, parentRevision: 1n,
  layers: [
    { kind: "occupancy", resource: retained.occupancy2, observedAt: at("2026-09-19T12:00:18Z") },
    { kind: "surface", resource: retained.surface2, observedAt: at("2026-09-19T12:00:18Z") },
  ],
} satisfies MapCheckpoint & { layers: MapLayer[] };
const mappedRegions = [
  { entityId: "space-1", mask: retained.livingMask, coverage: "partial" as const },
  { entityId: "space-2", mask: retained.kitchenMask, coverage: "partial" as const },
  { entityId: "passage-1", mask: retained.passageMask, coverage: "bounded" as const },
].map(({ entityId, mask, coverage }) => ({
  entityId, mapId: expandedCheckpoint.mapId, expectedRevision: 0n,
  extent: { mapRevision: 2n, occupancyResourceId: retained.occupancy2.id, mask, coverage },
  observationIds: ["obs-layout-1", "obs-layout-2", "obs-3"],
})) satisfies Parameters<WorldMemory["projectRegion"]>[0][];
// Each mask aligns with occupancy2. Region IDs are created through trusted association, not from room names.
// projectRegion commits revision 1 for each region after validating the retained mask and checkpoint.
// Semantic observations propose living area for space-1 and kitchen for space-2; neither assigns the name.
// Evidenced relations: backpack-A located_in space-1; passage-1 connects space-1 and space-2.
// Obstruction evidence overlaps the passage extent; this does not certify passage traversability.
// Changing objects remain independently tracked; static mapping must handle dynamic returns/occupancy decay.
// Further views refine the same regions. Moving out of view never erases backpack-A.`,
  naming: `const regionNames = [
  { entityId: "space-1", expectedRevision: 1n, name: "Living area" },
  { entityId: "space-2", expectedRevision: 1n, name: "Kitchen" },
] satisfies Parameters<WorldMemory["nameRegion"]>[0][];
// World Master submits these annotations after reviewing views and map extents at 12:00:20.
// Each region advances to revision 2; authenticated identity and server time populate RegionName.
// Names do not replace semantic hypotheses or alter masks, map frame, evidence or entity identity.
// passage-1 stays unnamed at revision 1; its connection to Kitchen can resolve the mission description.
const namedCheckpoint = {
  ...expandedCheckpoint, revision: 3n, parentRevision: 2n, // reuse unchanged spatial layer resources
  regionVersions: [
    { entityId: "space-1", revision: 2n }, { entityId: "space-2", revision: 2n },
    { entityId: "passage-1", revision: 1n },
  ],
  evidenceIndex: retained.evidenceIndex, producer: mapperPackage,
} satisfies LocalMapManifest;
// Retain all referenced bytes/archived components, then WorldMemory.commitMapRevision advances head to 3.
// Another Kitchen label is allowed. Ambiguous mission references still need evidence or clarification.
// An assigned name helps interpret intent; only objective review can accept a mission finding.`,
  findings: `// At 12:00:22, context includes both missions, candidate places, their connection and the retained evidence.
const backpackFinding = {
  tag: "located", value: {
    entityId: "backpack-A", searchAreaId: "space-1", searchAreaRevision: 2n, // assigned name plus evidenced extent
    observationIds: ["obs-1", "obs-2", "obs-layout-1", "obs-layout-2"],
    description: "Blue backpack last seen at 12:00:14 on the living-area side of the opening.",
  },
} satisfies MissionFinding;
const passageFinding = {
  tag: "inspected", value: {
    regionId: "passage-1", regionRevision: 1n, conclusion: "obstructed", // exact inspected extent, not a moving label
    obstructionEntityIds: ["backpack-A"], observationIds: ["obs-2", "obs-3", "obs-layout-2"],
    description: "A backpack occupies the inspected passage. This report does not certify a safe route.",
  },
} satisfies MissionFinding;
// Navigator presents these drafts for review through Eve; they do not mutate world truth.
// Review place identity as well: does space-1 match the living area, and does passage-1 lead to the intended kitchen?
// Multiple plausible kitchens → ask which one; no supported match → keep investigating within granted limits.
// Same obs-2, different checks: requested-object match/location versus obstruction within the region.
// Models can help compare evidence. Their confidence is not mission acceptance or safety clearance.
// If a view remains inconclusive, report unknown and investigate another safe viewpoint or ask for help.
// Context, selected evidence, reasoning and receipts share trace correlation under the capture policy.`,
  "mission-finished": `const progressSubmissions = [
  { missionId: "mission-1", objectiveId: "locate", evidence: { tag: "finding", value: backpackFinding } },
  { missionId: "mission-2", objectiveId: "inspect", evidence: { tag: "finding", value: passageFinding } },
] satisfies Parameters<Missions["recordObjectiveProgress"]>[0][];
// World Master reviews and submits each independently at 12:00:25 and 12:00:26.
// Agent attempts to self-approve these reviewed findings are rejected, regardless of Unit authority.
// Load cited records; check readiness, criterion, evidence access/age and authority.
// Review grounds each place description in discovered entities and evidence; an ambiguous referent stays pending.
// Accepted findings retain region revisions and evidence; later renaming/refinement cannot change that proof.
// The original description in MissionSpec remains unchanged.
// Persist accepted finding + objective progress + authenticated reviewer audit atomically.
// mission-1: locate completed → closing → succeeded; mission-2 can still be awaiting its own review.
// mission-2: inspect completed with obstructed → closing → succeeded after every linked attempt is safe.
// The navigation receipt is already safely closed. Pending/unknown physical work would hold closing.
// Obstruction is an inspection result, not mission failure. Removing it requires different authorized work.
// Repeated submission returns the retained proof; it cannot overwrite acceptance or increment progress.`,
  resume: `const recovered = {
  agentId: "navigator", missionIds: ["mission-1", "mission-2"],
  completedObjectives: ["mission-1/locate", "mission-2/inspect"], // read accepted progress, not conversation claims
  localMapId: "local-map-1", headRevision: 3, entityIds: ["backpack-A", "space-1", "space-2", "passage-1"],
  regionNames: { "space-1": "Living area", "space-2": "Kitchen" }, // reload names and archived extent revisions too
  localization: "relocalization_required", // recovery of map bytes does not prove the current Unit pose
}; // both mission outcomes, accepted findings, evidence and safe-closure receipts are durable
// A reset before review leaves place hypotheses and the objective unaccepted; reconstruct from retained evidence.
// If evidence has aged beyond the review policy, gather fresh evidence before accepting the finding.
// Reconcile receipts before new motion. Reconcile observations beyond checkpoint coverage by their IDs.
// No useful pending work → idle, with relevant changes/deadlines still observed; no repeated LLM polling.
// Additional Units can retain their own local frames; these outcomes require no perfect global alignment.`,
};
