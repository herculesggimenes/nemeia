export type ThreadItemKind =
  | "user"
  | "assistant"
  | "component_event"
  | "tool_call"
  | "artifact";

export type ThreadItem = {
  id: string;
  kind: ThreadItemKind;
  title: string;
  body: string;
  time: string;
  source?: string;
};

export type Artifact = {
  id: string;
  type: "camera" | "point_cloud" | "control" | "artifact";
  title: string;
  description: string;
  status: "live" | "stale" | "mock";
  path: string;
  contentType: string;
  source: "robot" | "runtime" | "agent";
};

export type SceneObject = {
  id: string;
  label: string;
  relation: string;
  rangeM: number;
  confidence: number;
  state: string[];
};

export type RobotStatus = {
  id: string;
  name: string;
  mode: string;
  battery: number;
  connection: "online" | "offline" | "mock";
  lastHeartbeatMs: number;
};

export type ComponentEvent = {
  id: string;
  componentId: string;
  eventType: string;
  summary: string;
  time: string;
  severity: "info" | "warn" | "critical";
};
