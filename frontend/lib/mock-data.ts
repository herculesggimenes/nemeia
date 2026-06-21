import type { Artifact, ComponentEvent, RobotStatus, SceneObject, ThreadItem } from "../types/nemeia";

export const robots: RobotStatus[] = [
  {
    id: "go2",
    name: "Go2",
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
    relation: "ahead-right of go2",
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
    description: "Mock camera artifact for the front Go2 stream.",
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
    description: "Go2 remote audio playback.",
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
    title: "Go2 Config",
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
    description: "Go2 control lane and input settings.",
    status: "mock",
    path: "robots/go2/control.config.nemeia",
    contentType: "application/x.nemeia.config",
    source: "robot"
  },
  {
    id: "speaker_config",
    type: "config",
    title: "Speaker Config",
    description: "Go2 audio output settings.",
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
