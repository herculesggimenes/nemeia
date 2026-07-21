import type { AnomalyRecord, Artifact, ComponentEvent, MissionRun, ReplaySummary, RobotStatus, SceneObject, ThreadItem } from "../types/nemeia";

export const robots: RobotStatus[] = [
  {
    id: "go2",
    name: "Robot",
    mode: "standing by",
    battery: 82,
    connection: "mock",
    lastHeartbeatMs: 140
  }
];

export const sceneObjects: SceneObject[] = [
  {
    id: "obj_backpack",
    label: "red_backpack",
    relation: "ahead-right of robot",
    rangeM: 1.82,
    confidence: 0.86,
    state: ["visible", "tracked", "approachable_candidate"]
  },
  {
    id: "obj_cable",
    label: "floor_cable",
    relation: "front path",
    rangeM: 0.62,
    confidence: 0.74,
    state: ["floor_hazard", "blocks_direct_path"]
  },
  {
    id: "obj_couch",
    label: "couch",
    relation: "behind target",
    rangeM: 2.35,
    confidence: 0.93,
    state: ["landmark", "static"]
  }
];

export const threadItems: ThreadItem[] = [
  {
    id: "t1",
    kind: "user",
    title: "Operator",
    body: "Find my red backpack and tell me if the path is safe.",
    time: "10:21:04"
  },
  {
    id: "t2",
    kind: "component_event",
    title: "Thread trigger",
    body: "scene_graph.object_detected matched active goal target red_backpack.",
    time: "10:21:05",
    source: "semantic_scene_graph"
  },
  {
    id: "t3",
    kind: "assistant",
    title: "Nemeia",
    body: "I found a red backpack 1.82m ahead-right. A floor cable is crossing the direct path at 0.62m, so I should not approach directly.",
    time: "10:21:06"
  },
  {
    id: "t4",
    kind: "tool_call",
    title: "bash",
    body: "nemeiactl scene objects --label backpack",
    time: "10:21:06"
  }
];

export const artifacts: Artifact[] = [
  {
    id: "camera_front",
    type: "camera",
    title: "Front Camera",
    description: "Mock camera artifact for the front robot stream.",
    status: "mock",
    path: "robots/go2/front-camera.stream",
    contentType: "application/x.nemeia.camera-stream",
    source: "robot"
  },
  {
    id: "point_cloud",
    type: "point_cloud",
    title: "Point Cloud",
    description: "Projected LiDAR points attached to detected objects.",
    status: "live",
    path: "robots/go2/slam/cloud-world.pcd",
    contentType: "application/vnd.pointcloud",
    source: "robot"
  },
  {
    id: "speaker",
    type: "audio",
    title: "Speaker",
    description: "Robot remote audio playback.",
    status: "live",
    path: "robots/go2/speaker.audio",
    contentType: "application/x.nemeia.audio-output",
    source: "robot"
  },
  {
    id: "agent_artifact",
    type: "artifact",
    title: "Agent Artifact",
    description: "Rendered plan, notes, and generated scene explanation.",
    status: "mock",
    path: "threads/main/generated/route-note.md",
    contentType: "text/markdown",
    source: "agent"
  },
  {
    id: "go2_config",
    type: "config",
    title: "Robot Config",
    description: "Robot connection and runtime settings.",
    status: "mock",
    path: "robots/go2/config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "camera_front_config",
    type: "config",
    title: "Front Camera Config",
    description: "Front camera stream and perception settings.",
    status: "mock",
    path: "robots/go2/front-camera.config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "lidar_config",
    type: "config",
    title: "LiDAR Config",
    description: "LiDAR and SLAM stream settings.",
    status: "mock",
    path: "robots/go2/lidar.config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "control_config",
    type: "config",
    title: "Control Config",
    description: "Robot control lane and input settings.",
    status: "mock",
    path: "robots/go2/control.config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "speaker_config",
    type: "config",
    title: "Speaker Config",
    description: "Robot audio output settings.",
    status: "mock",
    path: "robots/go2/speaker.config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "add_component",
    type: "config",
    title: "Add Component",
    description: "Mock component registration flow.",
    status: "mock",
    path: "fleet/add-component.nemeia",
    contentType: "application/x.nemeia.component-template",
    source: "runtime"
  }
];

export const componentEvents: ComponentEvent[] = [
  {
    id: "evt1",
    componentId: "go2.camera.front",
    eventType: "object_detected",
    summary: "red_backpack detected, conf .86",
    time: "10:21:05",
    severity: "info"
  },
  {
    id: "evt2",
    componentId: "go2.lidar",
    eventType: "hazard_detected",
    summary: "floor cable projected into path, range .62m",
    time: "10:21:05",
    severity: "warn"
  },
  {
    id: "evt3",
    componentId: "thread.main",
    eventType: "trigger_published",
    summary: "component event appended to main thread",
    time: "10:21:05",
    severity: "info"
  }
];

export const missionRuns: MissionRun[] = [
  {
    id: "run_follow_backpack",
    missionId: "msn_backpack",
    robotId: "robot_01",
    verb: "follow",
    state: "awaiting_approval",
    proposedBy: "agent",
    reason: "Approach the bound backpack after checking the floor cable hazard.",
    checks: [
      { name: "scene_freshness", status: "pass", detail: "Scene snapshot age 320ms." },
      { name: "protected_clearance", status: "warn", detail: "Cable projected 0.62m ahead; left arc required." },
      { name: "capability_maturity", status: "pass", detail: "cap:follow-entity@0.3.2 is pinned trusted." }
    ],
    approval: {
      required: true,
      scope: "per_run",
      expiresAt: "2026-07-07T17:01:00.000Z"
    },
    grant: {
      mode: "streaming base_velocity_3d",
      limits: ["max_speed_mps 0.15", "max_yaw_rps 0.20"],
      watchdogMs: 100,
      maxDurationMs: 120000
    },
    abortTriggers: ["operator_stop", "stream_silence", "protected_clearance_violation"],
    evidenceRefs: ["artifact:frame_123", "artifact:sweep_left_arc"],
    predictedSweep: "Left arc around obj_cable, stop 0.8m from obj_backpack."
  },
  {
    id: "run_scan_scene",
    missionId: "msn_backpack",
    robotId: "robot_01",
    verb: "scan",
    state: "completed",
    proposedBy: "agent",
    reason: "Refresh the bound target before approach.",
    checks: [{ name: "scene_freshness", status: "pass", detail: "Snapshot persisted as ssg_48211." }],
    approval: {
      required: false,
      scope: "none",
      expiresAt: "2026-07-07T17:00:20.000Z"
    },
    grant: {
      mode: "read-only scene",
      limits: ["no actuation"],
      watchdogMs: 0,
      maxDurationMs: 0
    },
    abortTriggers: ["operator_stop"],
    evidenceRefs: ["artifact:frame_122"],
    predictedSweep: "No motion."
  }
];

export const replaySummaries: ReplaySummary[] = [
  {
    runId: "run_scan_scene",
    authorizationIds: ["auth_scan_01"],
    attentionDigests: ["digest:msn_backpack:agent:1"],
    steps: [
      { seq: 48201, time: "10:20:58", eventType: "run.proposed", summary: "scan proposed by agent", refs: ["run_scan_scene"] },
      { seq: 48206, time: "10:20:59", eventType: "authorization.dispatched", summary: "read-only scene grant issued", refs: ["auth_scan_01"] },
      { seq: 48211, time: "10:21:05", eventType: "scene.observation", summary: "red_backpack and floor_cable projected", refs: ["artifact:frame_123"] },
      { seq: 48216, time: "10:21:06", eventType: "attention.seam", summary: "digest delivered to agent", refs: ["digest:msn_backpack:agent:1"] }
    ]
  }
];

export const anomalies: AnomalyRecord[] = [
  {
    id: "anm_clearance_cable",
    missionId: "msn_backpack",
    severity: "safety",
    status: "open",
    owner: "operator",
    expected: "No protected clearance violations in the planned sweep.",
    observed: "Cable intersects direct approach corridor.",
    evidenceRefs: ["artifact:frame_123", "artifact:sweep_left_arc"],
    suspectedCause: "Scene hazard requires route adjustment before approval."
  },
  {
    id: "anm_attention_predicate_48216",
    missionId: "msn_backpack",
    severity: "warning",
    status: "open",
    owner: "runtime",
    expected: "Attention predicate evaluates without runtime errors.",
    observed: "Pending-age timer rearmed after a stale event timestamp.",
    evidenceRefs: ["event:48216"],
    suspectedCause: "Upstream timestamp normalization."
  }
];
