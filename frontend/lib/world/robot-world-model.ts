import type { WorldRuntime } from "@nemeia/world-runtime";
import { WORLD_ROBOT_ID, type WorldActionId, type WorldComponentPayload } from "./robot-world-runtime";

export type WorldComponentView = WorldComponentPayload & {
  id: string;
};

export type WorldActionView = {
  actorId: string;
  available: boolean;
  description: string;
  id: WorldActionId;
  label: string;
  reason: string | null;
  targetId: string | null;
};

export type WorldEntityView = {
  components: WorldComponentView[];
  id: string;
  label: string;
  type: string;
};

export type WorldRelationshipView = {
  objectId: string;
  predicate: string;
  subjectId: string;
};

export type RobotWorldView = {
  actions: WorldActionView[];
  entities: WorldEntityView[];
  relationships: WorldRelationshipView[];
};

const actionOrder: WorldActionId[] = ["robot.connect", "world.observe", "world.map", "world.listen", "robot.control", "robot.stop"];

export function projectRobotWorld(runtime: WorldRuntime): RobotWorldView {
  const entities = runtime.entities().map((entity) => ({
    id: entity.id,
    label: entity.label,
    type: entity.type,
    components: Object.entries(entity.components).map(([id, value]) => {
      const payload = componentPayload(value);
      return { detail: payload.detail, id, label: payload.label, state: payload.state };
    })
  }));
  const affordances = runtime.affordancesFor(WORLD_ROBOT_ID);
  const actions = affordances
    .filter((affordance): affordance is typeof affordance & { action_id: WorldActionId } => actionOrder.includes(affordance.action_id as WorldActionId))
    .map((affordance) => ({
      actorId: affordance.actor_id,
      available: affordance.available,
      description: affordance.description,
      id: affordance.action_id,
      label: affordance.label,
      reason: affordance.reason,
      targetId: affordance.target_id
    }))
    .toSorted((left, right) => actionOrder.indexOf(left.id) - actionOrder.indexOf(right.id));

  return {
    actions,
    entities,
    relationships: runtime.relationships().map((relationship) => ({
      objectId: relationship.object_id,
      predicate: relationship.predicate,
      subjectId: relationship.subject_id
    }))
  };
}

function componentPayload(value: unknown): WorldComponentPayload {
  if (typeof value === "object" && value !== null && "label" in value && "state" in value && "detail" in value) {
    return value as WorldComponentPayload;
  }
  return { detail: JSON.stringify(value), label: "Component", state: "unknown" };
}
