// Website specification only. No worker, reducer, driver or SDK schema imports this file.
import { missionViewCode } from "./mission-model-content.mjs";
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
} // No SLAM, blob IO or inference runs in the transaction.
// A trusted storage/mapper boundary verifies retained bytes before the commit. Reducers verify its receipt.
// Observation ingestion has its own idempotent commits; map checkpoints record their exact input coverage.
// Restore persisted state after restart; require new localization evidence before spatial action.`;

export const coordinationCode = `interface AgentCoordination {
  sendMessage(input: { id: string; missionId: string; toAgentId: string; content: string }): Promise<void>; // authenticate sender, validate participants and retain bounded messages
} // No subscription-management API: Nemeia derives awareness from Unit assignments and world-managed policy.
// Messages support coordination; they cannot grant control or declare objectives complete.`;

export function objectPlanningCode(id, code) {
  if (id === "evidence") return code.replace('  producerSession: t.string()', '  localMapId: t.string(), // originating local-map context, validated against producer authority; retain even for unlocated evidence\n  producerSession: t.string()');
  if (id === "action") return code
    .replace('mission and ready approached objective this attempt advances', 'mission and ready objective this attempt serves; investigation actions do not themselves complete it')
    .replace('  expectedGeometryVersion: t.u64()', '  expectedGeometryFrameId: t.string(), // identify the exact frame-qualified target facet; require a usable transform to the executor\n  expectedGeometryVersion: t.u64()')
    .concat('\n// For approached, require the specified target/standoff. For located or inspected, require a target\n// in the authorized investigation area or a verified adjacent viewpoint; reject unrelated motion.\n// This action can support an investigation, but only the objective criterion determines progress.');
  return code;
}

export const v0Principles = [
  ["Durable world state", "shared knowledge independent of agent memory", "Observations accumulate into durable entities, evidence and progressive local maps. Mission progress, assignments and execution receipts share this world state. Agents read relevant projections; they do not own separate copies of the world. Persistence is a platform responsibility and survives worker restarts or Eve session resets.", "observe → commit → refine → recover → continue"],
  ["Progressive local map", "accumulated knowledge, not just the latest camera frame", "Keep known entities and last-seen observations when they leave view. Add geometry only when supported; retain unlocated and image-only observations without placing them at an invented origin. Refine the same locally associated entity when evidence supports continuity. Repeated delivery is idempotent; changed labels do not create new identities. Preserve removed/stale/unknown distinctions. Geometry, classification and visibility have independent acquisition times. A map may contain semantic observations without a complete mesh or occupancy grid.", "known but not currently seen ≠ absent · unknown position ≠ [0, 0, 0]"],
  ["Durability and recovery", "world persistence is independent of Eve history", "Persist current world rows, retained supporting observations and versioned map checkpoints. Store large geometry and optional native estimator exports as immutable resources. Validate retained bytes before advancing a checkpoint head atomically; preserve its exact evidence coverage. After a crash, restore the last committed head and reconcile later retained observations by their IDs, without pretending an audit log is a full scene recorder. A mapper that cannot resume its native state starts a new frame epoch until it can relocalize. An Eve reset changes conversation history, not map, mission, entity or execution identity.", "restored map ≠ localized Unit · durable world ≠ conversation transcript"],
  ["Automatic Unit awareness", "direct observations first; radius when usable", "Nemeia derives agent context from assigned Units. It always includes their permitted observations, mission dependencies and pending outcomes. A world-managed radius adds nearby shared state only when metric positions can be compared reliably. Discovery and unlocated evidence remain outside radius filtering. No agent-managed subscriptions or preselected entity list. As context grows, keep bounded relevant projections and authorized detail reads; absence from a prompt never deletes durable world knowledge.", "Unit observations + usable local neighborhood + mission dependencies → context"],
  ["Local frames and reconciliation", "one logical world; independent spatial views", "Every metric estimate names its frame and acquisition time. Register fresh frame identities after coordinate resets; never reinterpret old coordinates. Local sensor transforms remain necessary when fusing measurements. Cross-Unit alignment is optional: a qualified localization system publishes evidence-backed relationships between frames when available. Keep original local evidence and identity provenance; aligning maps does not prove two tracks are the same object. Agents can share non-spatial mission findings without aligned coordinates.", "local frame A · local frame B · evidence-backed relationship"],
  ["Spatial requirements belong to actions", "missing geometry blocks only dependent work", "Reading evidence and refining the world remain useful without global positioning. An approach action needs fresh local target geometry, a valid transform into the executor's frame and qualified local navigation. Sending another Unit to that target additionally needs usable alignment or independent reacquisition. A restored map, a semantic label or a successful model response cannot supply those guarantees. Only the operations that depend on alignment need to wait for it.", "local observation ≠ navigable geometry ≠ cross-Unit alignment"],
];

export function renderWorldPlan({ section, proseRow }) {
  return section("local-world", "02a", "World memory & local maps", "The world retains accumulated knowledge across observations and restarts. Units can maintain independent spatial views and reconcile them through qualified frame relationships.", `<div class="abstraction-list">${v0Principles.map((row, i) => proseRow(i, ...row)).join("\n")}</div>`);
}

// Explicit planning deltas over the existing checked SDK scaffold. Do not edit runtime .ts files.
export function plannedTables(tables) {
  const removeColumn = (name, column) => { const table = tables.find(item => item.name === name); table.columns = table.columns.filter(([id]) => id !== column); };
  const describe = (name, column, description) => { tables.find(table => table.name === name).columns.find(([id]) => id === column)[2] = description; };
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
  describe("member", "role", "One role per identity; use separate worker credentials.");
  describe("unit_assignment", "unitId", "PK. Controllable entity; one command-owning agent at a time.");
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
      ["manifest", "ResourceRef", "Retained LocalMapManifest: chunk references, exact evidence coverage and optional mapper state."],
      ["recordedAt", "Timestamp", "Commit time. Does not make old observations or localization fresh."],
    ] },
  ];
  return [...tables.filter(table => table.name !== "agent_subscription"), ...additions];
}

export const v0ExampleRows = [
  ["mission", "Find the backpack · inspect the passage", "search + inspection · shared world", "The World Master asks Navigator to find a blue backpack and inspect the passage to the kitchen. The living area and passage are already named, bounded regions in the local map; the backpack has no known entity or location. If those regions are ambiguous, resolve them before accepting the missions. Both objectives use explicit World Master review of evidence-backed findings."],
  ["team", "Assign Navigator and grant Go2", "one mission log · one Unit · separate authority", "The World Master creates both missions, assigns them to Navigator and separately grants Go2 control. Nemeia derives awareness from Go2 observations, its usable local neighborhood and both mission dependencies. Neither assignment starts the robot or creates a separate Eve loop."],
  ["prepared", "Choose an investigation from the mission log", "read known evidence → identify a gap → choose a viewpoint", "Navigator reads both assignments. Existing observations do not establish a backpack match, and the passage is partly occluded. Investigating the kitchen doorway can help both missions. Exploration chooses which missing information to pursue; navigation gets Go2 to a useful viewpoint. Neither behavior is itself a mission type."],
  ["navigation", "Navigate to a useful viewpoint", "agent intent → admission → local planner → measured receipt", "A recent observation locates the kitchen doorway in Go2’s local frame. Navigator requests approach@1 under the inspection objective. The controller chooses a safe path and local stopping pose; it does not blindly follow the LLM. If the bound action cannot provide a useful, safely reachable viewpoint, report it unavailable and reconsider. Arrival only enables inspection; it does not complete it."],
  ["inputs", "Discover a candidate while inspecting", "camera candidate → associated depth → wider view", "At the viewpoint, YOLOE detects a blue backpack candidate. Qualified camera/depth association adds local geometry; a wider observation shows how the object occupies the passage. Perception keeps committing evidence while Navigator is reasoning. A label is not an accepted identity, and the absence of detections is not proof of a clear passage."],
  ["projection", "Retain evidence and refine the map", "one discovered entity · independent facets · durable checkpoints", "Association creates backpack-A and refines it with measured local geometry. Retain exact acquisitions and resources before publishing the map checkpoint. Moving out of view does not erase the entity. Camera viewpoints and retained evidence help reconstruct what was inspected; they do not automatically prove complete search coverage."],
  ["findings", "Compile the next step and report both findings", "one evidence set → two independently reviewed outcomes", "The adapter compiles both mission summaries and new evidence into one frozen Eve context. Navigator proposes a backpack match and an obstructed-passage report. Both cite obs-2, but each must satisfy its own criterion. These are typed draft findings, not trusted facts or completion flags. The reviewer checks identity and last-seen location separately from obstruction evidence."],
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
      description: "Blue backpack", searchAreaId: "living-area", // resolve the search area, not the unknown object
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
      regionId: "kitchen-passage", question: "Is anything obstructing this passage?",
      maxAgeMs: 60_000, review: "world_master", // obstructed can be a successful inspection result
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"),
} satisfies MissionSpec;
const creationInputs = [
  { id: "mission-1", spec: backpackSpec },
  { id: "mission-2", spec: passageSpec },
] satisfies Parameters<Missions["createMission"]>[0][];
// The bounded kitchen-passage region is inside living-area in this example.
// These are existing region entities, not invented global coordinates or an existing backpack target.
// No Unit, route, viewpoint, motor speed or execution duration is part of either MissionSpec.
// Not found yet is not success; declaring a bounded search exhausted needs a separate coverage criterion.`,
  team: `const missionAssignments = [
  { missionId: "mission-1", agentId: "navigator", active: true, expectedRevision: 1n },
  { missionId: "mission-2", agentId: "navigator", active: true, expectedRevision: 1n },
] satisfies Parameters<WorldMasters["assignMission"]>[0][];
const unitGrant = {
  unitId: "go2-01", agentId: "navigator", actionNames: ["approach@1"],
  expectedRevision: 0n, expiresAt: at("2026-09-19T12:06:00Z"),
} satisfies Parameters<WorldMasters["assignUnit"]>[0];
// World Master submits creation, assignment and Unit grant as separate operations.
// Each mission is now at revision 2; this first Unit grant produces assignment revision 1.
// Participation is not command authority. Command authority is not a physical execution reservation.
// Both assignments share one Eve agent loop and automatically prepared Unit awareness.`,
  prepared: `// Decision-context excerpt, not another writable world table.
const initialContext = {
  agentId: "navigator", unitId: "go2-01",
  missionLogSummary: [
    { missionId: "mission-1", objectiveId: "locate", progress: "pending", need: "accepted match and location" },
    { missionId: "mission-2", objectiveId: "inspect", progress: "pending", need: "passage inspection" },
  ],
  relevantKnowledge: {
    backpackCandidateIds: [], // no match established; retained prior observations are still available
    passageVisibility: "partial", // unknown behind the occlusion is not clear
    landmarkId: "kitchen-doorway", // a known, freshly located entity near a useful viewpoint
    frameId: "go2/map:epoch-7", navigation: "qualified", // assumed measured local capability in this scenario
  },
};
// Navigator chooses passage inspection first because that viewpoint can also help the backpack search.
// Read retained evidence before revisiting locations; do not treat old negative detections as exhaustive.
// Exploration chooses an information gap. Navigation reaches a viewpoint. Perception supplies evidence.
// A second mission stays active while attention is on the first; focus changes no deadlines.`,
  navigation: `const approachInput = {
  executionId: "d0cb5435-aed4-45b5-933c-fb47b29cff42", // stable retry identity for this attempt
  unitId: "go2-01", assignment: { agentId: "navigator", revision: 1n },
  targetId: "kitchen-doorway", standoffM: 0.8, // chosen investigation action, not a mission outcome
  expectedGeometryFrameId: "go2/map:epoch-7", expectedGeometryVersion: 8n,
  acceptBy: at("2026-09-19T12:00:08Z"), // fresh target evidence acquired at 12:00:05
  mission: { missionId: "mission-2", objectiveId: "inspect", expectedRevision: 2n },
} satisfies ApproachRequest;
// ActionRequests.requestApproach receives this input; the example performs no IO.
// Admission checks authority, ready objective, permitted target scope, fresh geometry and local capability.
// Claim reserves Go2 across all missions; robot-local planning and obstacle checks run at their own rates.
// accepted → claimed → local motion → measured arrival at 12:00:12 → confirmed safe-closure receipt.
// Retry by executionId. An unknown physical outcome holds the reservation until reconciled.
// Linking an action to an inspection explains its purpose; arrival does NOT satisfy inspected.
// The 0.8 m standoff is not an obstacle-clearance guarantee or a command to cross the passage.`,
  inputs: `// Observation excerpts; full ingestion also carries source IDs, resources and calibration receipts.
const candidateObservation = {
  id: "obs-1", unitId: "go2-01", producerSession: "perception-7", trackId: "track-12",
  acquiredAt: "2026-09-19T12:00:13Z",
  hypotheses: [{ label: "backpack", score: 0.94 }, { label: "blue", score: 0.91 }],
}; // image evidence alone does not fabricate a metric position or prove identity
const locatedObservation = {
  id: "obs-2", acquiredAt: "2026-09-19T12:00:14Z", frameId: "go2/map:epoch-7",
  centerM: [2.4, -0.6, 0.35], sizeM: [0.4, 0.3, 0.7], // illustrative qualified local measurements
}; // association/calibration links the depth to the candidate; labels alone are insufficient
const passageObservation = {
  id: "obs-3", acquiredAt: "2026-09-19T12:00:18Z",
  subjectId: "kitchen-passage", evidence: "wide view of the backpack occupying the passage",
}; // prose abbreviates the retained image/depth evidence; it is not an authoritative geometry field
// A lower-frequency SAM3 refinement may help an ambiguous mask; no model is mandatory on every frame.
// Unknown calibration preserves the camera evidence but blocks unsupported spatial claims.`,
  projection: `const progression = [
  { revision: 1, entityId: "backpack-A", observationId: "obs-1", spatialState: "unlocated" },
  { revision: 2, entityId: "backpack-A", observationId: "obs-2", frameId: "go2/map:epoch-7" },
  { revision: 3, entityId: "kitchen-passage", observationId: "obs-3", frameId: "go2/map:epoch-7" },
]; // checkpoint excerpt; association established one candidate identity, not a new object per frame
const head = {
  mapId: "local-map-1", rootFrameId: "go2/map:epoch-7", revision: 3, manifestId: "map-manifest-3",
}; // publish retained bytes first, then atomically advance the durable checkpoint head
// Evidence supports a candidate in a local region; the World Master has not accepted either finding yet.
// Map manifests preserve acquisitions, source frames and checkpoint coverage; audit is not a map backup.
// Rejected candidates and inspected viewpoints can be revisited from retained evidence and Eve reasoning.
// Losing view of backpack-A changes visibility/freshness, not the retained entity or last-seen evidence.`,
  findings: `// At 12:00:22, the next frozen context includes both pending missions and obs-1, obs-2, obs-3.
const backpackFinding = {
  tag: "located", value: {
    entityId: "backpack-A", observationIds: ["obs-1", "obs-2"],
    description: "Blue backpack last seen in the kitchen passage at 12:00:14, in Go2’s local map.",
  },
} satisfies MissionFinding;
const passageFinding = {
  tag: "inspected", value: {
    regionId: "kitchen-passage", conclusion: "obstructed",
    obstructionEntityIds: ["backpack-A"], observationIds: ["obs-2", "obs-3"],
    description: "A backpack occupies the inspected passage. This report does not certify a safe route.",
  },
} satisfies MissionFinding;
// Navigator presents these drafts for review through Eve; they do not mutate world truth.
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
// Load cited records; check readiness, exact criterion, area/region scope, evidence access and age.
// Persist accepted finding + objective progress + authenticated reviewer audit atomically.
// mission-1: locate completed → closing → succeeded; mission-2 can still be awaiting its own review.
// mission-2: inspect completed with obstructed → closing → succeeded after every linked attempt is safe.
// The navigation receipt is already safely closed. Pending/unknown physical work would hold closing.
// Obstruction is an inspection result, not mission failure. Removing it requires different authorized work.
// Repeated submission returns the retained proof; it cannot overwrite acceptance or increment progress.`,
  resume: `const recovered = {
  agentId: "navigator", missionIds: ["mission-1", "mission-2"],
  completedObjectives: ["mission-1/locate", "mission-2/inspect"], // read accepted progress, not conversation claims
  localMapId: "local-map-1", headRevision: 3, entityIds: ["backpack-A", "kitchen-passage"],
  localization: "relocalization_required", // recovery of map bytes does not prove the current Unit pose
}; // both mission outcomes, accepted findings, evidence and safe-closure receipts are durable
// A reset before review leaves the objective pending; reconstruct a draft from retained evidence.
// If evidence has aged beyond the review policy, gather fresh evidence before accepting the finding.
// Reconcile receipts before new motion. Reconcile observations beyond checkpoint coverage by their IDs.
// No useful pending work → idle, with relevant changes/deadlines still observed; no repeated LLM polling.
// Additional Units can retain their own local frames; these outcomes require no perfect global alignment.`,
};
