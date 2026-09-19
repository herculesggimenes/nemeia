// Website specification only. No worker, reducer, driver or SDK schema imports this file.
import { missionViewCode } from "./mission-model-content.mjs";
export const scopeCode = `interface ReadScope {
  worldId: string; // World Master grants access to this world in the single-agent v0 deployment
} // Interest is derived automatically; no entity allowlist or agent-managed subscription.
interface AwarenessPolicy {
  radiusM?: number; // optional world-managed radius in a usable metric frame; not sensor coverage or safety clearance
  minIntervalMs: number; // cap ordinary inference wakes; not a polling requirement
  maxBatchWaitMs: number; // desired batching bound, subject to compute budget
} // Direct Unit observations, mission dependencies and pending outcomes do not depend on a radius.
// World-level visibility is deliberately broad for v0. Restricted multi-user spatial access is later work.
// Grants determine permission. Automatic Unit awareness selects relevant content within that permission.`;

export const objectCode = {
  "mission-view": missionViewCode,
  "world-view": `// Selected planning shape; SDK/JSON adapters are implementation work.
interface WorldView {
  worldId: string; // shared durable domain, not a promise of one coordinate system
  entities: ReadonlyMap<string, EntityView>; // authorized identities and current evidence-backed facets
  localMaps: readonly LocalMapView[]; // one progressive local map in v0; separate maps remain valid later
  units: ReadonlyMap<string, UnitView>; // controllable entities, with the same entity IDs
  missions: ReadonlyMap<string, MissionView>; // intent and verified progress survive an Eve session reset
  agents: ReadonlyMap<string, AgentView>; // one assigned reasoning agent in the v0 example
  relationships: readonly Row<"relation">[]; // configured or evidenced links; not automatic spatial alignment
  executions: readonly Row<"execution">[]; // durable intent and receipts, when an action is used
  actions: readonly Row<"actionBinding">[]; // installed capabilities; unavailable actions carry explicit reasons
  synchronized: boolean; // fresh authorized subscription state, not proof of live localization
} // Read projection over durable world records, never another writable snapshot or Eve memory store.
interface EntityView {
  entity: Readonly<Row<"entity">>; // stable identity; provisional association does not prove global identity
  poses: readonly Row<"pose">[]; // frame-qualified estimates; never force one global pose
  geometries: readonly Row<"geometry">[]; // preserve image-space evidence and local metric estimates separately
  semantic?: Readonly<Row<"semantic">>; // labels do not fabricate positions or refresh geometry
  control?: Readonly<Row<"unitControl">>; // measured local control projection for a Unit
}
interface Affordance {
  unitId: string; targetId?: string; // action-specific target; observation alone need not be spatially located
  evaluatedAt: Timestamp; // evidence continues to age without a new database write
  available: boolean; reasons: readonly string[]; // e.g. target_unlocated or relocalization_required
} // Check only the spatial requirements of this action; admission repeats them against current evidence.`,
  "local-map": `interface LocalMapView {
  map: Readonly<Row<"localMap">>; // durable identity, root frame and committed checkpoint head
  frames: readonly Row<"spatialFrame">[]; // immutable frame identities, including distinct reset epochs
  checkpoint?: Readonly<Row<"mapRevision">>; // absent before the first map checkpoint; observations still persist
  entityIds: readonly string[]; // derived local membership, not an agent subscription or permission list
  unlocatedObservationIds: readonly string[]; // known evidence that cannot yet be positioned in this map
  localization: "localized" | "relocalization_required" | "unavailable"; // derived from current qualified evidence
} // Restoring map bytes does not restore knowledge of the Unit's current position.
interface LocalMapManifest {
  mapId: string; frameId: string; // immutable root frame; no global frame is required
  revision: bigint; parentRevision?: bigint; // immutable checkpoint lineage within this local map
  evidenceIndex: ResourceRef; // retained index of exact input observations/resources and source-session boundaries
  chunks: readonly ResourceRef[]; // complete bounded manifest of retained spatial chunks; unchanged chunks may be reused
  estimatorState?: ResourceRef; // optional versioned native export; not a guarantee of localization after restart
  producer: PackagePin; // exact mapper implementation; calibration/transform provenance stays with its inputs
} // A semantic-only map may have no metric chunks. A point cloud is not automatically navigable free space.
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
  }): Promise<void>; // identical manifest retry returns its revision; otherwise atomically advance head + audit
  readLocalMap(input: { mapId: string; revision?: bigint }): Promise<LocalMapView>; // authorized checkpoint plus current frame-qualified records
} // Planning boundary, not a new microservice. No SLAM, blob IO or inference runs in the transaction.
// A trusted storage/mapper boundary verifies retained bytes before the commit. Reducers verify its receipt.
// Observation ingestion has its own idempotent commits; map checkpoints record their exact input coverage.
// Restore persisted state after restart; require new localization evidence before spatial action.`;

export const coordinationCode = `interface AgentCoordination {
  sendMessage(input: { id: string; missionId: string; toAgentId: string; content: string }): Promise<void>; // later multi-agent use; authenticate sender, validate participants and retain bounded messages
} // No subscription-management API: Nemeia derives awareness from Unit assignments and world-managed policy.
// The single-agent v0 walkthrough does not require agent chat or a coordinator.`;

export function objectPlanningCode(id, code) {
  if (id === "evidence") return code.replace('  producerSession: t.string()', '  localMapId: t.string(), // originating local-map context, validated against producer authority; retain even for unlocated evidence\n  producerSession: t.string()');
  if (id === "action") return code.replace('  expectedGeometryVersion: t.u64()', '  expectedGeometryFrameId: t.string(), // identify the exact frame-qualified target facet; require a usable transform to the executor\n  expectedGeometryVersion: t.u64()');
  return code;
}

export const v0Principles = [
  ["V0 acceptance", "one agent with recoverable world memory", "A World Master creates missions, assigns one agent and grants one Unit. The agent can coordinate several missions through its log. Release success means observations accumulate into durable entities, evidence and a progressive local map that survives worker or Eve resets. Persistence is a platform responsibility, not a mission objective. No second Unit, global map, automatic map merge or navigation action is required. This is the implementation target, not a claim that recovery is already built.", "observe → commit → refine → restart → recover → continue"],
  ["Progressive local map", "accumulated knowledge, not just the latest camera frame", "Keep known entities and last-seen observations when they leave view. Add geometry only when supported; retain unlocated and image-only observations without placing them at an invented origin. Refine the same locally associated entity when evidence supports continuity. Repeated delivery is idempotent; changed labels do not create new identities. Preserve removed/stale/unknown distinctions. Geometry, classification and visibility have independent acquisition times. A complete mesh or occupancy grid is not a v0 requirement.", "known but not currently seen ≠ absent · unknown position ≠ [0, 0, 0]"],
  ["Durability and recovery", "world persistence is independent of Eve history", "Persist current world rows, retained supporting observations and versioned map checkpoints. Store large geometry and optional native estimator exports as immutable resources. Validate retained bytes before advancing a checkpoint head atomically; preserve its exact evidence coverage. After a crash, restore the last committed head and reconcile later retained observations by their IDs, without pretending an audit log is a full scene recorder. A mapper that cannot resume its native state starts a new frame epoch until it can relocalize. An Eve reset changes conversation history, not map, mission, entity or execution identity.", "restored map ≠ localized Unit · durable world ≠ conversation transcript"],
  ["Automatic Unit awareness", "direct observations first; radius when usable", "Nemeia derives agent context from assigned Units. It always includes their permitted observations, mission dependencies and pending outcomes. A world-managed radius adds nearby shared state only when metric positions can be compared reliably. Discovery and unlocated evidence remain outside radius filtering. No agent-managed subscriptions or preselected entity list. As context grows, keep bounded relevant projections and authorized detail reads; absence from a prompt never deletes durable world knowledge.", "Unit observations + usable local neighborhood + mission dependencies → context"],
  ["Local frames and later reconciliation", "one logical world; independent spatial views", "Every metric estimate names its frame and acquisition time. Register fresh frame identities after coordinate resets; never reinterpret old coordinates. Local sensor transforms remain necessary when fusing measurements, but cross-Unit alignment is optional. Later, a qualified localization system can publish versioned relationships between frames. Keep original local evidence and identity provenance; aligning maps does not prove two tracks are the same object. Shared mission facts can cross views before spatial coordinates can.", "local frame A · local frame B · optional evidence-backed relationship"],
  ["Spatial requirements belong to actions", "missing geometry blocks only dependent work", "Reading evidence and refining the world remain useful without global positioning. An approach action needs fresh local target geometry, a valid transform into the executor's frame and qualified local navigation. Sending another Unit to that target additionally needs usable alignment or independent reacquisition. A restored map, a semantic label or a successful model response cannot supply those guarantees. Map persistence and mission reporting do not wait for motion support.", "durable local world first · locally validated motion next · cross-Unit alignment later"],
  ["Delivery sequence", "grow capability without changing the world model", "V0: one agent, one Unit, recoverable local knowledge. Next: additional Units retain separate local views and can share non-spatial mission findings. Then: opportunistic alignment projects selected evidence between compatible frames. Only later add collaborative mapping where concrete missions need it. Multi-agent coordination and automatic map fusion are extensions, not v0 acceptance gates.", "single-agent durability → separate local views → qualified alignment → optional map fusion"],
];

export function renderWorldPlan({ section, proseRow }) {
  return section("v0-world", "02a", "V0 · durable local world", "One agent builds a progressive local map that survives restarts. Perfect spatial alignment and multi-Unit reconciliation are not release gates.", `<div class="abstraction-list">${v0Principles.map((row, i) => proseRow(i, ...row)).join("\n")}</div>`);
}

// Explicit planning deltas over the existing checked SDK scaffold. Do not edit runtime .ts files.
export function plannedTables(tables) {
  const removeColumn = (name, column) => { const table = tables.find(item => item.name === name); table.columns = table.columns.filter(([id]) => id !== column); };
  const describe = (name, column, description) => { tables.find(table => table.name === name).columns.find(([id]) => id === column)[2] = description; };
  removeColumn("world_config", "frameId");
  tables.find(table => table.name === "world_config").columns.push(["awarenessPolicy", "AwarenessPolicy", "World-managed batching and optional metric radius; not agent-owned entity filters."]);
  for (const name of ["pose", "geometry"]) {
    const table = tables.find(item => item.name === name);
    table.columns.unshift(["key", "string", "PK. Canonical tuple [entityId, frameId]; one owning projection pipeline per facet/frame in v0."]);
    describe(name, "entityId", "Indexed entity identity; retain independent local-frame estimates instead of one global value.");
    if (name === "geometry") table.columns.splice(2, 0, ["frameId", "string", "Registered local/sensor frame; 2D geometry still refers to its exact image and remains in pixels."]);
    else describe(name, "frameId", "Registered local reference frame and reset epoch; no shared world frame required.");
    describe(name, "version", "Monotonic revision within this entity/frame facet; action pins identify the frame and revision.");
  }
  describe("geometry", "value", "Geometry with its native frame; image boxes do not imply metric position or navigability.");
  tables.find(table => table.name === "observation").columns.splice(3, 0,
    ["unitId", "string", "Originating Unit derived from authenticated producer scope; preserve across credential/session changes."],
    ["localMapId", "string", "Originating map context checked at ingestion; unlocated evidence remains attached without fabricated coordinates."]);
  describe("world_event", "kind", "Installed domain events, including observation.recorded, map.revision_committed, mission and execution transitions; not every sensor callback.");
  describe("mission", "spec", "MissionSpec: immutable description, objectives and optional deadline/template; no hardware assignment.");
  const progress = tables.find(table => table.name === "mission_credit");
  progress.name = "mission_objective_progress";
  progress.accessor = "missionObjectiveProgress";
  describe("mission_objective_progress", "key", "PK. Canonical tuple [missionId, objectiveId]; one immutable completion proof, not a counter.");
  describe("mission_objective_progress", "evidence", "MissionEvidence loaded and validated by the world; a submitted status or percentage cannot advance progress.");
  describe("mission_objective_progress", "recordedAt", "Completion commit time; pending objectives are derived from the specification and need no row.");
  describe("mission_agent", "agentId", "Indexed agent identity. One agent can hold many assignments; the mission log derives from these rows.");
  const additions = [
    { name: "spatial_frame", accessor: "spatialFrame", columns: [
      ["id", "string", "PK. Immutable namespaced frame identity; use a new ID after an origin reset."],
      ["unitId", "Option<string>", "Originating Unit; future site frames need not belong to one Unit."],
      ["kind", "local_map | odom | body | sensor | site", "Frame role; axes and units follow the documented adapter convention."],
      ["createdAt", "Timestamp", "Registration time, not measurement time. Dynamic transforms remain timestamped evidence."],
    ] },
    { name: "local_map", accessor: "localMap", columns: [
      ["id", "string", "PK. Durable local map identity, independent of agent or Eve session."],
      ["unitId", "string", "Originating Unit for v0; ownership does not imply a globally aligned map."],
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
      ["manifest", "ResourceRef", "Retained LocalMapManifest: chunk references, exact evidence coverage and optional mapper state."],
      ["recordedAt", "Timestamp", "Commit time. Does not make old observations or localization fresh."],
    ] },
  ];
  return [...tables.filter(table => table.name !== "agent_subscription"), ...additions];
}

export const v0ExampleRows = [
  ["mission", "World Master describes two missions", "description + objectives; no hardware choice", "A prior observation has already established backpack-A. The World Master requests a fresh semantic inspection and a separate geometry measurement of that same known target. Two small missions make cross-mission coordination explicit; neither asks the agent to implement world persistence."],
  ["team", "Assign both missions to one agent", "World Master → Navigator's mission log → separate Unit grant", "Assign both missions to Navigator, then grant Go2 capabilities separately. The log contains both assignments. Nemeia derives awareness automatically; Navigator neither selects subscription entity IDs nor creates a separate reasoning loop per mission."],
  ["inputs", "Observe in a local frame", "known target → fresh retained evidence", "A fresh camera detection can update the known backpack without metric depth. A later qualified local spatial pipeline adds geometry. Local calibration is still required; no cross-Unit calibration or global frame is assumed. Observations need validated association to the bound target."],
  ["projection", "Refine and checkpoint the local map", "same entity → newer evidence → immutable map revision", "Commit observations idempotently. Association links the second observation to the same local entity only with supporting evidence. Preserve old observations, exact source frames and retained resources. Publish immutable map bytes before atomically advancing the checkpoint head."],
  ["prepared", "Read the mission log and choose work", "one coordinated step across both assignments", "The adapter freezes a compact log summary, relevant world changes, Unit availability and pending executions before reasoning. Navigator can submit the semantic proof while waiting for geometry. Neither mission is paused by the choice of focus. Detailed evidence remains available through authorized reads."],
  ["resume", "Restart and recover", "durable world survives disposable context", "A new Eve session or restarted worker reloads the same mission, entity identities and map head. Reconcile later retained observations against the checkpoint's evidence index. If localization is lost, keep the map readable and require relocalization or a new frame before spatial action."],
  ["mission-finished", "Record objective progress and close", "two independent outcomes; one agent", "Each evidence submission is checked against its mission's objective, readiness, acquisition age and permissions. The world records progress and closes each mission independently. No physical actions are required in this example. Restart recovery is a separate platform acceptance test, not a mission completion criterion."],
];

export const v0FlowCode = {
  mission: `// Planning fixture using the MissionSpec defined above; no reducer runs here.
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const semanticSpec = {
  description: "Acquire a fresh semantic observation of the selected backpack",
  objectives: [{
    id: "inspect", description: "Record current semantic hypotheses for backpack-A",
    dependsOn: [], optional: false,
    criterion: { tag: "observed", value: {
      entityId: "backpack-A", facet: { tag: "semantic" }, maxAgeMs: 30_000, // example freshness policy, not a universal default
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"), // deadline for this mission, not a controller timeout
} satisfies MissionSpec;
const geometrySpec = {
  description: "Acquire a fresh local geometry measurement of the selected backpack",
  objectives: [{
    id: "measure", description: "Record measured geometry in a known local frame",
    dependsOn: [], optional: false,
    criterion: { tag: "observed", value: {
      entityId: "backpack-A", facet: { tag: "geometry" }, maxAgeMs: 30_000,
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"),
} satisfies MissionSpec;
const creationInputs = [
  { id: "mission-1", spec: semanticSpec },
  { id: "mission-2", spec: geometrySpec },
] satisfies Parameters<Missions["createMission"]>[0][];
// World Master submits these before assignment; creation commits description + objectives + lifecycle.
// backpack-A must already exist. These are input objects, not fabricated persisted Mission rows.`,
  team: `const missionAssignments = [
  { missionId: "mission-1", agentId: "navigator", active: true, expectedRevision: 1n },
  { missionId: "mission-2", agentId: "navigator", active: true, expectedRevision: 1n },
] satisfies Parameters<WorldMasters["assignMission"]>[0][]; // World Master submits each after creation
// Both assignments appear in Navigator's mission log; each mission revision advances independently.
// A separate WorldMasters.assignUnit operation grants Go2 capabilities to Navigator.
// Assignment permits proposals; it does not reserve the Unit or start a physical action.
// Nemeia follows Go2 observations, its local map, all assigned mission deadlines and pending outcomes.
// The agent does not create subscriptions. The world owns awareness and batching policy.
// No radius is needed to retain direct observations; no frame alignment is fabricated.`,
  inputs: `const firstObservation = {
  id: "obs-1", unitId: "go2-01", producerSession: "perception-7", trackId: "track-12",
  acquiredAt: "2026-09-19T12:00:01Z", // exact source sample time; receipt time is separate
  hypothesis: { label: "backpack", score: 0.94 }, // semantic belief, not position or navigability
  metricGeometry: undefined, // retain the observation without guessing depth
};
const measuredGeometry = {
  id: "obs-2", frameId: "go2/map:epoch-7", // later qualified local measurement, not a global map
  acquiredAt: "2026-09-19T12:00:03Z",
  centerM: [2.4, -0.6, 0.35], sizeM: [0.4, 0.3, 0.7], // illustrative measured values
};
// These excerpts are not complete ObservationInput objects: ingestion also requires source IDs,
// calibration/transform provenance and storage receipts. Both observations must associate to backpack-A.
// Matching the label alone never proves identity. Both acquisitions occur after mission readiness.`,
  projection: `const progression = [
  { revision: 1, entityId: "backpack-A", observationId: "obs-1", spatialState: "unlocated" },
  { revision: 2, entityId: "backpack-A", observationId: "obs-2", frameId: "go2/map:epoch-7" },
]; // illustrative checkpoints over one growing local map; no second entity for a refined measurement
const head = {
  mapId: "local-map-1", rootFrameId: "go2/map:epoch-7", revision: 2,
  manifestId: "map-manifest-2", // immutable resource verified retained before the head commit
};
// The manifest records exactly which observations it covers; audit events alone are not a map backup.
// Losing sight of backpack-A changes visibility/freshness, not its identity or retained existence.`,
  prepared: `const context = {
  worldId: "world-demo", agentId: "navigator",
  missionLogSummary: [
    { missionId: "mission-1", objectiveId: "inspect", progress: "pending", evidenceId: "obs-1" },
    { missionId: "mission-2", objectiveId: "measure", progress: "pending", evidenceId: "obs-2" },
  ], // compact illustrative summary; MissionLog.entries exposes full MissionViews on authorized read
  localMaps: [{ mapId: "local-map-1", revision: 2, frameId: "go2/map:epoch-7" }],
  knownEntities: ["backpack-A"], // derived relevant content, not a configured entity subscription
  unavailableActions: [{ name: "approach@1", reason: "navigation_not_qualified" }],
}; // both missions remain visible; selecting one does not hide the other
// Evidence is only a candidate until recordObjectiveProgress validates it.
// Eve reads a frozen /world projection. New observations coalesce for a later useful step.
// An omitted entity in a bounded context is not deleted from the durable map.`,
  resume: `const recovered = {
  agentId: "navigator", missionIds: ["mission-1", "mission-2"], // reload both assignments and any recorded progress
  localMapId: "local-map-1", headRevision: 2, // restore the last committed retained checkpoint
  entityIds: ["backpack-A"], // accumulated knowledge is still available
  localization: "relocalization_required", // map recovery does not prove the current Unit pose
};
// Reconcile retained observations beyond checkpoint coverage; repeat IDs must not duplicate entities.
// If native mapper state cannot resume, start a new frame epoch; never reuse the old origin blindly.
// Eve history may reset. Reading, reporting and new local evidence can continue without global alignment.`,
  "mission-finished": `const progressSubmissions = [
  { missionId: "mission-1", objectiveId: "inspect",
    evidence: { tag: "observation", value: { observationId: "obs-1" } } },
  { missionId: "mission-2", objectiveId: "measure",
    evidence: { tag: "observation", value: { observationId: "obs-2" } } },
] satisfies Parameters<Missions["recordObjectiveProgress"]>[0][];
// The authenticated agent submits retained proof, not completed=true or a percentage.
// Validate each independently: target association, requested facet, readiness, freshness and authority.
// Valid proof → mission_objective_progress row + audit → active/closing → succeeded once safely closed.
// On restart, reconcile recorded progress first. Old pending evidence may need a fresh acquisition.
// Repeated submissions return existing progress. One mission can finish while another remains active.
// Independently test the release: ingest → refine → restart → restore → deduplicate replay → continue.
// Optional later motion still uses admission, local control, receipts and measured completion.
// Additional Units keep independent local frames until a qualified alignment can reconcile them.`,
};
