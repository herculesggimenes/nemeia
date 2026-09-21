import { type Infer } from "spacetimedb";
import { t, type ViewCtx } from "spacetimedb/server";
import {
  agentMessage,
  actionBinding,
  agent,
  db,
  entity,
  execution,
  geometry,
  localMap,
  member,
  mission,
  missionAgent,
  missionObjectiveProgress,
  pose,
  semantic,
  unitControl,
  unitAssignment,
  type WorldDb,
} from "./schema.ts";
import { OBSERVED_BY_PREDICATE } from "./world-reducers.ts";

type WorldViewContext = ViewCtx<WorldDb["schemaType"]>;
type MemberRow = Infer<typeof member.rowType>;
type AgentMessageRow = Infer<typeof agentMessage.rowType>;
type AgentRow = Infer<typeof agent.rowType>;
type ActionBindingRow = Infer<typeof actionBinding.rowType>;
type EntityRow = Infer<typeof entity.rowType>;
type ExecutionRow = Infer<typeof execution.rowType>;
type LocalMapRow = Infer<typeof localMap.rowType>;
type MissionRow = Infer<typeof mission.rowType>;
type MissionAgentRow = Infer<typeof missionAgent.rowType>;
type MissionObjectiveProgressRow = Infer<typeof missionObjectiveProgress.rowType>;
type UnitControlRow = Infer<typeof unitControl.rowType>;
type UnitAssignmentRow = Infer<typeof unitAssignment.rowType>;
const ReadinessProjection = t.object("ReadinessProjection", {
  key: t.string(),
  worldId: t.string(),
  mode: t.string(),
  authorized: t.bool(),
  role: t.string(),
  unitId: t.option(t.string()),
  synchronized: t.bool(),
});

const FeedbackWatermark = t.object("FeedbackWatermark", {
  missionId: t.string(),
  sequence: t.u64(),
});

function currentMember(ctx: WorldViewContext): MemberRow | undefined {
  return ctx.db.member.identity.find(ctx.sender) ?? undefined;
}

function assignedUnitIds(ctx: WorldViewContext): string[] {
  const member = currentMember(ctx);
  if (!member) return [];
  if (member.unitId) return [member.unitId];
  if (member.role.tag !== "agent") return [];
  const agentRow = ctx.db.agent.principal.find(ctx.sender);
  if (!agentRow) return [];
  const rows = ctx.db.unitAssignment.byAgent.filter(agentRow.id) as Iterable<UnitAssignmentRow>;
  return Array.from(rows).map((row) => row.unitId);
}

function hasWorldRole(member: MemberRow | undefined): boolean {
  return !!member && ["viewer", "world_operator", "admin"].includes(member.role.tag);
}

function boundedRows<Row>(rows: Iterable<Row>, limit: number): Row[] {
  if (limit <= 0) return [];
  const result: Row[] = [];
  for (const row of rows) {
    result.push(row);
    if (result.length >= limit) break;
  }
  return result;
}

function managedUnitIds(ctx: WorldViewContext): string[] {
  const member = currentMember(ctx);
  if (!member || !worldPermission(ctx)) return [];
  if (member.unitId) return [member.unitId];
  return assignedUnitIds(ctx);
}

function assignedMissionIds(ctx: WorldViewContext): Set<string> {
  const member = currentMember(ctx);
  const ids = new Set<string>();
  if (!member || !worldPermission(ctx)) return ids;
  const agentRow = ctx.db.agent.principal.find(ctx.sender);
  if (!agentRow) return ids;
  for (const membership of ctx.db.missionAgent.agentId.filter(agentRow.id)) {
    if (membership.active) ids.add(membership.missionId);
  }
  return ids;
}

function relevantEntityIds(ctx: WorldViewContext): string[] {
  if (!worldPermission(ctx)) return [];
  const world = ctx.db.worldConfig.id.find(0);
  const member = currentMember(ctx);
  if (world && hasWorldRole(member)) {
    const ids: string[] = [];
    const maximum = Number(world.awarenessPolicy.maxEntities);
    for (const row of ctx.db.entity) {
      if (row.removedAt) continue;
      ids.push(row.id);
      if (ids.length >= maximum) break;
    }
    return ids;
  }
  const ids = new Set<string>();
  for (const unitId of assignedUnitIds(ctx)) {
    ids.add(unitId);
    for (const row of ctx.db.relation.subjectId.filter(unitId)) {
      if (row.predicate === OBSERVED_BY_PREDICATE) ids.add(row.objectId);
    }
  }
  return Array.from(ids).slice(0, Number(world?.awarenessPolicy.maxEntities ?? 0));
}

function worldPermission(ctx: WorldViewContext): boolean {
  const member = currentMember(ctx);
  if (!member) return false;
  if (["viewer", "world_operator", "admin"].includes(member.role.tag)) return true;
  if (member.role.tag === "perception" || member.role.tag === "controller") {
    return !!member.unitId && !!ctx.db.worldConfig.id.find(0);
  }
  if (member.role.tag !== "agent") return false;
  const agentRow = ctx.db.agent.principal.find(ctx.sender);
  const world = ctx.db.worldConfig.id.find(0);
  return !!agentRow && !!world && agentRow.readScope.worldId === world.worldId;
}

function rowsForEntities<Row>(
  ids: readonly string[],
  load: (entityId: string) => Iterable<Row>
): Row[] {
  const rows: Row[] = [];
  for (const entityId of ids) for (const row of load(entityId)) rows.push(row);
  return rows;
}

function feedbackMissionIds(ctx: WorldViewContext): string[] {
  if (!worldPermission(ctx)) return [];
  const world = ctx.db.worldConfig.id.find(0);
  const maximum = Number(world?.awarenessPolicy.maxEntities ?? 0);
  if (maximum <= 0) return [];
  const member = currentMember(ctx);
  if (!member) return [];
  if (hasWorldRole(member)) {
    return boundedRows(ctx.db.mission, maximum).map((row) => row.id);
  }
  if (member.role.tag !== "agent") return [];
  const agentRow = ctx.db.agent.principal.find(ctx.sender);
  if (!agentRow) return [];
  const missionIds: string[] = [];
  for (const membership of ctx.db.missionAgent.agentId.filter(agentRow.id)) {
    if (!membership.active) continue;
    missionIds.push(membership.missionId);
    if (missionIds.length >= maximum) break;
  }
  return missionIds;
}

export const readiness = db.view(
  { name: "readiness", public: true },
  t.array(ReadinessProjection),
  (ctx) => {
    const world = ctx.db.worldConfig.id.find(0);
    const member = currentMember(ctx);
    if (!world) return [];
    return [{
      key: "world",
      worldId: world.worldId,
      mode: world.mode.tag,
      // Authentication/readiness is distinct from world-wide read scope.
      // Perception and controller members are authorized for their enrolled
      // Unit feeds while remaining barred from whole-world reads.
      authorized: !!member,
      role: member?.role.tag ?? "anonymous",
      unitId: member?.unitId,
      synchronized: !!member,
    }];
  }
);

export const relevantEntities = db.view(
  { name: "relevant_entities", public: true },
  t.array(entity.rowType),
  (ctx) => rowsForEntities(relevantEntityIds(ctx), (entityId) => {
    const row = ctx.db.entity.id.find(entityId);
    return row ? [row] : [];
  })
);

export const relevantPoses = db.view(
  { name: "relevant_poses", public: true },
  t.array(pose.rowType),
  (ctx) => boundedRows(
    rowsForEntities(relevantEntityIds(ctx), (entityId) => ctx.db.pose.entityId.filter(entityId)),
    Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxObservationRows ?? 0),
  )
);

export const relevantGeometry = db.view(
  { name: "relevant_geometry", public: true },
  t.array(geometry.rowType),
  (ctx) => boundedRows(
    rowsForEntities(relevantEntityIds(ctx), (entityId) => ctx.db.geometry.entityId.filter(entityId)),
    Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxObservationRows ?? 0),
  )
);

export const relevantSemantic = db.view(
  { name: "relevant_semantic", public: true },
  t.array(semantic.rowType),
  (ctx) => boundedRows(
    rowsForEntities(relevantEntityIds(ctx), (entityId) => {
      const row = ctx.db.semantic.entityId.find(entityId);
      return row ? [row] : [];
    }),
    Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxObservationRows ?? 0),
  )
);

export const relevantLocalMaps = db.view(
  { name: "relevant_local_maps", public: true },
  t.array(localMap.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.localMap, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const rows: LocalMapRow[] = [];
    for (const unitId of assignedUnitIds(ctx)) {
      for (const row of ctx.db.localMap.unitId.filter(unitId)) rows.push(row);
    }
    return boundedRows(rows, Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0));
  }
);

export const assignedMissions = db.view(
  { name: "assigned_missions", public: true },
  t.array(mission.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.mission, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const agentRow = ctx.db.agent.principal.find(ctx.sender);
    if (!agentRow) return [];
    const rows: MissionRow[] = [];
    for (const membership of ctx.db.missionAgent.agentId.filter(agentRow.id)) {
      if (!membership.active) continue;
      const row = ctx.db.mission.id.find(membership.missionId);
      if (row) rows.push(row);
    }
    return boundedRows(rows, Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0));
  }
);

/**
 * Bounded notification watermarks for durable operator finding feedback.
 * Bodies remain in readEventHistory; active membership and the mission's
 * durable event sequence keep this wake feed authorized and O(1) per mission.
 */
export const relevantFeedbackWatermarks = db.view(
  { name: "relevant_feedback_watermarks", public: true },
  t.array(FeedbackWatermark),
  (ctx) => {
    const world = ctx.db.worldConfig.id.find(0);
    const limit = Number(world?.awarenessPolicy.maxEventRows ?? 0);
    if (limit <= 0) return [];
    const rows: Array<Infer<typeof FeedbackWatermark>> = [];
    for (const missionId of feedbackMissionIds(ctx)) {
      const missionRow = ctx.db.mission.id.find(missionId);
      if (missionRow?.feedbackSequence === undefined) continue;
      rows.push({ missionId, sequence: missionRow.feedbackSequence });
      if (rows.length >= limit) return rows;
    }
    return rows;
  },
);

export const relevantExecutions = db.view(
  { name: "relevant_executions", public: true },
  t.array(execution.rowType),
  (ctx) => {
    const member = currentMember(ctx);
    if (!member || !worldPermission(ctx)) return [];
    if (["viewer", "world_operator", "admin"].includes(member.role.tag)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.execution, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const rows = new Map<string, ExecutionRow>();
    for (const row of ctx.db.execution.requestedBy.filter(ctx.sender)) rows.set(row.id, row);
    for (const unitId of assignedUnitIds(ctx)) {
      for (const row of ctx.db.execution.unitId.filter(unitId)) rows.set(row.id, row);
    }
    const agentRow = ctx.db.agent.principal.find(ctx.sender);
    if (agentRow) {
      for (const membership of ctx.db.missionAgent.agentId.filter(agentRow.id)) {
        for (const row of ctx.db.execution.byMission.filter(membership.missionId)) rows.set(row.id, row);
      }
    }
    return boundedRows(rows.values(), Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0));
  }
);

export const addressedMessages = db.view(
  { name: "addressed_messages", public: true },
  t.array(agentMessage.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (member && ["viewer", "world_operator", "admin"].includes(member.role.tag)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.agentMessage, Number(world?.awarenessPolicy.maxMessageRows ?? 0));
    }
    const agentRow = ctx.db.agent.principal.find(ctx.sender);
    if (!agentRow) return [];
    const rows = new Map<string, AgentMessageRow>();
    for (const row of ctx.db.agentMessage.toAgentId.filter(agentRow.id)) rows.set(row.id, row);
    for (const row of ctx.db.agentMessage.fromAgentId.filter(agentRow.id)) rows.set(row.id, row);
    return boundedRows(rows.values(), Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxMessageRows ?? 0));
  }
);

/** Authorized current agent records for operator views and an agent's own UI. */
export const relevantAgents = db.view(
  { name: "relevant_agents", public: true },
  t.array(agent.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.agent, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const own = ctx.db.agent.principal.find(ctx.sender);
    return own ? [own] : [];
  },
);

/** Mission membership roster limited to world roles or the caller's missions. */
export const relevantMissionAgents = db.view(
  { name: "relevant_mission_agents", public: true },
  t.array(missionAgent.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.missionAgent, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const missionIds = assignedMissionIds(ctx);
    return boundedRows(
      Array.from(ctx.db.missionAgent).filter((row) => missionIds.has(row.missionId)),
      Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0),
    );
  },
);

/** Objective evidence for authorized missions; agents never receive unrelated progress. */
export const relevantMissionObjectiveProgress = db.view(
  { name: "relevant_mission_objective_progress", public: true },
  t.array(missionObjectiveProgress.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.missionObjectiveProgress, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const missionIds = assignedMissionIds(ctx);
    return boundedRows(
      Array.from(ctx.db.missionObjectiveProgress).filter((row) => missionIds.has(row.missionId)),
      Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0),
    );
  },
);

/** Current unit assignment state authorized for the whole world or managed units. */
export const relevantUnitAssignments = db.view(
  { name: "relevant_unit_assignments", public: true },
  t.array(unitAssignment.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.unitAssignment, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const unitIds = new Set(managedUnitIds(ctx));
    return boundedRows(
      Array.from(ctx.db.unitAssignment).filter((row) => unitIds.has(row.unitId)),
      Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0),
    );
  },
);

/** Current stop/controller state; admission flags are not execution safety proof. */
export const relevantUnitControls = db.view(
  { name: "relevant_unit_controls", public: true },
  t.array(unitControl.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.unitControl, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const unitIds = new Set(managedUnitIds(ctx));
    return boundedRows(
      Array.from(ctx.db.unitControl).filter((row) => unitIds.has(row.unitId)),
      Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0),
    );
  },
);

/** Versioned action permissions for the world or units managed by this caller. */
export const relevantActionBindings = db.view(
  { name: "relevant_action_bindings", public: true },
  t.array(actionBinding.rowType),
  (ctx) => {
    if (!worldPermission(ctx)) return [];
    const member = currentMember(ctx);
    if (hasWorldRole(member)) {
      const world = ctx.db.worldConfig.id.find(0);
      return boundedRows(ctx.db.actionBinding, Number(world?.awarenessPolicy.maxEntities ?? 0));
    }
    const unitIds = new Set(managedUnitIds(ctx));
    return boundedRows(
      Array.from(ctx.db.actionBinding).filter((row) => unitIds.has(row.unitId)),
      Number(ctx.db.worldConfig.id.find(0)?.awarenessPolicy.maxEntities ?? 0),
    );
  },
);

export function hasWorldReadPermission(ctx: WorldViewContext): boolean {
  return worldPermission(ctx);
}
