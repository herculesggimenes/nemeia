// Read-only example. Each excerpt uses the contracts displayed on this page.
export const exampleRows = [
  ["mission", "Set the task", "World Operator → one mission, one agent", "“Find my blue backpack.” The World Operator records the objective, assigns Navigator and grants it control of Go2. The task does not specify a route or a known backpack ID. Mapping and perception are already running."],
  ["world", "Look at the world that already exists", "Agent sees → map, robot position, objects, images", "Navigator receives a partial local map and Go2’s current position. A sofa and a possible blue backpack are already tracked. The backpack is partly hidden in the camera view, with a measured visible surface beside the sofa. The agent needs a better view to confirm the match."],
  ["navigation", "Choose a better view", "Agent decides → viewpoint; local systems → route", "Navigator chooses a viewing pose from the measured map. Admission checks the proposal against current state; Go2’s local navigation handles the route and live obstacles. Mapping and object tracking keep updating throughout the slower reasoning step and the movement."],
  ["observation", "Update the same world", "Perception changes → clearer image, refined object location", "From the new viewpoint, the camera sees more of the backpack. Calibrated association connects the image and LiDAR evidence to the existing object track. The world retains the new evidence and refines the local map. Navigator’s next step reads this current state, not a queue of every sensor frame."],
  ["report", "Report what was found", "Agent reports → backpack, location, supporting image", "“The blue backpack is beside the sofa.” The report links to its measured local position and latest image, with the observation time. The World Operator reviews the match before the objective is completed. The map and object history remain available for the next task, even if the agent goes idle."],
];

export const exampleCode = {
  mission: `const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const backpackSpec = {
  description: "Find my blue backpack and show me where it is.",
  objectives: [{
    id: "locate", description: "Identify the backpack and report its evidenced location.",
    dependsOn: [], optional: false,
    criterion: { tag: "located", value: {
      description: "Blue backpack", maxAgeMs: 60_000, review: "world_operator",
    } },
  }],
  deadlineAt: at("2026-09-19T12:06:00Z"), // task deadline, not a motor timeout
} satisfies MissionSpec;
const createMission = { id: "mission-1", spec: backpackSpec } satisfies Parameters<Missions["createMission"]>[0];
const assignment = {
  missionId: "mission-1", agentId: "navigator", active: true, expectedRevision: 1n,
} satisfies Parameters<WorldOperators["assignMission"]>[0];
const unitGrant = {
  unitId: "go2-01", agentId: "navigator", actionNames: ["navigate@1"],
  expectedRevision: 0n, expiresAt: backpackSpec.deadlineAt,
} satisfies Parameters<WorldOperators["assignUnit"]>[0];
// Separate World Operator operations: create → assign → grant Unit authority.
// These values describe inputs, not calls. The mission reaches revision 2 after assignment.
// The installed local navigation adapter and operating limits authorize nearby investigation.`,
  world: `declare const retainedMap: ResourceRef; // existing native map product, not recreated by the mission
const mapExcerpt = {
  map: { id: "local-map-1", unitId: "go2-01", rootFrameId: "go2/map:epoch-7",
    revision: 42n, headRevisionId: "local-map-1/42", createdAt: at("2026-09-19T11:57:00Z") },
  layers: [{ kind: "occupancy", resource: retainedMap, observedAt: at("2026-09-19T12:00:01Z") }],
  entityIds: ["go2-01", "sofa-A", "backpack-A"], // observed tracks, not an entity subscription list
  localization: "localized", // supported by current evidence, not merely by loading map bytes
} satisfies Pick<LocalMapView, "map" | "layers" | "entityIds" | "localization">;
declare const stepOne: Readonly<WorldView>; // authorized projection frozen when reasoning starts
const candidate = stepOne.entities.get("backpack-A");
const missionLog = stepOne.agents.get("navigator")?.missionLog;
const measuredShape = candidate?.geometries; // frame-qualified visible surface, not assumed full dimensions
const hypotheses = candidate?.semantic; // backpack / blue with model scores and acquisition times
// The adapter includes Unit observations automatically; the agent did not choose these subscriptions.
// Evidence detail reads supply the supporting images. No room entity is needed to inspect this object.
// While this step reasons, the live world advances; repeated updates coalesce for the next step.`,
  navigation: `const navigationInput = {
  executionId: "d0cb5435-aed4-45b5-933c-fb47b29cff42", // stable identity for retries of this proposal
  unitId: "go2-01", assignment: { agentId: "navigator", revision: 1n },
  mapId: "local-map-1", basisMapRevision: 42n, frameId: "go2/map:epoch-7",
  targetPose: { positionM: { x: 1.2, y: -0.2, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 } }, // viewing pose selected from the measured map
  acceptBy: at("2026-09-19T12:00:35Z"), // set at submission after reasoning, not at its start
  mission: { missionId: "mission-1", objectiveId: "locate", expectedRevision: 2n },
} satisfies NavigateRequest;
// ActionRequests.requestNavigate admits the proposal; a controller claims the Unit execution slot.
// Current map revision may be newer. Recheck the pose, frame, authority and localization before motion.
// The adapter uses ground-projected z; this is not a Go2 body-height command.
// The local planner handles obstacles and stops independently of the LLM.
// Measured arrival and safe closure enable the next observation; they do not prove the backpack was found.`,
  observation: `declare const image: ResourceRef, lidar: ResourceRef, visibleSurface: ResourceRef;
declare const calibration: ResourceRef, fusionReceipt: ResourceRef; // retained acquisition-time association proof
declare const transforms: TransformSample[]; // qualified sensor-to-map transforms at acquisition
const cameraFrame = {
  streamId: "go2/camera", sessionId: "camera-7", sequence: 3840n,
  capturedAt: at("2026-09-19T12:00:45Z"),
} satisfies FrameRef;
const lidarFrame = {
  streamId: "go2/lidar", sessionId: "lidar-7", sequence: 11201n,
  capturedAt: at("2026-09-19T12:00:45.010Z"),
} satisfies FrameRef;
const update = {
  id: "obs-backpack-2", entityId: "backpack-A", inputs: [cameraFrame, lidarFrame],
  retained: [image, lidar, visibleSurface, calibration, fusionReceipt], transforms,
  semantic: { observedAt: cameraFrame.capturedAt, value: {
    hypotheses: [{ label: "backpack", score: 0.94 }, { label: "blue", score: 0.91 }],
  } },
  geometry: { observedAt: lidarFrame.capturedAt, value: { tag: "pointCloud", value: {
    frameId: "go2/map:epoch-7", resource: visibleSurface,
  } } }, // measured partial surface; no invented complete box
} satisfies Pick<ObservationInput,
  "id" | "entityId" | "inputs" | "retained" | "transforms" | "semantic" | "geometry">;
// Excerpt: ingestion also validates producer authority, localMapId and track association.
// Without qualified calibration, retain image-only evidence; never invent a metric location.
// The mapper separately retains its updated native map; object detections are not the entire map.`,
  report: `declare const stepTwo: Readonly<WorldView>; // fresh projection after arrival; perception has continued
const latestBackpack = stepTwo.entities.get("backpack-A"); // updated facets and their observation references
const finding = {
  tag: "located", value: {
    entityId: "backpack-A", observationIds: ["obs-backpack-2", "obs-sofa-2"],
    description: "Blue backpack beside the sofa, last seen at 12:00:45.",
  },
} satisfies MissionFinding;
// obs-sofa-2 retains the same-view sofa evidence supporting the relative description.
// The image and local position are resolved from the cited observations, not invented by this text.
const progress = {
  missionId: "mission-1", objectiveId: "locate", evidence: { tag: "finding", value: finding },
} satisfies Parameters<Missions["recordObjectiveProgress"]>[0];
// World Operator reviews the match, acquisition age and any newer contradictory evidence.
// At 12:01:20 the measurements are about 35 seconds old, within this mission's 60-second review window.
// Acceptance records proof + progress + audit. Mission closure also requires safe physical closure.
// New work reads the retained world. An Eve reset does not erase the map or object identities.
// If localization is later lost, relocalization_required blocks spatial actions—not access to old knowledge.`,
};
