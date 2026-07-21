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
  type: "audio" | "camera" | "point_cloud" | "control" | "artifact" | "config";
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

export type MissionRun = {
  id: string;
  missionId: string;
  robotId: string;
  verb: string;
  state: "awaiting_approval" | "authorized" | "completed" | "rejected" | "aborted" | "executing" | "expired";
  proposedBy: string;
  reason: string;
  checks: CheckResult[];
  approval: {
    required: boolean;
    scope: string;
    expiresAt: string;
  };
  grant: {
    mode: string;
    limits: string[];
    watchdogMs: number;
    maxDurationMs: number;
  };
  abortTriggers: string[];
  evidenceRefs: string[];
  predictedSweep: string;
};

export type CheckResult = {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export type ReplayStep = {
  seq: number;
  time: string;
  eventType: string;
  summary: string;
  refs: string[];
};

export type ReplaySummary = {
  runId: string;
  authorizationIds: string[];
  attentionDigests: string[];
  steps: ReplayStep[];
};

export type AnomalyRecord = {
  id: string;
  missionId: string;
  severity: "info" | "warning" | "safety";
  status: "open" | "closed";
  owner: string;
  expected: string;
  observed: string;
  evidenceRefs: string[];
  suspectedCause: string;
};
