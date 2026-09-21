import type {
  AssignedMissionRow,
  CurrentWorldSnapshot,
  RelevantAgentRow,
  RelevantEntityRow,
  RelevantExecutionRow,
  RelevantGeometryRow,
  RelevantLocalMapRow,
  RelevantMissionAgentRow,
  RelevantMissionObjectiveProgressRow,
  RelevantPoseRow,
  ResourceRef,
  RelevantSemanticRow,
  RelevantUnitAssignmentRow,
  RelevantUnitControlRow
} from "@nemeia/world-client/src/index.ts";
import type {
  OperatorAgent,
  OperatorExecution,
  OperatorMap,
  OperatorMission,
  OperatorObjective,
  OperatorProjection,
  OperatorUnit
} from "../../types/operator";
import { resultLabel } from "./execution-result.ts";
import { objectiveDependenciesReady } from "./operator-policies.ts";

export function projectionFromSnapshot(snapshot: CurrentWorldSnapshot, operatorIdentity: string | null = null): OperatorProjection {
  const readinessRow = snapshot.readiness[0];
  const readiness = {
    authorized: readinessRow?.authorized ?? false,
    mode: worldMode(readinessRow?.mode),
    role: readinessRow?.role ?? "anonymous",
    synchronized: readinessRow?.synchronized ?? false,
    unitId: readinessRow?.unitId ?? null,
    worldId: readinessRow?.worldId ?? "unknown"
  } as OperatorProjection["readiness"];
  const entities = new Map(snapshot.relevantEntities.map((row) => [row.id, row]));
  const memberships = snapshot.relevantMissionAgents.filter((row) => row.active);
  const progress = snapshot.relevantMissionObjectiveProgress;
  return {
    operatorIdentity,
    agents: snapshot.relevantAgents.map((row) => toAgent(row, memberships)),
    events: snapshot.addressedMessages.map((row) => ({
      detail: row.content,
      id: row.id,
      kind: "agent_message",
      recordedAt: toIso(row.createdAt),
      sequence: null,
      subjectId: row.missionId
    })),
    executions: snapshot.relevantExecutions.map(toExecution),
    evidence: evidenceFromRows(
      snapshot.relevantGeometry,
      snapshot.relevantPoses,
      snapshot.relevantSemantic,
      entities
    ),
    findings: acceptedFindings(progress, entities),
    feedbackWatermarks: (snapshot.relevantFeedbackWatermarks ?? []).map((row) => ({
      missionId: row.missionId,
      sequence: row.sequence.toString(10),
    })),
    maps: snapshot.relevantLocalMaps.map(toMap),
    missions: snapshot.assignedMissions.map((row) => toMission(row, memberships, progress)),
    readiness,
    units: unitsFromSnapshot(snapshot)
  };
}

function toMission(row: AssignedMissionRow, memberships: readonly RelevantMissionAgentRow[], progress: readonly RelevantMissionObjectiveProgressRow[]): OperatorMission {
  const missionProgress = progress.filter((item) => item.missionId === row.id);
  const missionAgentIds = memberships.filter((item) => item.missionId === row.id).map((item) => item.agentId);
  const acceptedIds = new Set(missionProgress.map((item) => item.objectiveId));
  const objectives: OperatorObjective[] = row.spec.objectives.map((objective) => ({
    criterion: criterionLabel(objective.criterion),
    dependsOn: objective.dependsOn,
    description: objective.description,
    evidenceIds: missionProgress.filter((item) => item.objectiveId === objective.id).flatMap((item) => evidenceIds(item.evidence)),
    id: objective.id,
    optional: objective.optional,
    state: acceptedIds.has(objective.id) ? "accepted" : "unknown"
  }));
  for (const objective of objectives) {
    if (objective.state !== "accepted") {
      objective.state = objectiveDependenciesReady(objective, acceptedIds, objectives) ? "ready" : "blocked";
    }
  }
  return {
    agentIds: missionAgentIds,
    deadlineAt: toIso(row.spec.deadlineAt),
    description: row.spec.description,
    id: row.id,
    objectives,
    progressCount: missionProgress.length,
    revision: row.revision.toString(10),
    state: missionState(row.state),
    updatedAt: toIso(row.updatedAt)
  };
}

function toAgent(row: RelevantAgentRow, memberships: readonly RelevantMissionAgentRow[]): OperatorAgent {
  return {
    displayName: row.displayName,
    id: row.id,
    missionIds: memberships.filter((item) => item.agentId === row.id).map((item) => item.missionId),
    paused: row.paused,
    revision: row.revision.toString(10)
  };
}

function toExecution(row: RelevantExecutionRow): OperatorExecution {
  return {
    action: actionLabel(row.input),
    id: row.id,
    missionId: row.missionId ?? null,
    objectiveId: row.objectiveId ?? null,
    result: resultLabel(row.result),
    state: executionState(row.state),
    unitId: row.unitId,
    updatedAt: toIso(row.updatedAt)
  };
}

function unitsFromSnapshot(snapshot: CurrentWorldSnapshot): OperatorUnit[] {
  const assignments = new Map(snapshot.relevantUnitAssignments.map((row) => [row.unitId, row]));
  const controls = new Map(snapshot.relevantUnitControls.map((row) => [row.unitId, row]));
  const bindingNames = new Map<string, string[]>();
  for (const binding of snapshot.relevantActionBindings) {
    const names = bindingNames.get(binding.unitId) ?? [];
    names.push(binding.actionName);
    bindingNames.set(binding.unitId, names);
  }
  const unitIds = new Set([...assignments.keys(), ...controls.keys(), ...bindingNames.keys()]);
  return Array.from(unitIds, (id) => unitFromRows(id, assignments.get(id), controls.get(id), bindingNames.get(id) ?? []));
}

function unitFromRows(
  id: string,
  assignment: RelevantUnitAssignmentRow | undefined,
  control: RelevantUnitControlRow | undefined,
  bindingNames: readonly string[]
): OperatorUnit {
  return {
    actionNames: assignment ? [...assignment.actionNames] : [...bindingNames],
    activeExecutionId: control?.activeExecutionId ?? null,
    agentId: assignment?.agentId ?? null,
    assignmentRevision: assignment?.revision.toString(10) ?? "0",
    displayName: id,
    expiresAt: toIso(assignment?.expiresAt),
    id,
    safeStateConfirmed: control?.safeStateConfirmed ?? false,
    stopLatched: control?.stopLatched ?? false
  };
}

function evidenceIds(value: RelevantMissionObjectiveProgressRow["evidence"]): string[] {
  switch (value.tag) {
    case "Observation": return [value.value.observationId];
    case "Execution": return [value.value.executionId];
    case "Finding": return value.value.observationIds;
    default: return [];
  }
}

function acceptedFindings(
  progress: readonly RelevantMissionObjectiveProgressRow[],
  entities: ReadonlyMap<string, RelevantEntityRow>
): OperatorProjection["findings"] {
  return progress.flatMap((row) => {
    if (row.evidence.tag !== "Finding") { return []; }
    const evidence = row.evidence.value;
    return [{
      description: `Accepted located evidence · ${entities.get(evidence.entityId)?.displayName ?? evidence.entityId}`,
      entityId: evidence.entityId,
      id: `objective-progress:${row.key}`,
      missionId: row.missionId,
      objectiveId: row.objectiveId,
      observationIds: [...evidence.observationIds],
      reviewedAt: row.recordedAt.toISOString(),
      reviewedBy: evidence.reviewedBy,
      status: "accepted",
    }];
  });
}

function toMap(row: RelevantLocalMapRow): OperatorMap {
  return {
    evidenceIndexId: null,
    id: row.id,
    manifestId: null,
    revision: row.headRevision?.toString(10) ?? null,
    rootFrameId: row.rootFrameId,
    unitId: row.unitId,
    updatedAt: toIso(row.updatedAt)
  };
}

function evidenceFromRows(
  geometryRows: readonly RelevantGeometryRow[],
  poseRows: readonly RelevantPoseRow[],
  semanticRows: readonly RelevantSemanticRow[],
  entities: ReadonlyMap<string, RelevantEntityRow>
): OperatorProjection["evidence"] {
  const evidence = new Map<string, OperatorProjection["evidence"][number]>();
  for (const row of geometryRows) {
    const current = evidence.get(row.observationId);
    evidence.set(row.observationId, {
      acquiredAt: toIso(row.observedAt),
      confidence: current?.confidence ?? null,
      entityId: row.entityId,
      frameId: row.frameId,
      geometryKind: row.value.tag === "BoundingBox2D" ? "image" : "measured",
      id: current?.id ?? `observation:${row.observationId}`,
      label: current?.label ?? entities.get(row.entityId)?.displayName ?? row.entityId,
      imageBox: current?.imageBox ?? geometryImageBox(row.value),
      observationId: row.observationId,
      position: geometryPosition(row.value),
      resources: geometryResources(row.value)
    });
  }
  for (const row of poseRows) {
    const current = evidence.get(row.observationId);
    evidence.set(row.observationId, {
      acquiredAt: current?.acquiredAt ?? toIso(row.observedAt),
      confidence: current?.confidence ?? null,
      entityId: row.entityId,
      frameId: current?.position ? current.frameId : row.frameId,
      geometryKind: current?.geometryKind ?? "none",
      id: current?.id ?? `observation:${row.observationId}`,
      imageBox: current?.imageBox ?? null,
      label: current?.label ?? entities.get(row.entityId)?.displayName ?? row.entityId,
      observationId: row.observationId,
      position: current?.position ?? row.value.positionM,
      resources: current?.resources ?? []
    });
  }
  for (const row of semanticRows) {
    const hypothesis = row.value.hypotheses[0];
    const current = evidence.get(row.observationId);
    evidence.set(row.observationId, {
      acquiredAt: current?.acquiredAt ?? toIso(row.observedAt),
      confidence: current?.confidence ?? hypothesis?.score ?? null,
      entityId: row.entityId,
      frameId: current?.frameId ?? row.frameId ?? null,
      geometryKind: current?.geometryKind ?? "none",
      id: current?.id ?? `observation:${row.observationId}`,
      imageBox: current?.imageBox ?? null,
      label: hypothesis?.label ?? current?.label ?? entities.get(row.entityId)?.displayName ?? row.entityId,
      observationId: row.observationId,
      position: current?.position ?? null,
      resources: current?.resources ?? []
    });
  }
  return Array.from(evidence.values());
}

function geometryPosition(value: RelevantGeometryRow["value"]): { x: number; y: number; z: number } | null {
  switch (value.tag) {
    case "BoundingBox3D": return value.value.pose.positionM;
    case "BoundingBox2D": return null;
    case "Mesh": return value.value.pose.positionM;
    case "PointCloud": return null;
  }
}

function geometryImageBox(value: RelevantGeometryRow["value"]): OperatorProjection["evidence"][number]["imageBox"] {
  if (value.tag !== "BoundingBox2D") { return null; }
  return {
    angleRad: value.value.angleRad,
    centerX: value.value.centerX,
    centerY: value.value.centerY,
    frame: {
      capturedAt: value.value.frame.capturedAt.toISOString(),
      sequence: value.value.frame.sequence.toString(10),
      sessionId: value.value.frame.sessionId,
      streamId: value.value.frame.streamId,
    },
    height: value.value.height,
    width: value.value.width,
  };
}

function geometryResources(value: RelevantGeometryRow["value"]): OperatorProjection["evidence"][number]["resources"] {
  if (value.tag === "PointCloud" || value.tag === "Mesh") { return [resourceReference(value.value.resource)]; }
  return [];
}

function resourceReference(value: ResourceRef): OperatorProjection["evidence"][number]["resources"][number] {
  return {
    byteLength: value.byteLength.toString(10),
    id: value.id,
    schema: value.schema,
    sha256: value.sha256
  };
}

function criterionLabel(value: AssignedMissionRow["spec"]["objectives"][number]["criterion"]): string {
  switch (value.tag) {
    case "Observed": return "observed";
    case "Approached": return "approached";
    case "Located": return "located";
    default: return "unknown";
  }
}

function missionState(value: AssignedMissionRow["state"]): OperatorMission["state"] {
  switch (value.tag) {
    case "Active": return "active";
    case "Closing": return "closing";
    case "Succeeded": return "succeeded";
    case "Failed": return "failed";
    case "Cancelled": return "cancelled";
    default: return "unknown";
  }
}

function actionLabel(value: RelevantExecutionRow["input"]): string {
  switch (value.tag) {
    case "Navigate": return "navigate@1";
    case "Approach": return "approach@1";
    default: return "unknown";
  }
}

function executionState(value: RelevantExecutionRow["state"]): OperatorProjection["executions"][number]["state"] {
  switch (value.tag) {
    case "Accepted": return "accepted";
    case "Running": return "running";
    case "Cancelling": return "cancelling";
    case "Succeeded": return "succeeded";
    case "Cancelled": return "cancelled";
    case "Failed": return "failed";
    default: return "unknown";
  }
}

function worldMode(value: string | undefined): OperatorProjection["readiness"]["mode"] {
  if (value === "simulation") { return "simulation"; }
  if (value === "physical") { return "physical"; }
  return "unknown";
}

function toIso(value: { toISOString: () => string } | undefined): string | null {
  return value?.toISOString() ?? null;
}
