import type {
  AssignMissionParams,
  AssignUnitParams,
  CancelMissionParams,
  CreateMissionParams,
  RejectObjectiveFindingParams,
  ReconcileMissionParams,
  RecordObjectiveProgressParams
} from "@nemeia/world-client/src/generated/types/reducers.ts";

export type OperatorConnectionState =
  | "authenticated"
  | "connecting"
  | "disconnected"
  | "forbidden"
  | "unavailable";

export type OperatorWorldMode = "simulation" | "physical" | "unknown";

export type NativeOperatorOperation =
  | "assignMission"
  | "assignUnit"
  | "cancelMission"
  | "createMission"
  | "rejectObjectiveFinding"
  | "reconcileMission"
  | "recordObjectiveProgress";

export type NativeOperatorInputs = {
  assignMission: AssignMissionParams;
  assignUnit: AssignUnitParams;
  cancelMission: CancelMissionParams;
  createMission: CreateMissionParams;
  rejectObjectiveFinding: RejectObjectiveFindingParams;
  reconcileMission: ReconcileMissionParams;
  recordObjectiveProgress: RecordObjectiveProgressParams;
};

export type NativeOperatorCall = <Operation extends NativeOperatorOperation>(operation: Operation, input: NativeOperatorInputs[Operation]) => Promise<boolean>;

export type NativeOperatorClient = {
  supports: (operation: NativeOperatorOperation) => boolean;
  subscribe: (handlers: {
    onError: (error: unknown) => void;
    onProjection: (projection: OperatorProjection) => void;
    onStatus: (state: Exclude<OperatorConnectionState, "unavailable">) => void;
  }) => void | (() => void) | { unsubscribe: () => void };
  readEvents: (subjectId: string, afterSequence: string) => Promise<OperatorEventPage>;
  call: NativeOperatorCall;
};

export type OperatorReadiness = {
  authorized: boolean;
  role: string;
  synchronized: boolean;
  unitId: string | null;
  worldId: string;
  mode: OperatorWorldMode;
};

export type OperatorObjective = {
  id: string;
  description: string;
  optional: boolean;
  dependsOn: string[];
  criterion: string;
  state: "accepted" | "blocked" | "ready" | "review" | "unknown";
  evidenceIds: string[];
};

export type OperatorMission = {
  id: string;
  description: string;
  state: "active" | "cancelled" | "closing" | "failed" | "succeeded" | "unknown";
  revision: string;
  deadlineAt: string | null;
  objectives: OperatorObjective[];
  agentIds: string[];
  progressCount: number;
  updatedAt: string | null;
};

export type OperatorAgent = {
  id: string;
  displayName: string;
  paused: boolean;
  revision: string;
  missionIds: string[];
};

export type OperatorUnit = {
  id: string;
  displayName: string;
  agentId: string | null;
  assignmentRevision: string;
  actionNames: string[];
  expiresAt: string | null;
  activeExecutionId: string | null;
  stopLatched: boolean;
  safeStateConfirmed: boolean;
};

export type OperatorExecution = {
  id: string;
  missionId: string | null;
  objectiveId: string | null;
  unitId: string;
  action: string;
  state: "accepted" | "cancelled" | "cancelling" | "failed" | "running" | "succeeded" | "unknown";
  result: string | null;
  updatedAt: string | null;
};

export type OperatorResourceReference = {
  id: string;
  schema: string;
  sha256: string;
  byteLength: string;
};

export type OperatorResourceContext =
  | { kind: "observation"; observationId: string }
  | { kind: "map"; mapId: string; revision: string };

export type OperatorEvidence = {
  id: string;
  observationId: string;
  entityId: string;
  label: string;
  confidence: number | null;
  frameId: string | null;
  acquiredAt: string | null;
  imageBox: OperatorImageBox | null;
  resources: OperatorResourceReference[];
  geometryKind: "image" | "measured" | "none";
  position: { x: number; y: number; z: number } | null;
};

export type OperatorImageBox = {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  angleRad: number;
  frame: {
    streamId: string;
    sessionId: string;
    sequence: string;
    capturedAt: string;
  };
};

export type OperatorEvidenceCandidate = {
  id: string;
  missionId: string;
  objectiveId: string;
  entityId: string;
  entityLabel: string;
  description: string;
  observationIds: string[];
  status: "pending";
};

export type OperatorFinding = {
  id: string;
  missionId: string;
  objectiveId: string;
  entityId: string;
  description: string;
  observationIds: string[];
  reviewedAt: string | null;
  reviewedBy: string;
  status: "accepted" | "pending" | "rejected";
};

export type OperatorMap = {
  id: string;
  unitId: string;
  rootFrameId: string;
  revision: string | null;
  updatedAt: string | null;
  manifestId: string | null;
  evidenceIndexId: string | null;
};

export type OperatorEvent = {
  id: string;
  kind: string;
  sequence: string | null;
  subjectId: string;
  detail: string;
  recordedAt: string | null;
};

export type OperatorEventPage = {
  events: OperatorEvent[];
  historyGap: boolean;
  nextSequence: string;
};

export type OperatorFeedbackWatermark = {
  missionId: string;
  sequence: string;
};

export type OperatorProjection = {
  operatorIdentity: string | null;
  readiness: OperatorReadiness;
  missions: OperatorMission[];
  agents: OperatorAgent[];
  units: OperatorUnit[];
  executions: OperatorExecution[];
  evidence: OperatorEvidence[];
  findings: OperatorFinding[];
  maps: OperatorMap[];
  events: OperatorEvent[];
  feedbackWatermarks: OperatorFeedbackWatermark[];
};
