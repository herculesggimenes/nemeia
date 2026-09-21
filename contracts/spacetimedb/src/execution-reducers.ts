import { type Infer } from "spacetimedb";
import { t } from "spacetimedb/server";
import {
  audit,
  canonical,
  db,
  key,
  memberFor,
  requireRole,
  type WorldContext,
} from "./registration.ts";
import {
  actionBinding,
  agent,
  execution,
  geometry,
  localMap,
  mission,
  observation,
  spatialFrame,
  unitAssignment,
  unitControl,
} from "./schema.ts";
import {
  ActionBindingPolicy,
  ActionIntent,
  AssignmentPin,
  ExecutionResult,
  ExecutionSafetyProof,
  MissionLink,
  type ActionIntent as ActionIntentValue,
  type ExecutionResult as ExecutionResultValue,
} from "./values.ts";

type ExecutionRow = Infer<typeof execution.rowType>;
type BindingRow = Infer<typeof actionBinding.rowType>;
type MissionLinkValue = Infer<typeof MissionLink>;
type AssignmentPinValue = Infer<typeof AssignmentPin>;
type Result = ExecutionResultValue;
type SafetyProof = Infer<typeof ExecutionSafetyProof>;
type NavigateIntentValue = Extract<ActionIntentValue, { tag: "navigate" }>;
type ApproachIntentValue = Extract<ActionIntentValue, { tag: "approach" }>;
type ObservationRow = Infer<typeof observation.rowType>;
type ActionBasis = {
  targetFrameId: string | undefined;
  targetBasisObservationId: string | undefined;
};
type CompletionPose = {
  observation: ObservationRow;
  frameId: string;
  positionM: { x: number; y: number; z: number };
  observedAt: bigint;
};

function operatorOrAdmin(ctx: WorldContext) {
  return requireRole(ctx, "world_operator", "admin");
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`invalid_${name}`);
}

function validatePose(pose: NavigateIntentValue["value"]["target"]): void {
  finite(pose.positionM.x, "target_x");
  finite(pose.positionM.y, "target_y");
  finite(pose.positionM.z, "target_z");
  finite(pose.orientation.x, "target_qx");
  finite(pose.orientation.y, "target_qy");
  finite(pose.orientation.z, "target_qz");
  finite(pose.orientation.w, "target_qw");
  const norm = Math.hypot(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
  if (Math.abs(norm - 1) > 1e-3) throw new Error("invalid_target_quaternion");
}

function actionName(input: ActionIntentValue): "navigate@1" | "approach@1" {
  return input.tag === "navigate" ? "navigate@1" : "approach@1";
}

function bindingFor(ctx: WorldContext, unitId: string, input: ActionIntentValue, version: bigint): BindingRow {
  const row = ctx.db.actionBinding.key.find(key(unitId, actionName(input)));
  if (!row || row.version !== version) throw new Error("action_binding_revision_conflict");
  if (row.actionName !== actionName(input) || row.policy.maxRunMs === 0 || row.policy.maxLinearMps <= 0 || row.policy.toleranceM < 0) {
    throw new Error("invalid_action_binding");
  }
  return row;
}

function validateActionTarget(ctx: WorldContext, unitId: string, input: ActionIntentValue, targetVersion: bigint): ActionBasis {
  if (input.tag === "navigate") {
    validatePose(input.value.target);
    const map = ctx.db.localMap.id.find(input.value.mapId);
    if (!map || map.unitId !== unitId || map.headRevision !== input.value.basisRevision || targetVersion !== input.value.basisRevision) {
      throw new Error("navigation_map_revision_conflict");
    }
    const frame = ctx.db.spatialFrame.id.find(input.value.targetFrameId);
    if (!frame || frame.unitId !== unitId) throw new Error("navigation_frame_missing");
    return { targetFrameId: input.value.targetFrameId, targetBasisObservationId: undefined };
  }
  finite(input.value.standoffM, "standoff");
  if (input.value.standoffM <= 0) throw new Error("invalid_standoff");
  if (targetVersion !== input.value.expectedGeometryVersion) throw new Error("geometry_revision_conflict");
  const entity = ctx.db.entity.id.find(input.value.targetId);
  if (!entity || entity.removedAt) throw new Error("target_entity_missing");
  let found = false;
  let targetFrameId: string | undefined;
  let targetBasisObservationId: string | undefined;
  for (const row of ctx.db.geometry.iter()) {
    if (row.entityId !== input.value.targetId || row.version !== input.value.expectedGeometryVersion) continue;
    if (row.value.tag !== "boundingBox3D") continue;
    const frame = ctx.db.spatialFrame.id.find(row.value.value.frameId);
    if (!frame || frame.unitId !== unitId) throw new Error("target_geometry_frame_invalid");
    found = true;
    targetFrameId = row.value.value.frameId;
    targetBasisObservationId = row.observationId;
  }
  if (!found) throw new Error("target_geometry_missing");
  return { targetFrameId, targetBasisObservationId };
}

function validatePinnedApproachTarget(ctx: WorldContext, row: ExecutionRow): void {
  if (row.input.tag !== "approach") return;
  if (!row.targetFrameId || !row.targetBasisObservationId) throw new Error("target_geometry_basis_missing");
  const frame = ctx.db.spatialFrame.id.find(row.targetFrameId);
  if (!frame || frame.unitId !== row.unitId) throw new Error("target_geometry_frame_invalid");
  const basisObservation = ctx.db.observation.id.find(row.targetBasisObservationId);
  const basisGeometry = basisObservation?.input.geometry;
  if (!basisObservation || basisObservation.unitId !== row.unitId || basisObservation.entityId !== row.input.value.targetId ||
      !basisGeometry || basisGeometry.value.tag !== "boundingBox3D" || basisGeometry.value.value.frameId !== row.targetFrameId) {
    throw new Error("target_geometry_basis_missing");
  }
}

function validateTargetFreshness(ctx: WorldContext, row: ExecutionRow, maxEvidenceAgeMs: number): void {
  const unitId = row.unitId;
  const input = row.input;
  const now = ctx.timestamp.microsSinceUnixEpoch;
  const maxAge = BigInt(maxEvidenceAgeMs) * 1_000n;
  if (input.tag === "navigate") {
    const map = ctx.db.localMap.id.find(input.value.mapId);
    if (!map || map.unitId !== unitId) throw new Error("navigation_map_missing");
    const age = now - map.updatedAt.microsSinceUnixEpoch;
    if (age < 0n || age > maxAge) throw new Error("navigation_evidence_stale");
    return;
  }
  const basisObservation = row.targetBasisObservationId
    ? ctx.db.observation.id.find(row.targetBasisObservationId)
    : undefined;
  const observedAt = basisObservation?.input.geometry?.observedAt.microsSinceUnixEpoch;
  if (observedAt === undefined || now - observedAt < 0n || now - observedAt > maxAge) {
    throw new Error("target_geometry_stale");
  }
}

function objectiveForMission(ctx: WorldContext, link: MissionLinkValue) {
  const row = ctx.db.mission.id.find(link.missionId);
  if (!row || row.state.tag !== "active") throw new Error("mission_not_active");
  if (row.revision !== link.expectedRevision) throw new Error("mission_revision_conflict");
  if (row.spec.deadlineAt && row.spec.deadlineAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error("mission_deadline_expired");
  }
  const objective = row.spec.objectives.find((candidate) => candidate.id === link.objectiveId);
  if (!objective) throw new Error("unknown_objective");
  for (const dependency of objective.dependsOn) {
    if (!ctx.db.missionObjectiveProgress.key.find(key(link.missionId, dependency))) {
      throw new Error("objective_dependency_not_complete");
    }
  }
  return { row, objective };
}

function validateObjectiveAction(action: ActionIntentValue, objective: Infer<typeof import("./missions.ts").ObjectiveSpec>): void {
  if (action.tag !== "approach") return;
  if (objective.criterion.tag !== "approached" || objective.criterion.value.targetId !== action.value.targetId ||
      objective.criterion.value.standoffM !== action.value.standoffM) {
    throw new Error("action_objective_mismatch");
  }
}

function validateGrant(ctx: WorldContext, unitId: string, pin: AssignmentPinValue, input: ActionIntentValue): void {
  const agentRow = ctx.db.agent.id.find(pin.agentId);
  if (!agentRow || agentRow.paused) throw new Error("agent_unavailable");
  const assignment = ctx.db.unitAssignment.unitId.find(unitId);
  if (!assignment || assignment.agentId !== pin.agentId || assignment.revision !== pin.revision ||
      !assignment.actionNames.includes(actionName(input))) {
    throw new Error("unit_action_not_granted");
  }
  if (assignment.expiresAt && assignment.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error("unit_grant_expired");
  }
}

function noActiveReservation(ctx: WorldContext, unitId: string): void {
  const control = ctx.db.unitControl.unitId.find(unitId);
  if (!control) throw new Error("unit_control_missing");
  if (control.activeExecutionId !== undefined) {
    const active = ctx.db.execution.id.find(control.activeExecutionId);
    if (active && ["accepted", "running", "cancelling"].includes(active.state.tag)) {
      throw new Error("unit_already_reserved");
    }
  }
  for (const row of ctx.db.execution.unitId.filter(unitId)) {
    if (["accepted", "running", "cancelling"].includes(row.state.tag)) throw new Error("unit_already_reserved");
  }
}

function requestFingerprint(input: {
  unitId: string;
  missionLink: MissionLinkValue | undefined;
  assignment: AssignmentPinValue | undefined;
  action: ActionIntentValue;
  bindingVersion: bigint;
  targetVersion: bigint;
  acceptBy: unknown;
}): string {
  return canonical({
    unitId: input.unitId,
    missionLink: input.missionLink,
    assignment: input.assignment,
    input: input.action,
    bindingVersion: input.bindingVersion,
    targetVersion: input.targetVersion,
    acceptBy: input.acceptBy,
  });
}

function sameRequest(row: ExecutionRow, ctx: WorldContext, fingerprint: string): boolean {
  return row.requestedBy.isEqual(ctx.sender) && row.requestFingerprint === fingerprint;
}

function requireExecutionController(ctx: WorldContext, row: ExecutionRow): { unit: Infer<typeof unitControl.rowType> } {
  const member = requireRole(ctx, "controller");
  if (member.unitId !== row.unitId) throw new Error("controller_unit_scope_mismatch");
  const control = ctx.db.unitControl.unitId.find(row.unitId);
  if (!control || !control.controller.isEqual(ctx.sender)) throw new Error("controller_not_authorized");
  return { unit: control };
}

function resultReceiptId(result: Result): string | undefined {
  return result.tag === "succeeded" ? result.value.completion.value.localReceiptId : result.value.localReceiptId;
}

function distance3(left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function completionObservationAfterClaim(
  ctx: WorldContext,
  row: ExecutionRow,
  observationId: string,
  kind: "unit" | "target",
): ObservationRow {
  const candidate = ctx.db.observation.id.find(observationId);
  if (!row.claimedAt || !candidate || candidate.unitId !== row.unitId ||
      candidate.recordedAt.microsSinceUnixEpoch <= row.claimedAt.microsSinceUnixEpoch ||
      candidate.recordedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error(`${kind}_completion_observation_stale`);
  }
  return candidate;
}

function unitCompletionPose(ctx: WorldContext, row: ExecutionRow, observationId: string): CompletionPose {
  const observation = completionObservationAfterClaim(ctx, row, observationId, "unit");
  if (observation.entityId !== row.unitId || observation.input.entityId !== undefined && observation.input.entityId !== row.unitId) {
    throw new Error("unit_completion_entity_mismatch");
  }
  const pose = observation.input.pose;
  if (!row.claimedAt || !pose || pose.observedAt.microsSinceUnixEpoch <= row.claimedAt.microsSinceUnixEpoch ||
      pose.observedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error("unit_completion_pose_stale");
  }
  finite(pose.value.positionM.x, "unit_completion_x");
  finite(pose.value.positionM.y, "unit_completion_y");
  finite(pose.value.positionM.z, "unit_completion_z");
  return {
    observation,
    frameId: pose.frameId,
    positionM: pose.value.positionM,
    observedAt: pose.observedAt.microsSinceUnixEpoch,
  };
}

function validateNavigateCompletion(ctx: WorldContext, row: ExecutionRow, observationId: string): void {
  if (row.input.tag !== "navigate") throw new Error("completion_action_mismatch");
  const targetFrameId = row.targetFrameId ?? row.input.value.targetFrameId;
  const targetFrame = ctx.db.spatialFrame.id.find(targetFrameId);
  if (!targetFrame || targetFrame.unitId !== row.unitId) throw new Error("navigation_completion_frame_unknown");
  const measured = unitCompletionPose(ctx, row, observationId);
  if (measured.frameId !== targetFrameId) throw new Error("navigation_completion_frame_mismatch");
  finite(row.binding.toleranceM, "binding_tolerance");
  const residualM = distance3(measured.positionM, row.input.value.target.positionM);
  finite(residualM, "navigation_residual");
  if (residualM > row.binding.toleranceM) throw new Error("navigation_residual_out_of_tolerance");
}

function validateApproachCompletion(
  ctx: WorldContext,
  row: ExecutionRow,
  completion: Extract<Extract<Result, { tag: "succeeded" }>["value"]["completion"], { tag: "approach" }>,
): void {
  if (row.input.tag !== "approach") throw new Error("completion_action_mismatch");
  finite(row.binding.toleranceM, "binding_tolerance");
  finite(completion.value.measuredDistanceM, "measured_distance");
  if (completion.value.measuredDistanceM < 0) throw new Error("invalid_measured_distance");
  const targetFrameId = row.targetFrameId;
  if (!targetFrameId) throw new Error("target_geometry_basis_missing");
  const targetFrame = ctx.db.spatialFrame.id.find(targetFrameId);
  if (!targetFrame || targetFrame.unitId !== row.unitId) throw new Error("target_geometry_frame_invalid");
  const measuredUnit = unitCompletionPose(ctx, row, completion.value.unitObservationId);
  if (measuredUnit.frameId !== targetFrameId) throw new Error("approach_unit_frame_mismatch");

  const targetObservation = completionObservationAfterClaim(ctx, row, completion.value.targetObservationId, "target");
  if (targetObservation.entityId !== row.input.value.targetId ||
      targetObservation.input.entityId !== undefined && targetObservation.input.entityId !== row.input.value.targetId) {
    throw new Error("approach_target_entity_mismatch");
  }
  const targetGeometry = targetObservation.input.geometry;
  if (!targetGeometry || targetGeometry.value.tag !== "boundingBox3D" ||
      targetGeometry.value.value.frameId !== targetFrameId ||
      !row.claimedAt || targetGeometry.observedAt.microsSinceUnixEpoch <= row.claimedAt.microsSinceUnixEpoch ||
      targetGeometry.observedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error("approach_target_frame_mismatch");
  }
  finite(targetGeometry.value.value.pose.positionM.x, "target_completion_x");
  finite(targetGeometry.value.value.pose.positionM.y, "target_completion_y");
  finite(targetGeometry.value.value.pose.positionM.z, "target_completion_z");
  const computedDistanceM = distance3(measuredUnit.positionM, targetGeometry.value.value.pose.positionM);
  finite(computedDistanceM, "computed_distance");
  if (Math.abs(completion.value.measuredDistanceM - computedDistanceM) > row.binding.toleranceM) {
    throw new Error("approach_measured_distance_mismatch");
  }
  if (Math.abs(computedDistanceM - row.input.value.standoffM) > row.binding.toleranceM) {
    throw new Error("approach_standoff_out_of_tolerance");
  }
}

function validateResult(ctx: WorldContext, row: ExecutionRow, result: Result): void {
  const receiptId = resultReceiptId(result);
  if (result.tag === "succeeded") {
    if (!receiptId?.trim()) throw new Error("local_receipt_required");
    if (row.input.tag === "navigate") {
      if (result.value.completion.tag !== "navigate") throw new Error("completion_action_mismatch");
      validateNavigateCompletion(ctx, row, result.value.completion.value.unitObservationId);
    } else {
      if (result.value.completion.tag !== "approach") throw new Error("completion_action_mismatch");
      validateApproachCompletion(ctx, row, result.value.completion);
    }
  } else if (result.tag === "cancelled" && !receiptId?.trim()) {
    throw new Error("local_receipt_required");
  }
}

function validateSafetyProof(ctx: WorldContext, row: ExecutionRow, proof: SafetyProof, controllerEpoch: bigint): void {
  if (proof.executionId !== row.id || proof.unitId !== row.unitId || proof.controllerEpoch !== controllerEpoch ||
      proof.observedAt.microsSinceUnixEpoch <= row.updatedAt.microsSinceUnixEpoch ||
      proof.observedAt.microsSinceUnixEpoch > ctx.timestamp.microsSinceUnixEpoch) {
    throw new Error("invalid_execution_safety_proof");
  }
  const observation = ctx.db.observation.id.find(proof.observationId);
  if (!observation || observation.unitId !== row.unitId || observation.recordedAt.microsSinceUnixEpoch > proof.observedAt.microsSinceUnixEpoch) {
    throw new Error("safety_proof_observation_missing");
  }
}

function closeUnitReservation(ctx: WorldContext, row: ExecutionRow, control: Infer<typeof unitControl.rowType>): void {
  if (control.activeExecutionId === row.id) {
    ctx.db.unitControl.unitId.update({ ...control, activeExecutionId: undefined, observedAt: ctx.timestamp });
  }
}

export const requestExecution = db.reducer(
  { name: "request_execution" },
  {
    executionId: t.string(),
    unitId: t.string(),
    assignment: t.option(AssignmentPin),
    missionLink: t.option(MissionLink),
    input: ActionIntent,
    bindingVersion: t.u64(),
    targetVersion: t.u64(),
    acceptBy: t.timestamp(),
  },
  (ctx, input) => {
    const member = memberFor(ctx);
    if (member.role.tag !== "agent" && member.role.tag !== "world_operator" && member.role.tag !== "admin") {
      throw new Error("forbidden_execution_requester");
    }
    const existing = ctx.db.execution.id.find(input.executionId);
    const fingerprint = requestFingerprint({
      unitId: input.unitId,
      missionLink: input.missionLink,
      assignment: input.assignment,
      action: input.input,
      bindingVersion: input.bindingVersion,
      targetVersion: input.targetVersion,
      acceptBy: input.acceptBy,
    });
    if (existing) {
      if (!sameRequest(existing, ctx, fingerprint)) {
        throw new Error("execution_idempotency_conflict");
      }
      return;
    }
    if (!input.executionId.trim() || input.acceptBy.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch) {
      throw new Error("execution_acceptance_expired");
    }
    const binding = bindingFor(ctx, input.unitId, input.input, input.bindingVersion);
    const world = ctx.db.worldConfig.id.find(0);
    if (!world || world.mode.tag !== "simulation" || binding.policy.mode.tag !== "simulation") {
      throw new Error("physical_adapter_not_qualified");
    }
    if (member.role.tag === "agent") {
      const ownAgent = ctx.db.agent.principal.find(ctx.sender);
      if (!ownAgent || !input.assignment || input.assignment.agentId !== ownAgent.id) throw new Error("agent_assignment_required");
    }
    if (input.assignment) validateGrant(ctx, input.unitId, input.assignment, input.input);
    if (input.missionLink) {
      const { objective } = objectiveForMission(ctx, input.missionLink);
      validateObjectiveAction(input.input, objective);
      if (input.assignment) {
        const membership = ctx.db.missionAgent.key.find(key(input.missionLink.missionId, input.assignment.agentId));
        if (!membership?.active) throw new Error("mission_agent_not_active");
      }
      for (const row of ctx.db.execution.byMission.filter(input.missionLink.missionId)) {
        if (["accepted", "running", "cancelling"].includes(row.state.tag)) throw new Error("mission_execution_already_active");
      }
    }
    const actionBasis = validateActionTarget(ctx, input.unitId, input.input, input.targetVersion);
    const control = ctx.db.unitControl.unitId.find(input.unitId);
    if (!control || control.stopLatched || !control.safeStateConfirmed) throw new Error("unit_not_safe_for_admission");
    noActiveReservation(ctx, input.unitId);
    const row: ExecutionRow = {
      id: input.executionId,
      requestedBy: ctx.sender,
      agentId: input.assignment?.agentId,
      unitId: input.unitId,
      missionId: input.missionLink?.missionId,
      objectiveId: input.missionLink?.objectiveId,
      missionRevision: input.missionLink?.expectedRevision,
      assignmentRevision: input.assignment?.revision,
      requestFingerprint: fingerprint,
      acceptBy: input.acceptBy,
      input: input.input,
      binding: binding.policy,
      bindingVersion: binding.version,
      targetVersion: input.targetVersion,
      claimedAt: undefined,
      targetFrameId: actionBasis.targetFrameId,
      targetBasisObservationId: actionBasis.targetBasisObservationId,
      state: { tag: "accepted" },
      controller: undefined,
      controllerEpoch: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
      result: undefined,
      receiptId: undefined,
      safeStateProof: undefined,
    };
    ctx.db.execution.insert(row);
    audit(ctx, "execution.accepted", row.id, canonical({
      executionId: row.id,
      requestedBy: row.requestedBy,
      unitId: row.unitId,
      agentId: row.agentId,
      missionLink: input.missionLink,
      assignment: input.assignment,
      input: row.input,
      binding: row.binding,
      bindingVersion: row.bindingVersion,
      targetVersion: row.targetVersion,
      requestFingerprint: row.requestFingerprint,
      acceptBy: input.acceptBy,
    }));
  },
);

export const claimExecution = db.reducer(
  { name: "claim_execution" },
  { executionId: t.string(), expectedEpoch: t.u64() },
  (ctx, input) => {
    const member = requireRole(ctx, "controller");
    const row = ctx.db.execution.id.find(input.executionId);
    if (!row) throw new Error("execution_missing");
    if (member.unitId !== row.unitId) throw new Error("controller_unit_scope_mismatch");
    if (row.state.tag !== "accepted") return;
    const control = ctx.db.unitControl.unitId.find(row.unitId);
    if (!control || !control.controller.isEqual(ctx.sender) || control.epoch !== input.expectedEpoch ||
        control.stopLatched || !control.safeStateConfirmed || control.activeExecutionId !== undefined) {
      throw new Error("execution_claim_fenced");
    }
    if (ctx.timestamp.microsSinceUnixEpoch >= row.acceptBy.microsSinceUnixEpoch) {
      throw new Error("execution_acceptance_expired");
    }
    if (row.agentId) {
      const agentRow = ctx.db.agent.id.find(row.agentId);
      const assignment = ctx.db.unitAssignment.unitId.find(row.unitId);
      if (!agentRow || agentRow.paused || row.assignmentRevision === undefined ||
          !assignment || assignment.agentId !== row.agentId || assignment.revision !== row.assignmentRevision ||
          assignment.expiresAt && assignment.expiresAt.microsSinceUnixEpoch <= ctx.timestamp.microsSinceUnixEpoch ||
          !assignment.actionNames.includes(actionName(row.input))) {
        throw new Error("unit_action_not_granted");
      }
    }
    if (row.missionId) {
      const missionRow = ctx.db.mission.id.find(row.missionId);
      if (!missionRow || missionRow.state.tag !== "active" || row.missionRevision === undefined || missionRow.revision !== row.missionRevision) {
        throw new Error("mission_revision_conflict");
      }
      if (row.objectiveId === undefined) throw new Error("mission_objective_missing");
      const objective = missionRow.spec.objectives.find((candidate) => candidate.id === row.objectiveId);
      if (!objective) throw new Error("unknown_objective");
      for (const dependency of objective.dependsOn) {
        if (!ctx.db.missionObjectiveProgress.key.find(key(row.missionId, dependency))) {
          throw new Error("objective_dependency_not_complete");
        }
      }
      validateObjectiveAction(row.input, objective);
    }
    const binding = bindingFor(ctx, row.unitId, row.input, row.bindingVersion);
    if (binding.policy.mode.tag !== "simulation" || canonical(binding.policy) !== canonical(row.binding)) {
      throw new Error("physical_adapter_not_qualified");
    }
    if (row.input.tag === "approach") validatePinnedApproachTarget(ctx, row);
    else validateActionTarget(ctx, row.unitId, row.input, row.targetVersion);
    validateTargetFreshness(ctx, row, binding.policy.maxEvidenceAgeMs);
    // Admission-time safe state is not completion proof. Claim starts a new
    // effect window and requires a fresh post-claim control report before any
    // result can close the reservation.
    ctx.db.unitControl.unitId.update({
      ...control,
      activeExecutionId: row.id,
      safeStateConfirmed: false,
      observedAt: ctx.timestamp,
    });
    ctx.db.execution.id.update({ ...row, claimedAt: ctx.timestamp, state: { tag: "running" }, controller: ctx.sender, controllerEpoch: control.epoch, updatedAt: ctx.timestamp });
    audit(ctx, "execution.claimed", row.id, `controllerEpoch=${control.epoch}`);
  },
);

export const requestExecutionCancel = db.reducer(
  { name: "request_execution_cancel" },
  { executionId: t.string() },
  (ctx, input) => {
    const member = memberFor(ctx);
    const row = ctx.db.execution.id.find(input.executionId);
    if (!row) throw new Error("execution_missing");
    const allowed = member.role.tag === "world_operator" || member.role.tag === "admin" ||
      (member.role.tag === "agent" && row.requestedBy.isEqual(ctx.sender)) ||
      (member.role.tag === "controller" && member.unitId === row.unitId);
    if (!allowed) throw new Error("forbidden_execution_cancel");
    if (row.state.tag === "succeeded" || row.state.tag === "cancelled" || row.state.tag === "failed" || row.state.tag === "cancelling") return;
    ctx.db.execution.id.update({ ...row, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
    audit(ctx, "execution.cancel_requested", row.id, "Await local measured safe-state receipt");
  },
);

export const reportControl = db.reducer(
  { name: "report_control" },
  {
    unitId: t.string(),
    epoch: t.u64(),
    stopLatched: t.bool(),
    safeStateConfirmed: t.bool(),
  },
  (ctx, input) => {
    const member = requireRole(ctx, "controller");
    if (member.unitId !== input.unitId) throw new Error("controller_unit_scope_mismatch");
    const control = ctx.db.unitControl.unitId.find(input.unitId);
    if (!control || !control.controller.isEqual(ctx.sender)) throw new Error("controller_not_authorized");
    if (input.epoch < control.epoch) throw new Error("controller_epoch_fenced");
    const active = control.activeExecutionId ? ctx.db.execution.id.find(control.activeExecutionId) : undefined;
    if (input.epoch > control.epoch && active && active.state.tag !== "cancelling" && active.state.tag !== "cancelled") {
      throw new Error("controller_epoch_change_requires_recovery");
    }
    ctx.db.unitControl.unitId.update({
      ...control,
      epoch: input.epoch,
      stopLatched: input.stopLatched,
      safeStateConfirmed: input.safeStateConfirmed,
      observedAt: ctx.timestamp,
    });
    audit(ctx, "unit.control_reported", input.unitId, `epoch=${input.epoch};stopLatched=${input.stopLatched};safe=${input.safeStateConfirmed}`);
  },
);

export const reconcileExecution = db.reducer(
  { name: "reconcile_execution" },
  { executionId: t.string(), expectedEpoch: t.u64() },
  (ctx, input) => {
    const row = ctx.db.execution.id.find(input.executionId);
    if (!row) throw new Error("execution_missing");
    const { unit } = requireExecutionController(ctx, row);
    if (row.state.tag !== "cancelling") return;
    if (unit.epoch !== input.expectedEpoch || !unit.stopLatched || !unit.safeStateConfirmed) {
      throw new Error("safe_recovery_proof_required");
    }
    ctx.db.execution.id.update({ ...row, controller: ctx.sender, controllerEpoch: unit.epoch, updatedAt: ctx.timestamp });
    audit(ctx, "execution.reconciled", row.id, `controllerEpoch=${unit.epoch};safeStateConfirmed=true`);
  },
);

export const finishExecution = db.reducer(
  { name: "finish_execution" },
  {
    executionId: t.string(),
    controllerEpoch: t.u64(),
    result: ExecutionResult,
    safeProof: t.option(ExecutionSafetyProof),
  },
  (ctx, input) => {
    const row = ctx.db.execution.id.find(input.executionId);
    if (!row) throw new Error("execution_missing");
    const member = requireRole(ctx, "controller");
    if (member.unitId !== row.unitId) throw new Error("controller_unit_scope_mismatch");
    const unit = ctx.db.unitControl.unitId.find(row.unitId);
    if (!unit || !unit.controller.isEqual(ctx.sender) || unit.epoch !== input.controllerEpoch) {
      throw new Error("execution_epoch_fenced");
    }
    if (row.controller) {
      if (!row.controller.isEqual(ctx.sender) || row.controllerEpoch !== input.controllerEpoch) {
        throw new Error("execution_epoch_fenced");
      }
    } else if (row.state.tag !== "cancelling") {
      throw new Error("execution_claim_required");
    }
    if (row.state.tag === "succeeded" || row.state.tag === "cancelled" || row.state.tag === "failed") {
      audit(ctx, "execution.late_fact", row.id, canonical({ result: input.result, safeProof: input.safeProof }));
      return;
    }
    if (input.result.tag === "cancelled" && row.state.tag !== "cancelling") {
      throw new Error("cancellation_not_requested");
    }
    validateResult(ctx, row, input.result);
    if (input.result.tag === "failed" && !input.result.value.localReceiptId) {
      ctx.db.execution.id.update({ ...row, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
      audit(ctx, "execution.safe_closure_pending", row.id, "Failure has no authoritative local receipt");
      return;
    }
    if (!input.safeProof || !unit.safeStateConfirmed || unit.observedAt.microsSinceUnixEpoch < input.safeProof.observedAt.microsSinceUnixEpoch) {
      ctx.db.execution.id.update({ ...row, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
      audit(ctx, "execution.safe_closure_pending", row.id, "Fresh post-claim measured safe state is not confirmed");
      return;
    }
    validateSafetyProof(ctx, row, input.safeProof, input.controllerEpoch);
    const cancellationWins = row.state.tag === "cancelling";
    const nextState = cancellationWins ? { tag: "cancelled" as const } : input.result.tag === "succeeded" ? { tag: "succeeded" as const } : { tag: "failed" as const };
    ctx.db.execution.id.update({
      ...row,
      controller: row.controller ?? ctx.sender,
      controllerEpoch: row.controllerEpoch ?? input.controllerEpoch,
      state: nextState,
      result: input.result,
      receiptId: resultReceiptId(input.result),
      safeStateProof: input.safeProof,
      updatedAt: ctx.timestamp,
    });
    closeUnitReservation(ctx, row, unit);
    audit(ctx, cancellationWins && input.result.tag !== "cancelled" ? "execution.late_fact" : "execution.finished", row.id, canonical({ state: nextState, result: input.result, safeProof: input.safeProof }));
  },
);

// These imports document the frozen table/type seam used above. Reducer
// inputs remain generated ActionIntent/ExecutionResult values; the controller
// adapter performs the separate accepted-execution-to-command conversion.
void ActionBindingPolicy;
void agent;
void geometry;
void localMap;
void mission;
void observation;
void spatialFrame;
void unitAssignment;
