import { type Infer } from "spacetimedb";
import { t } from "spacetimedb/server";
import {
  audit,
  canonical,
  db,
  key,
  requireRole,
  type WorldContext,
} from "./registration.ts";
import { agent, execution, mission, missionObjectiveProgress } from "./schema.ts";
import {
  MissionEvidence,
  MissionOutcome,
  MissionSpec,
  MissionState,
  ObjectiveCriterion,
  type ObjectiveSpec,
  type MissionSpec as MissionSpecValue,
} from "./missions.ts";
import { ReadScope } from "./agents.ts";

type MissionRow = Infer<typeof mission.rowType>;
type Objective = ObjectiveSpec;
type Evidence = Infer<typeof MissionEvidence>;
type AgentRow = Infer<typeof agent.rowType>;

function operator(ctx: WorldContext) {
  return requireRole(ctx, "world_operator", "admin");
}

function nonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`invalid_${name}`);
}

function boundedNonEmpty(value: string, name: string, maximum: number): void {
  nonEmpty(value, name);
  if (value.length > maximum) throw new Error(`${name}_too_long`);
}

function nowMicros(ctx: WorldContext): bigint {
  return ctx.timestamp.microsSinceUnixEpoch;
}

function timestampMicros(value: { microsSinceUnixEpoch: bigint }): bigint {
  return value.microsSinceUnixEpoch;
}

function deadlineExpired(ctx: WorldContext, deadline: { microsSinceUnixEpoch: bigint } | undefined): boolean {
  return deadline !== undefined && timestampMicros(deadline) <= nowMicros(ctx);
}

function objectiveMap(spec: MissionSpecValue): Map<string, Objective> {
  return new Map(spec.objectives.map((objective) => [objective.id, objective]));
}

function criterionName(criterion: Infer<typeof ObjectiveCriterion>): string {
  return criterion.tag;
}

function validateCriterion(criterion: Infer<typeof ObjectiveCriterion>): void {
  switch (criterion.tag) {
    case "observed":
      nonEmpty(criterion.value.entityId, "criterion_entity_id");
      if (criterion.value.maxAgeMs === 0) throw new Error("invalid_criterion_max_age");
      break;
    case "approached":
      nonEmpty(criterion.value.targetId, "criterion_target_id");
      if (!Number.isFinite(criterion.value.standoffM) || criterion.value.standoffM <= 0) {
        throw new Error("invalid_criterion_standoff");
      }
      break;
    case "located":
      nonEmpty(criterion.value.description, "criterion_description");
      break;
  }
}

function validateSpec(ctx: WorldContext, spec: MissionSpecValue): void {
  nonEmpty(spec.description, "mission_description");
  if (spec.objectives.length === 0 || spec.objectives.length > 128) {
    throw new Error("invalid_objective_count");
  }
  const ids = new Set<string>();
  const objectives = objectiveMap(spec);
  let requiredCount = 0;
  for (const objective of spec.objectives) {
    nonEmpty(objective.id, "objective_id");
    nonEmpty(objective.description, "objective_description");
    if (ids.has(objective.id)) throw new Error("duplicate_objective_id");
    ids.add(objective.id);
    if (!objective.optional) requiredCount += 1;
    validateCriterion(objective.criterion);
    const dependencies = new Set<string>();
    for (const dependency of objective.dependsOn) {
      nonEmpty(dependency, "dependency_id");
      if (dependency === objective.id || dependencies.has(dependency)) {
        throw new Error("invalid_objective_dependency");
      }
      dependencies.add(dependency);
    }
  }
  if (requiredCount === 0) throw new Error("mission_requires_required_objective");
  for (const objective of spec.objectives) {
    for (const dependency of objective.dependsOn) {
      const dependencyObjective = objectives.get(dependency);
      if (!dependencyObjective) throw new Error("unknown_objective_dependency");
      if (dependencyObjective.optional && !objective.optional) {
        throw new Error("optional_objective_cannot_gate_required_objective");
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("objective_dependency_cycle");
    if (visited.has(id)) return;
    const objective = objectives.get(id);
    if (!objective) throw new Error("unknown_objective_dependency");
    visiting.add(id);
    for (const dependency of objective.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const objective of spec.objectives) visit(objective.id);

  if (spec.deadlineAt && deadlineExpired(ctx, spec.deadlineAt)) {
    throw new Error("mission_deadline_in_past");
  }
}

function objectiveFor(missionRow: MissionRow, objectiveId: string): Objective {
  const objective = missionRow.spec.objectives.find((candidate) => candidate.id === objectiveId);
  if (!objective) throw new Error("unknown_objective");
  return objective;
}

function progressFor(ctx: WorldContext, missionId: string, objectiveId: string) {
  return ctx.db.missionObjectiveProgress.key.find(key(missionId, objectiveId));
}

function dependenciesComplete(ctx: WorldContext, missionRow: MissionRow, objective: Objective): void {
  for (const dependency of objective.dependsOn) {
    if (!progressFor(ctx, missionRow.id, dependency)) throw new Error("objective_dependency_not_complete");
  }
}

function allRequiredComplete(ctx: WorldContext, missionRow: MissionRow): boolean {
  return missionRow.spec.objectives
    .filter((objective) => !objective.optional)
    .every((objective) => !!progressFor(ctx, missionRow.id, objective.id));
}

function evidenceObservationId(evidence: Evidence): string | undefined {
  switch (evidence.tag) {
    case "observation":
      return evidence.value.observationId;
    case "finding":
      return evidence.value.observationIds[0];
    case "execution":
      return undefined;
  }
}

function validateObservationEvidence(
  ctx: WorldContext,
  objective: Objective,
  evidence: Evidence,
): void {
  const criterion = objective.criterion;
  if (criterion.tag !== "observed") throw new Error("evidence_criterion_mismatch");
  if (evidence.tag !== "observation") throw new Error("evidence_criterion_mismatch");
  const observation = ctx.db.observation.id.find(evidence.value.observationId);
  if (!observation || observation.entityId !== criterion.value.entityId) {
    throw new Error("observation_evidence_missing");
  }
  const sample = criterion.value.facet.tag === "geometry"
    ? observation.input.geometry
    : observation.input.semantic;
  if (!sample) throw new Error("observation_facet_missing");
  const age = nowMicros(ctx) - timestampMicros(sample.observedAt);
  if (age < 0n || age > BigInt(criterion.value.maxAgeMs) * 1_000n) {
    throw new Error("observation_evidence_stale");
  }
}

function validateExecutionEvidence(
  ctx: WorldContext,
  missionRow: MissionRow,
  objective: Objective,
  evidence: Evidence,
): void {
  if (evidence.tag !== "execution") throw new Error("evidence_criterion_mismatch");
  const row = ctx.db.execution.id.find(evidence.value.executionId);
  if (!row || row.missionId !== missionRow.id || row.state.tag !== "succeeded" || !row.result || row.result.tag !== "succeeded") {
    throw new Error("execution_evidence_missing");
  }
  if (objective.criterion.tag !== "approached" || row.input.tag !== "approach") {
    throw new Error("evidence_criterion_mismatch");
  }
  if (row.input.value.targetId !== objective.criterion.value.targetId ||
      row.input.value.standoffM !== objective.criterion.value.standoffM) {
    throw new Error("execution_objective_mismatch");
  }
}

function validateFindingEvidence(
  ctx: WorldContext,
  objective: Objective,
  evidence: Evidence,
  reviewer: string,
): void {
  if (objective.criterion.tag !== "located" || evidence.tag !== "finding") {
    throw new Error("evidence_criterion_mismatch");
  }
  if (evidence.value.reviewedBy !== reviewer || evidence.value.observationIds.length === 0) {
    throw new Error("finding_review_required");
  }
  const ids = new Set<string>();
  for (const observationId of evidence.value.observationIds) {
    if (ids.has(observationId)) throw new Error("duplicate_finding_observation");
    ids.add(observationId);
    const observation = ctx.db.observation.id.find(observationId);
    if (!observation || observation.entityId !== evidence.value.entityId) {
      throw new Error("finding_evidence_missing");
    }
  }
}

function validateEvidence(
  ctx: WorldContext,
  missionRow: MissionRow,
  objective: Objective,
  evidence: Evidence,
): void {
  switch (evidence.tag) {
    case "observation":
      validateObservationEvidence(ctx, objective, evidence);
      break;
    case "execution":
      validateExecutionEvidence(ctx, missionRow, objective, evidence);
      break;
    case "finding":
      validateFindingEvidence(ctx, objective, evidence, ctx.sender.toHexString());
      break;
  }
}

function cancelLinkedExecutions(ctx: WorldContext, missionId: string, reason: string): void {
  for (const row of ctx.db.execution.byMission.filter(missionId)) {
    if (row.missionId !== missionId || (row.state.tag !== "accepted" && row.state.tag !== "running")) continue;
    ctx.db.execution.id.update({ ...row, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
    audit(ctx, "execution.cancel_requested", row.id, `mission=${missionId};reason=${reason}`);
  }
}

function activeExecutionExists(ctx: WorldContext, missionId: string): boolean {
  for (const row of ctx.db.execution.byMission.filter(missionId)) {
    if (row.missionId === missionId && ["accepted", "running", "cancelling"].includes(row.state.tag)) return true;
  }
  // A terminal execution is not enough to prove that its Unit reservation was
  // released. Keep the mission in closing while the control projection still
  // names an execution and has not confirmed a safe state; this covers an
  // interrupted finish/reconcile transaction without inventing an `unknown`
  // domain state in the frozen execution enum.
  for (const control of ctx.db.unitControl.iter()) {
    if (control.activeExecutionId === undefined) continue;
    const row = ctx.db.execution.id.find(control.activeExecutionId);
    if (row?.missionId === missionId && (!control.safeStateConfirmed || row.state.tag !== "succeeded" && row.state.tag !== "cancelled" && row.state.tag !== "failed")) {
      return true;
    }
  }
  return false;
}

function transitionToClosing(ctx: WorldContext, row: MissionRow, outcome: Infer<typeof MissionOutcome>): MissionRow {
  if (row.state.tag === "succeeded" || row.state.tag === "failed" || row.state.tag === "cancelled") return row;
  const next: MissionRow = {
    ...row,
    state: { tag: "closing" },
    closingOutcome: outcome,
    revision: row.revision + 1n,
    updatedAt: ctx.timestamp,
  };
  ctx.db.mission.id.update(next);
  cancelLinkedExecutions(ctx, row.id, `mission_closing:${outcome.tag}`);
  audit(ctx, "mission.closing", row.id, `outcome=${outcome.tag};revision=${next.revision}`);
  return next;
}

function finishIfSafe(ctx: WorldContext, row: MissionRow): void {
  if (row.state.tag !== "closing" || !row.closingOutcome || activeExecutionExists(ctx, row.id)) return;
  const state = row.closingOutcome.tag;
  const next: MissionRow = {
    ...row,
    state: { tag: state },
    closingOutcome: undefined,
    revision: row.revision + 1n,
    updatedAt: ctx.timestamp,
  };
  ctx.db.mission.id.update(next);
  audit(ctx, "mission.finished", row.id, `outcome=${state};revision=${next.revision}`);
}

export const configureAgent = db.reducer(
  { name: "configure_agent" },
  {
    agentId: t.string(),
    principal: t.identity(),
    displayName: t.string(),
    readScope: ReadScope,
    paused: t.bool(),
    expectedRevision: t.u64(),
  },
  (ctx, input) => {
    operator(ctx);
    nonEmpty(input.agentId, "agent_id");
    nonEmpty(input.displayName, "agent_display_name");
    const world = ctx.db.worldConfig.id.find(0);
    if (!world || input.readScope.worldId !== world.worldId) throw new Error("agent_scope_mismatch");
    const principalMember = ctx.db.member.identity.find(input.principal);
    if (!principalMember || principalMember.role.tag !== "agent" || principalMember.unitId !== undefined) {
      throw new Error("agent_principal_not_authorized");
    }
    const existing = ctx.db.agent.id.find(input.agentId);
    const principalOwner = ctx.db.agent.principal.find(input.principal);
    if (principalOwner && principalOwner.id !== input.agentId) throw new Error("agent_principal_conflict");
    if (!existing) {
      if (input.expectedRevision !== 0n) throw new Error("agent_revision_conflict");
      const row: AgentRow = {
        id: input.agentId,
        principal: input.principal,
        displayName: input.displayName,
        readScope: input.readScope,
        paused: input.paused,
        revision: 1n,
      };
      ctx.db.agent.insert(row);
      audit(ctx, "agent.configured", row.id, `principal=${input.principal.toHexString()};revision=${row.revision};paused=${row.paused}`);
      return;
    }
    if (existing.revision !== input.expectedRevision) throw new Error("agent_revision_conflict");
    if (existing.paused !== input.paused) throw new Error("agent_pause_requires_pause_reducer");
    const unchanged = existing.principal.isEqual(input.principal) && existing.displayName === input.displayName &&
      canonical(existing.readScope) === canonical(input.readScope);
    if (unchanged) return;
    const row: AgentRow = {
      ...existing,
      principal: input.principal,
      displayName: input.displayName,
      readScope: input.readScope,
      revision: existing.revision + 1n,
    };
    ctx.db.agent.id.update(row);
    for (const executionRow of ctx.db.execution.iter()) {
      if (executionRow.agentId === row.id &&
          (executionRow.state.tag === "accepted" || executionRow.state.tag === "running")) {
        ctx.db.execution.id.update({ ...executionRow, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
        audit(ctx, "execution.cancel_requested", executionRow.id, "agent_configuration_changed");
      }
    }
    audit(ctx, "agent.configured", row.id, `principal=${input.principal.toHexString()};revision=${row.revision};paused=${row.paused}`);
  },
);

export const createMission = db.reducer(
  { name: "create_mission" },
  { missionId: t.string(), spec: MissionSpec },
  (ctx, input) => {
    operator(ctx);
    nonEmpty(input.missionId, "mission_id");
    validateSpec(ctx, input.spec);
    const existing = ctx.db.mission.id.find(input.missionId);
    if (existing) {
      if (!existing.owner.isEqual(ctx.sender) || canonical(existing.spec) !== canonical(input.spec)) {
        throw new Error("mission_idempotency_conflict");
      }
      return;
    }
    const row: MissionRow = {
      id: input.missionId,
      owner: ctx.sender,
      spec: input.spec,
      state: { tag: "active" },
      revision: 1n,
      closingOutcome: undefined,
      feedbackSequence: undefined,
      createdAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    };
    ctx.db.mission.insert(row);
    audit(ctx, "mission.created", row.id, `revision=${row.revision};objectives=${row.spec.objectives.length}`);
  },
);

export const assignMission = db.reducer(
  { name: "assign_mission" },
  {
    missionId: t.string(),
    agentId: t.string(),
    expectedMissionRevision: t.u64(),
    expectedAgentRevision: t.u64(),
  },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.mission.id.find(input.missionId);
    const assignedAgent = ctx.db.agent.id.find(input.agentId);
    if (!row || !assignedAgent) throw new Error("mission_or_agent_missing");
    if (row.state.tag !== "active") throw new Error("mission_not_active");
    if (row.revision !== input.expectedMissionRevision || assignedAgent.revision !== input.expectedAgentRevision) {
      throw new Error("roster_revision_conflict");
    }
    if (assignedAgent.paused) throw new Error("agent_paused");
    const membershipKey = key(input.missionId, input.agentId);
    const existing = ctx.db.missionAgent.key.find(membershipKey);
    if (existing?.active) return;
    if (existing) ctx.db.missionAgent.key.update({ ...existing, active: true });
    else ctx.db.missionAgent.insert({ key: membershipKey, missionId: input.missionId, agentId: input.agentId, active: true });
    const next = { ...row, revision: row.revision + 1n, updatedAt: ctx.timestamp };
    ctx.db.mission.id.update(next);
    cancelLinkedExecutions(ctx, input.missionId, "mission_roster_changed");
    audit(ctx, "mission.participant_changed", input.missionId, `agent=${input.agentId};active=true;revision=${next.revision}`);
  },
);

export const revokeMission = db.reducer(
  { name: "revoke_mission" },
  { missionId: t.string(), agentId: t.string(), expectedMissionRevision: t.u64() },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.mission.id.find(input.missionId);
    if (!row) throw new Error("mission_missing");
    if (row.state.tag !== "active") throw new Error("mission_not_active");
    if (row.revision !== input.expectedMissionRevision) throw new Error("mission_revision_conflict");
    const membershipKey = key(input.missionId, input.agentId);
    const existing = ctx.db.missionAgent.key.find(membershipKey);
    if (!existing || !existing.active) return;
    ctx.db.missionAgent.key.update({ ...existing, active: false });
    for (const executionRow of ctx.db.execution.byMission.filter(input.missionId)) {
      if (executionRow.missionId === input.missionId && executionRow.agentId === input.agentId &&
          (executionRow.state.tag === "accepted" || executionRow.state.tag === "running")) {
        ctx.db.execution.id.update({ ...executionRow, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
        audit(ctx, "execution.cancel_requested", executionRow.id, "mission_agent_revoked");
      }
    }
    const next = { ...row, revision: row.revision + 1n, updatedAt: ctx.timestamp };
    ctx.db.mission.id.update(next);
    cancelLinkedExecutions(ctx, input.missionId, "mission_roster_changed");
    audit(ctx, "mission.participant_changed", input.missionId, `agent=${input.agentId};active=false;revision=${next.revision}`);
  },
);

export const assignUnit = db.reducer(
  { name: "assign_unit" },
  {
    unitId: t.string(),
    agentId: t.option(t.string()),
    expectedRevision: t.u64(),
    actionNames: t.array(t.string()),
    expiresAt: t.option(t.timestamp()),
  },
  (ctx, input) => {
    operator(ctx);
    const existing = ctx.db.unitAssignment.unitId.find(input.unitId);
    const currentRevision = existing?.revision ?? 0n;
    if (currentRevision !== input.expectedRevision) throw new Error("unit_assignment_revision_conflict");
    const names = [...new Set(input.actionNames)].sort();
    if (input.agentId === undefined && (names.length > 0 || input.expiresAt !== undefined)) {
      throw new Error("revoked_unit_must_have_no_actions");
    }
    const unit = ctx.db.unitControl.unitId.find(input.unitId);
    if (!unit) throw new Error("unit_control_missing");
    if (input.agentId !== undefined) {
      const assignedAgent = ctx.db.agent.id.find(input.agentId);
      if (!assignedAgent || assignedAgent.paused) throw new Error("agent_unavailable");
      if (input.expiresAt && deadlineExpired(ctx, input.expiresAt)) throw new Error("grant_expired");
      for (const actionName of names) {
        if (actionName !== "approach@1" && actionName !== "navigate@1") throw new Error("unsupported_action_name");
        const binding = ctx.db.actionBinding.key.find(key(input.unitId, actionName));
        if (!binding) throw new Error("action_binding_missing");
      }
    }
    if (existing && existing.agentId === input.agentId &&
        canonical({ actionNames: existing.actionNames, expiresAt: existing.expiresAt }) ===
        canonical({ actionNames: names, expiresAt: input.expiresAt })) return;
    const next = {
      unitId: input.unitId,
      agentId: input.agentId,
      revision: currentRevision + 1n,
      actionNames: names,
      expiresAt: input.expiresAt,
      updatedAt: ctx.timestamp,
    };
    if (existing) ctx.db.unitAssignment.unitId.update(next);
    else ctx.db.unitAssignment.insert(next);
    for (const executionRow of ctx.db.execution.unitId.filter(input.unitId)) {
      if (executionRow.state.tag !== "accepted" && executionRow.state.tag !== "running") continue;
      ctx.db.execution.id.update({ ...executionRow, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
      audit(ctx, "execution.cancel_requested", executionRow.id, "unit_assignment_changed");
    }
    audit(ctx, "unit.assignment_changed", input.unitId, `agent=${input.agentId ?? "none"};revision=${next.revision}`);
  },
);

export const pauseAgent = db.reducer(
  { name: "pause_agent" },
  { agentId: t.string(), paused: t.bool(), expectedRevision: t.u64() },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.agent.id.find(input.agentId);
    if (!row) throw new Error("agent_missing");
    if (row.revision !== input.expectedRevision) throw new Error("agent_revision_conflict");
    if (row.paused === input.paused) return;
    const next = { ...row, paused: input.paused, revision: row.revision + 1n };
    ctx.db.agent.id.update(next);
    if (input.paused) {
      for (const membership of ctx.db.missionAgent.iter()) {
        if (membership.agentId !== input.agentId || !membership.active) continue;
        ctx.db.missionAgent.key.update({ ...membership, active: false });
        const missionRow = ctx.db.mission.id.find(membership.missionId);
        if (missionRow && missionRow.state.tag === "active") {
          ctx.db.mission.id.update({ ...missionRow, revision: missionRow.revision + 1n, updatedAt: ctx.timestamp });
          cancelLinkedExecutions(ctx, missionRow.id, "agent_paused");
        }
      }
      for (const assignment of ctx.db.unitAssignment.iter()) {
        if (assignment.agentId !== input.agentId) continue;
        ctx.db.unitAssignment.unitId.update({
          ...assignment,
          agentId: undefined,
          revision: assignment.revision + 1n,
          actionNames: [],
          expiresAt: undefined,
          updatedAt: ctx.timestamp,
        });
      }
      for (const executionRow of ctx.db.execution.iter()) {
        if (executionRow.agentId === input.agentId &&
            (executionRow.state.tag === "accepted" || executionRow.state.tag === "running")) {
          ctx.db.execution.id.update({ ...executionRow, state: { tag: "cancelling" }, updatedAt: ctx.timestamp });
          audit(ctx, "execution.cancel_requested", executionRow.id, "agent_paused");
        }
      }
    }
    audit(ctx, "agent.configured", input.agentId, `paused=${input.paused};revision=${next.revision}`);
  },
);

export const cancelMission = db.reducer(
  { name: "cancel_mission" },
  { missionId: t.string(), expectedRevision: t.u64() },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.mission.id.find(input.missionId);
    if (!row) throw new Error("mission_missing");
    if (row.state.tag === "cancelled") return;
    if (row.state.tag === "succeeded" || row.state.tag === "failed") throw new Error("mission_terminal_immutable");
    if (row.revision !== input.expectedRevision) throw new Error("mission_revision_conflict");
    if (row.state.tag === "closing" && row.closingOutcome?.tag === "cancelled") return;
    transitionToClosing(ctx, row, { tag: "cancelled" });
  },
);

export const recordObjectiveProgress = db.reducer(
  { name: "record_objective_progress" },
  {
    missionId: t.string(),
    objectiveId: t.string(),
    expectedMissionRevision: t.u64(),
    evidence: MissionEvidence,
  },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.mission.id.find(input.missionId);
    if (!row) throw new Error("mission_missing");
    const existing = progressFor(ctx, input.missionId, input.objectiveId);
    if (existing) {
      if (canonical(existing.evidence) !== canonical(input.evidence)) throw new Error("objective_credit_conflict");
      return;
    }
    if (row.state.tag !== "active") throw new Error("mission_not_active");
    if (row.revision !== input.expectedMissionRevision) throw new Error("mission_revision_conflict");
    if (deadlineExpired(ctx, row.spec.deadlineAt)) throw new Error("mission_deadline_expired");
    const objective = objectiveFor(row, input.objectiveId);
    dependenciesComplete(ctx, row, objective);
    validateEvidence(ctx, row, objective, input.evidence);
    const progressKey = key(input.missionId, input.objectiveId);
    ctx.db.missionObjectiveProgress.insert({
      key: progressKey,
      missionId: input.missionId,
      objectiveId: input.objectiveId,
      evidence: input.evidence,
      recordedAt: ctx.timestamp,
    });
    audit(ctx, "mission.objective_credited", input.missionId, `objective=${input.objectiveId};evidence=${evidenceObservationId(input.evidence) ?? input.evidence.tag}`);
    if (allRequiredComplete(ctx, row)) transitionToClosing(ctx, row, { tag: "succeeded" });
  },
);

/**
 * Record bounded World Operator rejection feedback for a located finding.
 * This intentionally writes only the durable WorldEvent audit stream: no
 * progress row, mission revision, lifecycle transition, or new domain state
 * is created by a rejection.
 */
export const rejectObjectiveFinding = db.reducer(
  { name: "reject_objective_finding" },
  {
    missionId: t.string(),
    objectiveId: t.string(),
    entityId: t.string(),
    observationIds: t.array(t.string()),
    expectedMissionRevision: t.u64(),
    reason: t.string(),
  },
  (ctx, input) => {
    operator(ctx);
    boundedNonEmpty(input.missionId, "mission_id", 128);
    boundedNonEmpty(input.objectiveId, "objective_id", 128);
    boundedNonEmpty(input.entityId, "entity_id", 128);
    boundedNonEmpty(input.reason, "rejection_reason", 512);
    if (input.observationIds.length === 0 || input.observationIds.length > 32) {
      throw new Error("invalid_rejection_observation_count");
    }
    const row = ctx.db.mission.id.find(input.missionId);
    if (!row) throw new Error("mission_missing");
    if (row.state.tag !== "active") throw new Error("mission_not_active");
    if (row.revision !== input.expectedMissionRevision) throw new Error("mission_revision_conflict");
    const objective = objectiveFor(row, input.objectiveId);
    if (objective.criterion.tag !== "located") throw new Error("finding_rejection_requires_located_objective");
    const observationIds = new Set<string>();
    for (const observationId of input.observationIds) {
      boundedNonEmpty(observationId, "observation_id", 128);
      if (observationIds.has(observationId)) throw new Error("duplicate_rejection_observation");
      observationIds.add(observationId);
      const observation = ctx.db.observation.id.find(observationId);
      if (!observation || observation.entityId !== input.entityId) throw new Error("rejection_observation_missing");
    }
    const feedbackSequence = audit(ctx, "mission.finding_rejected", input.missionId, canonical({
      objectiveId: input.objectiveId,
      entityId: input.entityId,
      observationIds: [...observationIds],
      reason: input.reason,
      missionRevision: row.revision,
      reviewedBy: ctx.sender,
    }));
    ctx.db.mission.id.update({ ...row, feedbackSequence });
  },
);

export const reconcileMission = db.reducer(
  { name: "reconcile_mission" },
  { missionId: t.string() },
  (ctx, input) => {
    operator(ctx);
    const row = ctx.db.mission.id.find(input.missionId);
    if (!row) throw new Error("mission_missing");
    if (row.state.tag === "succeeded" || row.state.tag === "failed" || row.state.tag === "cancelled") return;
    if (row.state.tag === "active" && deadlineExpired(ctx, row.spec.deadlineAt)) {
      transitionToClosing(ctx, row, { tag: "failed" });
      return;
    }
    if (row.state.tag === "closing") {
      finishIfSafe(ctx, row);
      return;
    }
    if (row.state.tag === "active" && allRequiredComplete(ctx, row)) {
      transitionToClosing(ctx, row, { tag: "succeeded" });
    }
  },
);

// The reducer inputs intentionally use the generated tagged values, never a
// second controller ActionIntent shape. The imported schema table constants are
// only used for row inference and the registration seam owns the module db.
