// Read-only architecture walkthrough. These snippets are type-checked, never executed by the Site.
export const exampleTimeline = [
  ["Before 12:00", "Mapping, localization and object tracking already running", "No mission-driven inference needed"],
  ["12:00:02–12:00:32", "Current state advances; map checkpoints 42 → 48", "Step 1 reasons over its frozen 12:00:02 view"],
  ["12:00:33–12:00:45", "Fresh admission, local navigation, continuous perception", "One pose request; waits for its outcome"],
  ["12:00:46–12:01:16", "New measurements continue; completion event retained", "Step 2 reviews a fresh view and drafts findings"],
  ["12:01:20", "Evidence and authority checked; progress committed", "World Master accepts each finding independently"],
];

export const exampleRows = [
  ["discovery", "Start with an already-running world", "11:59:59 · localized Unit, partial map, tracked objects", "Go2 is already observing under an established mapping session. Range and motion estimation maintain a local map; camera perception and calibrated association maintain object tracks. The living area has a World Master-assigned name. An adjoining mapped space has a kitchen hypothesis, and backpack-A is a partly occluded candidate near the connecting passage. Unknown room meaning is not missing geometry. Times illustrate overlapping work, not measured hardware performance; short IDs stand for retained record/resource identities."],
  ["mission", "Assign work against existing knowledge", "12:00:00 · find the backpack and inspect the passage", "The World Master asks Navigator to find the blue backpack and inspect the kitchen passage. Mission language need not contain entity IDs: the agent can resolve it against the existing map, names, hypotheses and evidence. The kitchen interpretation still needs confirmation. Pre-mission knowledge guides the work; it does not automatically satisfy a criterion requiring fresh evidence after objective readiness."],
  ["team", "Assign Navigator and grant Unit authority", "12:00:01 · one agent, two missions, one Unit", "The World Master assigns both missions to Navigator and grants the installed navigation capability. Assignment wakes reasoning; it does not start cameras, LiDAR or mapping. Automatic Unit awareness supplies the relevant local world and both mission dependencies. Separate local operating limits govern where Go2 may move."],
  ["prepared", "Read the accumulated world before reasoning", "12:00:02 · consistent WorldView + MissionLog", "After delivery delay, the adapter freezes an authorized world projection for this inference step. It already contains Go2's localization, map checkpoint 42, regions, the backpack track, Unit capabilities and both assignments. The agent inspects those records through the world mount. It chooses a viewpoint that could reduce the backpack occlusion and reveal more of the passage; that choice is reasoning, not a field in world knowledge."],
  ["waiting", "Keep perception running during a slow decision", "12:00:02–12:00:32 · one inference, many world updates", "During this 30-second inference, sensors, mapping and perception keep processing. Current world rows advance; the step's frozen view does not. The adapter coalesces replaceable changes and retains important occurrences. It does not enqueue every camera frame as another LLM turn. Sensor acquisition, inference, world publication and durable checkpointing have separate cadences. Exact rates depend on the selected hardware and pipelines; SAM3 remains selective."],
  ["navigation", "Validate the proposed viewpoint against current state", "12:00:33 · old reasoning context, fresh admission", "Navigator proposes a map-derived viewing pose. The request retains the map revision used to choose it, while admission and claim check current localization, permissions, exploration limits and whether that viewpoint is still valid. A newer map revision alone is not a conflict. If the frame reset or the useful viewpoint became invalid, reject the request and reconsider. Otherwise local planning handles changing obstacles without waiting for another LLM response."],
  ["inputs", "Receive fresh evidence while moving and observing", "12:00:34–12:00:45 · measured arrival and a less occluded view", "The local controller navigates to the accepted pose, using live obstacle checks throughout, and records safe closure at 12:00:45. Perception has continued throughout the movement. The new view improves the already-known backpack track and passage evidence. It is not the first camera or LiDAR observation. Retain the measured visible surface rather than inventing full dimensions from a partial view."],
  ["projection", "Refine the existing map and regions", "12:00:45 · same identities, better evidence", "The mapper extends spatial products and the region worker refines the passage extent. Semantic observations provide stronger kitchen evidence. Backpack-A, space-1, space-2 and passage-1 keep their identities. Retained resources and checkpoint lineage preserve the spatial basis of these claims. The example shows selected commits; it does not imply one database checkpoint per sensor acquisition."],
  ["findings", "Prepare a fresh step and draft both findings", "12:00:46–12:01:16 · arrival event + refreshed world view", "A retained execution outcome and useful new evidence make another reasoning step eligible. The adapter prepares a fresh world view, not a backlog of the intermediate views from step 1. Navigator uses the new measurements to draft a backpack location and an obstructed-passage finding. During this second 30-second inference the world continues advancing. Findings report what the cited observations establish, not guaranteed current conditions."],
  ["naming", "Confirm the room's meaning", "12:01:18 · World Master names an existing region", "The World Master reviews the mapped region and supporting views, then names space-2 Kitchen. That region already existed and supported local navigation before its meaning was confirmed. Naming changes neither its geometry nor coordinate frame, and it does not itself complete either mission. If several regions plausibly match the description, clarify instead of choosing silently."],
  ["mission-finished", "Review fresh evidence and record progress", "12:01:20 · independent acceptance, safe closure", "The World Master reviews both findings against the retained region versions, the requested places, evidence age and any newer contradictory evidence. The 12:00:45 measurements are about 35 seconds old, within this example's 60-second acceptance window. A delayed or contradicted finding needs reconsideration; the system does not refresh a timestamp to make old evidence valid. An evidenced obstruction completes inspection without authorizing removal or traversal."],
  ["resume", "Retain the world between reasoning steps", "idle agent ≠ idle sensors", "With both missions complete, Navigator can become idle while sensing and world maintenance continue under their operating policy. Another assignment starts from the accumulated world, not an empty context. An Eve reset does not erase maps, tracks, names or accepted progress. A separate localization loss blocks dependent spatial actions until recovery; it does not erase recorded knowledge."],
];

export const exampleCode = {
  discovery: `const at = (iso: string) => Timestamp.fromDate(new Date(iso));
declare const worldMaster: Identity; // authenticated author of the existing Living area annotation
declare const retained: { // handles to verified stored resources; no invented bytes, hashes or live IO
  occupancy41: ResourceRef; surface41: ResourceRef; livingMask41: ResourceRef;
  kitchenMask41: ResourceRef; passageMask41: ResourceRef;
  camera45: ResourceRef; lidar45: ResourceRef; backpackSurface45: ResourceRef;
  calibration: ResourceRef; fusionReceipt45: ResourceRef;
  occupancy51: ResourceRef; surface51: ResourceRef; passageMask51: ResourceRef; evidenceIndex52: ResourceRef;
};
declare const mapperPackage: PackagePin; // installed mapper and exact version
const livingRegion = {
  entityId: "space-1", mapId: "local-map-1", revision: 4n,
  extent: { mapRevision: 41n, occupancyResourceId: retained.occupancy41.id,
    mask: retained.livingMask41, coverage: "partial" },
  observationIds: ["obs-layout-41"],
  name: { text: "Living area", assignedBy: worldMaster, assignedAt: at("2026-09-19T11:58:00Z") },
} satisfies RegionRecord;
const kitchenRegion = {
  entityId: "space-2", mapId: "local-map-1", revision: 2n,
  extent: { mapRevision: 41n, occupancyResourceId: retained.occupancy41.id,
    mask: retained.kitchenMask41, coverage: "partial" },
  observationIds: ["obs-layout-41"], // mapped but unnamed; kitchen is still a semantic hypothesis
} satisfies RegionRecord;
const baselineMap = {
  map: { id: "local-map-1", unitId: "go2-01", rootFrameId: "go2/map:epoch-7",
    revision: 41n, headRevisionId: "local-map-1/41", createdAt: at("2026-09-19T11:57:00Z") },
  layers: [
    { kind: "occupancy", resource: retained.occupancy41, observedAt: at("2026-09-19T11:59:59Z") },
    { kind: "surface", resource: retained.surface41, observedAt: at("2026-09-19T11:59:59Z") },
  ],
  entityIds: ["go2-01", "space-1", "space-2", "passage-1", "backpack-A"],
  localization: "localized", // backed by current localization evidence, not inferred from persisted map bytes
} satisfies Pick<LocalMapView, "map" | "layers" | "entityIds" | "localization">;
// These are excerpts of a populated world, not mission-created entities or the complete WorldView.
// Existing evidence places backpack-A near passage-1; its occluded shape still needs a better view.
// Map cells, per-facet acquisition times, region semantics and object tracks have independent update rates.
// This is a running mapping session. A boot with unavailable localization is a separate condition.`,
  mission: `const backpackSpec = {
  description: "Find the blue backpack in the living area and report where it was last seen.",
  objectives: [{
    id: "locate", description: "Identify the requested backpack and report its evidenced location.",
    dependsOn: [], optional: false,
    criterion: { tag: "located", value: {
      description: "Blue backpack",
      searchArea: { tag: "description", value: { text: "the living area" } }, // resolve against the existing world
      maxAgeMs: 60_000, review: "world_master", // evidence age at acceptance, not the sensor or LLM interval
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
      question: "Is anything obstructing this passage?",
      maxAgeMs: 60_000, review: "world_master",
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"),
} satisfies MissionSpec;
const creationInputs = [
  { id: "mission-1", spec: backpackSpec }, { id: "mission-2", spec: passageSpec },
] satisfies Parameters<Missions["createMission"]>[0][];
// Created at 12:00:00. Described targets can resolve to existing regions; a description does not imply an empty map.
// Prior observations inform the plan. Completion evidence must meet readiness and acceptance-age rules.
// No Unit ID, viewpoint, route, motor speed or execution duration belongs in MissionSpec.`,
  team: `const missionAssignments = [
  { missionId: "mission-1", agentId: "navigator", active: true, expectedRevision: 1n },
  { missionId: "mission-2", agentId: "navigator", active: true, expectedRevision: 1n },
] satisfies Parameters<WorldMasters["assignMission"]>[0][];
const unitGrant = {
  unitId: "go2-01", agentId: "navigator", actionNames: ["navigate@1"],
  expectedRevision: 0n, expiresAt: at("2026-09-19T12:06:00Z"),
} satisfies Parameters<WorldMasters["assignUnit"]>[0];
// At 12:00:01 both missions reach revision 2; the Unit grant reaches revision 1.
// Assignment authorizes this agent's work. It does not create a sensor session or clear the map.
// Installed local operating limits permit this nearby investigation; mission wording does not grant them.
// Both missions share Navigator's Eve loop and Go2's single physical execution reservation.`,
  prepared: `const assignmentWake = {
  id: "wake-assignment-1", worldId: "apartment", agentId: "navigator",
  eventIds: ["event-assignment-1", "event-assignment-2"], // durable events; delivery is not acknowledgement of handling
  changedEntityIds: ["go2-01"], rescan: true, // prepare the newly authorized Unit scope
} satisfies WorldWake;
declare const stepOne: Readonly<WorldView>; // adapter-frozen authorized projection at 12:00:02
const mapForStepOne = stepOne.localMaps.find(map => map.map.id === baselineMap.map.id);
const backpackForStepOne = stepOne.entities.get("backpack-A"); // existing semantic + local geometry facets
const navigatorForStepOne = stepOne.agents.get("navigator");
if (!stepOne.synchronized || !mapForStepOne || !navigatorForStepOne) {
  throw new Error("Context not ready"); // await a synchronized permitted view, never substitute empty knowledge
}
const missionLogForStepOne: MissionLog = navigatorForStepOne.missionLog;
// This snapshot includes checkpoint 42, livingRegion, kitchenRegion, passage-1 and recent backpack observations.
// /world/.../local-maps.json and entities.json expose these projections; mission-log.json covers both assignments.
// Every facet retains its own acquisition time. A recent context timestamp does not refresh old geometry.
// The LLM selects a useful viewing pose from the existing map and a qualified local viewpoint proposal.
// That plan lives in Eve reasoning/scratch space. It is not a next-action field written into world state.`,
  waiting: `// While stepOne remains frozen at 12:00:02, the independent mapper keeps committing useful changes.
const mapWhileThinking = {
  ...baselineMap.map, revision: 48n, headRevisionId: "local-map-1/48",
} satisfies LocalMapRecord; // current at 12:00:32; does not mutate mapForStepOne
const coalescedChanges = {
  id: "wake-world-2", worldId: "apartment", agentId: "navigator",
  eventIds: [], // no must-handle occurrence in this interval; real occurrences would retain their IDs
  changedEntityIds: ["go2-01", "backpack-A", "passage-1"], rescan: false,
} satisfies WorldWake;
// Repeated track/pose updates become dirty keys plus current state, not hundreds of queued snapshots.
// A dirty key does not require a new inference: wake only when useful work and scheduling policy justify it.
// If delivery waits behind a turn, prepare from current authorized state at the eventual step boundary.
// Mapping, YOLOE/tracking and selective SAM3 do not wait for the LLM to finish or request another observation.
// Retain evidence required by maps, decisions and mission proofs; coalescing a wake never discards those records.
// Checkpoint 42 → 48 represents selected durable commits, not a promised mapping rate or one write per scan.`,
  navigation: `// At 12:00:33 the LLM returns a viewpoint selected from its checkpoint-42 context.
const navigationInput = {
  executionId: "d0cb5435-aed4-45b5-933c-fb47b29cff42", // stable UUID for retries of this exact proposal
  unitId: "go2-01", assignment: { agentId: "navigator", revision: 1n },
  mapId: "local-map-1", basisMapRevision: 42n, frameId: "go2/map:epoch-7",
  targetPose: { positionM: { x: 1.2, y: -0.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  acceptBy: at("2026-09-19T12:00:35Z"), // fresh submission deadline, not chosen 30 seconds before inference completes
  mission: { missionId: "mission-2", objectiveId: "inspect", expectedRevision: 2n },
} satisfies NavigateRequest;
// ActionRequests.requestNavigate receives this intent; this document performs no IO.
// Current checkpoint is 48. Admission/claim revalidate the chosen pose and frame against current evidence.
// New checkpoint alone → recheck, not automatic rejection. Invalid pose, expired grant or reset frame → reject.
// Never silently move the target pose or rewrite a retry's body; a changed proposal needs a new execution ID.
// z = 0 is this adapter's ground-projected navigation convention, not a command for Go2 body height.
// 12:00:34 claim → local planning/motion → measured arrival and safe closure at 12:00:45.
// A person crossing the route triggers local slow/stop/replan; control never waits for the next LLM step.
// Arrival enables inspection. It does not satisfy inspected or certify that the passage is clear.`,
  inputs: `const cameraFrame = {
  streamId: "go2/camera", sessionId: "camera-7", sequence: 3840n,
  capturedAt: at("2026-09-19T12:00:45Z"),
} satisfies FrameRef;
const lidarFrame = {
  streamId: "go2/lidar", sessionId: "lidar-7", sequence: 11201n,
  capturedAt: at("2026-09-19T12:00:45.010Z"),
} satisfies FrameRef;
declare const acquisitionTransforms: TransformSample[]; // qualified acquisition-time sensor/map transforms
const candidateObservation = {
  id: "obs-1", entityId: "backpack-A", inputs: [cameraFrame], retained: [retained.camera45],
  semantic: { observedAt: cameraFrame.capturedAt, value: {
    hypotheses: [{ label: "backpack", score: 0.94 }, { label: "blue", score: 0.91 }],
  } },
} satisfies Pick<ObservationInput, "id" | "entityId" | "inputs" | "retained" | "semantic">;
const locatedObservation = {
  id: "obs-2", entityId: "backpack-A", inputs: [cameraFrame, lidarFrame], supersedes: ["obs-1"],
  retained: [retained.camera45, retained.lidar45, retained.backpackSurface45, retained.calibration, retained.fusionReceipt45],
  transforms: acquisitionTransforms,
  geometry: { observedAt: lidarFrame.capturedAt, value: { tag: "pointCloud", value: {
    frameId: "go2/map:epoch-7", resource: retained.backpackSurface45,
  } } }, // measured visible surface, not fabricated full extents
} satisfies Pick<ObservationInput, "id" | "entityId" | "inputs" | "retained" | "transforms" | "supersedes" | "geometry">;
// Selected updates to an existing track; full ingestion also validates producer, association and localMapId.
// Timing, intrinsics, extrinsics and pose history qualify this association; missing calibration keeps it image-only.
// obs-3 retains the wider passage view; obs-layout-52 retains current place/connection evidence at 12:00:45.
// All outcome evidence here is acquired after mission readiness. Earlier map knowledge remains useful context.`,
  projection: `const spatialCheckpoint = {
  mapId: "local-map-1", frameId: "go2/map:epoch-7", revision: 51n, parentRevision: 50n,
  layers: [
    { kind: "occupancy", resource: retained.occupancy51, observedAt: at("2026-09-19T12:00:45Z") },
    { kind: "surface", resource: retained.surface51, observedAt: at("2026-09-19T12:00:45.010Z") },
  ],
} satisfies MapCheckpoint & { layers: MapLayer[] };
const passageRefinement = {
  entityId: "passage-1", mapId: "local-map-1", expectedRevision: 5n,
  extent: { mapRevision: 51n, occupancyResourceId: retained.occupancy51.id,
    mask: retained.passageMask51, coverage: "bounded" },
  observationIds: ["obs-3", "obs-layout-52"],
} satisfies Parameters<WorldMemory["projectRegion"]>[0];
// After checkpoint 51 is retained, this qualified region update advances passage-1 to revision 6.
const inspectionCheckpoint = {
  ...spatialCheckpoint, revision: 52n, parentRevision: 51n,
  regionVersions: [
    { entityId: "space-1", revision: 4n }, { entityId: "space-2", revision: 2n },
    { entityId: "passage-1", revision: 6n },
  ],
  evidenceIndex: retained.evidenceIndex52, producer: mapperPackage,
} satisfies LocalMapManifest;
// WorldMemory.commitMapRevision publishes head 52 only after every referenced resource/version is retained.
// Region masks keep their exact basis checkpoints; unchanged regions can still refer to checkpoint 41.
// New views support Kitchen for space-2 and the backpack's overlap with the passage extent.
// Labels, region boundaries and object identity remain separate; a moving backpack is not permanent room geometry.`,
  findings: `const arrivalWake = {
  id: "wake-arrival-3", worldId: "apartment", agentId: "navigator",
  eventIds: ["event-execution-finished-1"], // important occurrence retained until explicitly handled
  changedEntityIds: ["go2-01", "backpack-A", "space-2", "passage-1"], rescan: false,
} satisfies WorldWake;
declare const stepTwo: Readonly<WorldView>; // fresh adapter projection at 12:00:46, including checkpoint 52
// Step 2 reads the mission log, arrival receipt and observations obs-1/2/3 + obs-layout-52 from this projection.
// It does not replay each intermediate snapshot produced during step 1.
// At 12:01:16, after another 30 seconds of reasoning, Navigator drafts:
const backpackFinding = {
  tag: "located", value: {
    entityId: "backpack-A", searchAreaId: "space-1", searchAreaRevision: 4n,
    observationIds: ["obs-1", "obs-2", "obs-layout-52"],
    description: "Blue backpack last seen at 12:00:45 on the living-area side of the passage.",
  },
} satisfies MissionFinding;
const passageFinding = {
  tag: "inspected", value: {
    regionId: "passage-1", regionRevision: 6n, conclusion: "obstructed",
    obstructionEntityIds: ["backpack-A"], observationIds: ["obs-2", "obs-3", "obs-layout-52"],
    description: "At 12:00:45 the backpack occupied the inspected passage. This is not a traversal clearance.",
  },
} satisfies MissionFinding;
// These are proposed outcomes. Only the configured review boundary can accept them.
// Later world changes remain available to review; a frozen context is not a promise that nothing changed.
// The same obs-2 supports different checks: object match/location versus obstruction in the inspected extent.
// Trace the context identity, cited evidence, reasoning and execution receipts under the capture policy.`,
  naming: `const kitchenName = {
  entityId: "space-2", expectedRevision: 2n, name: "Kitchen",
} satisfies Parameters<WorldMemory["nameRegion"]>[0];
// At 12:01:18 World Master reviews the retained views and submits the name; region revision becomes 3.
// A concurrent extent/name edit would conflict: reread and review, never overwrite blindly.
// The component keeps its extent, frame and identity. The old revision remains archived with checkpoint 52.
// The living-area name already existed; this confirms only the previously uncertain adjoining room.
// Names need not be unique. A name assignment is neither new sensor evidence nor mission completion.`,
  "mission-finished": `const progressSubmissions = [
  { missionId: "mission-1", objectiveId: "locate", evidence: { tag: "finding", value: backpackFinding } },
  { missionId: "mission-2", objectiveId: "inspect", evidence: { tag: "finding", value: passageFinding } },
] satisfies Parameters<Missions["recordObjectiveProgress"]>[0][];
// World Master reviews and submits each independently at 12:01:20.
// Validate authority, readiness, intended places, archived region versions and actual acquisition ages.
// 12:00:45 → 12:01:20 is about 35 seconds: within the 60-second policy, not a guarantee of unchanged state.
// Check newer contradictory evidence too. Here the backpack/place interpretation still holds.
// Review after expiry → use newer qualified evidence and reconsider; never retimestamp an old finding.
// Atomically retain accepted proof + objective progress + authenticated reviewer audit.
// Each mission closes only after its linked physical work has confirmed safe closure.
// Obstructed completes inspection; unknown visibility does not. Clearing the passage is different work.
// Repeated submission returns the retained proof, without double completion or replaying navigation.`,
  resume: `declare const nextWorld: Readonly<WorldView>; // latest authorized projection after idle or an Eve restart
const nextMissionLog = nextWorld.agents.get("navigator")?.missionLog;
const retainedMap = nextWorld.localMaps.find(map => map.map.id === "local-map-1");
const retainedBackpack = nextWorld.entities.get("backpack-A");
// Read accepted progress, the current map head, names, tracks and receipts; do not start from an empty scene.
// Reasoning can remain idle while perception and mapping continue under their operating policy.
// A future mission begins with this accumulated world and a fresh bounded projection.
if (retainedMap?.localization === "relocalization_required") {
  // A separate localization loss blocks dependent spatial actions, not reading retained knowledge.
  // Reconcile the Unit and controller receipts before new motion; an Eve reset alone does not lose localization.
}
// More Units can contribute independent local frames without requiring a perfectly aligned global map.`,
};
