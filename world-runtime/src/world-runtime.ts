import { WorldRuntimeError } from "./world-runtime-errors.ts";

export type ComponentMap = Record<string, unknown>;

export type WorldEntity = {
  components: ComponentMap;
  id: string;
  label: string;
  type: string;
};

export type WorldRelationship = {
  components: ComponentMap;
  object_id: string;
  predicate: string;
  subject_id: string;
};

export type WorldEvent = {
  data: Record<string, unknown>;
  entity_ids: string[];
  seq: number;
  timestamp: string;
  type: string;
};

export type ActionEffect = {
  components?: ComponentMap;
  entity_id: string;
};

export type ActionOutcome = {
  effects?: ActionEffect[];
  events?: Array<{ data?: Record<string, unknown>; entity_ids?: string[]; type: string }>;
  relationships?: WorldRelationship[];
  result?: Record<string, unknown>;
};

export type ActionContext = {
  actor: WorldEntity;
  input: Record<string, unknown>;
  target: WorldEntity | null;
  world: WorldRuntime;
};

export type ActionDefinition = {
  actor_components: string[];
  available?: (context: ActionContext) => boolean | string;
  description: string;
  id: string;
  label: string;
  perform: (context: ActionContext) => ActionOutcome | Promise<ActionOutcome>;
  target_components?: string[];
};

export type Affordance = {
  action_id: string;
  actor_id: string;
  available: boolean;
  description: string;
  label: string;
  reason: string | null;
  target_id: string | null;
};

export class WorldRuntime {
  #actions = new Map<string, ActionDefinition>();
  #clock: () => Date;
  #entities = new Map<string, WorldEntity>();
  #events: WorldEvent[] = [];
  #relationships = new Map<string, WorldRelationship>();

  constructor({ clock = () => new Date() }: { clock?: () => Date } = {}) {
    this.#clock = clock;
  }

  upsertEntity(entity: Omit<WorldEntity, "components"> & { components?: ComponentMap }): WorldEntity {
    requireIdentifier(entity.id, "entity id");
    const existing = this.#entities.get(entity.id);
    const next = freezeClone({
      id: entity.id,
      label: entity.label || existing?.label || entity.id,
      type: entity.type || existing?.type || "core.entity",
      components: { ...(existing?.components ?? {}), ...(entity.components ?? {}) }
    });
    this.#entities.set(next.id, next);
    this.#appendEvent(existing ? "entity.updated" : "entity.created", [next.id], { components: Object.keys(entity.components ?? {}) });
    return clone(next);
  }

  removeEntity(entityId: string): void {
    if (!this.#entities.delete(entityId)) {
      throw new WorldRuntimeError("ENTITY_NOT_FOUND", `Entity ${entityId} does not exist.`, { entity_id: entityId });
    }
    for (const [key, relationship] of this.#relationships) {
      if (relationship.subject_id === entityId || relationship.object_id === entityId) {
        this.#relationships.delete(key);
      }
    }
    this.#appendEvent("entity.removed", [entityId], {});
  }

  entity(entityId: string): WorldEntity | null {
    const entity = this.#entities.get(entityId);
    return entity ? clone(entity) : null;
  }

  entities(): WorldEntity[] {
    return [...this.#entities.values()].sort(byId).map(clone);
  }

  relate(relationship: WorldRelationship): WorldRelationship {
    this.#requireEntity(relationship.subject_id);
    this.#requireEntity(relationship.object_id);
    requireIdentifier(relationship.predicate, "relationship predicate");
    const next = freezeClone({ ...relationship, components: relationship.components ?? {} });
    this.#relationships.set(relationshipKey(next), next);
    this.#appendEvent("relationship.updated", [next.subject_id, next.object_id], { predicate: next.predicate });
    return clone(next);
  }

  relationships(): WorldRelationship[] {
    return [...this.#relationships.values()].sort((left, right) => relationshipKey(left).localeCompare(relationshipKey(right))).map(clone);
  }

  registerAction(action: ActionDefinition): void {
    requireIdentifier(action.id, "action id");
    if (this.#actions.has(action.id)) {
      throw new WorldRuntimeError("ACTION_ALREADY_REGISTERED", `Action ${action.id} is already registered.`, { action_id: action.id });
    }
    this.#actions.set(action.id, freezeClone({ ...action, actor_components: [...action.actor_components], target_components: [...(action.target_components ?? [])] }, false));
  }

  actions(): Array<Omit<ActionDefinition, "available" | "perform">> {
    return [...this.#actions.values()].sort(byId).map(({ available: _available, perform: _perform, ...action }) => clone(action));
  }

  affordancesFor(actorId: string, targetId?: string): Affordance[] {
    const actor = this.#requireEntity(actorId);
    const explicitTarget = targetId ? this.#requireEntity(targetId) : null;
    const candidates = explicitTarget ? [explicitTarget] : [null, ...this.#entities.values()].filter((entity) => !entity || entity.id !== actorId);
    const affordances: Affordance[] = [];

    for (const action of this.#actions.values()) {
      for (const target of candidates) {
        const needsTarget = Boolean(action.target_components?.length);
        if (needsTarget !== Boolean(target)) {
          continue;
        }
        const missingActor = missingComponents(actor, action.actor_components);
        const missingTarget = target ? missingComponents(target, action.target_components ?? []) : [];
        let reason = missingActor.length ? `Actor missing: ${missingActor.join(", ")}` : missingTarget.length ? `Target missing: ${missingTarget.join(", ")}` : null;
        if (!reason && action.available) {
          const result = action.available({ actor: clone(actor), target: target ? clone(target) : null, input: {}, world: this });
          reason = result === true ? null : result === false ? "Action condition is not satisfied" : result;
        }
        affordances.push({
          action_id: action.id,
          actor_id: actor.id,
          available: reason === null,
          description: action.description,
          label: action.label,
          reason,
          target_id: target?.id ?? null
        });
      }
    }

    return affordances.sort((left, right) => `${left.action_id}:${left.target_id ?? ""}`.localeCompare(`${right.action_id}:${right.target_id ?? ""}`));
  }

  async execute({ action_id, actor_id, input = {}, target_id }: { action_id: string; actor_id: string; input?: Record<string, unknown>; target_id?: string }): Promise<Record<string, unknown>> {
    const action = this.#actions.get(action_id);
    if (!action) {
      throw new WorldRuntimeError("ACTION_NOT_FOUND", `Action ${action_id} is not registered.`, { action_id });
    }
    const actor = this.#requireEntity(actor_id);
    const target = target_id ? this.#requireEntity(target_id) : null;
    const affordance = this.affordancesFor(actor_id, target_id).find((candidate) => candidate.action_id === action_id && candidate.target_id === (target_id ?? null));
    if (!affordance?.available) {
      throw new WorldRuntimeError("ACTION_NOT_AVAILABLE", affordance?.reason ?? `Action ${action_id} is not available.`, { action_id, actor_id, target_id });
    }

    this.#appendEvent("action.started", [actor_id, ...(target_id ? [target_id] : [])], { action_id, input: clone(input) });
    try {
      const outcome = await action.perform({ actor: clone(actor), target: target ? clone(target) : null, input: clone(input), world: this });
      for (const effect of outcome.effects ?? []) {
        const entity = this.#requireEntity(effect.entity_id);
        this.upsertEntity({ ...entity, components: effect.components ?? {} });
      }
      for (const relationship of outcome.relationships ?? []) {
        this.relate(relationship);
      }
      for (const event of outcome.events ?? []) {
        this.#appendEvent(event.type, event.entity_ids ?? [actor_id, ...(target_id ? [target_id] : [])], event.data ?? {});
      }
      this.#appendEvent("action.completed", [actor_id, ...(target_id ? [target_id] : [])], { action_id, result: outcome.result ?? {} });
      return clone(outcome.result ?? {});
    } catch (error) {
      this.#appendEvent("action.failed", [actor_id, ...(target_id ? [target_id] : [])], { action_id, message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  events({ after = 0 }: { after?: number } = {}): WorldEvent[] {
    return this.#events.filter((event) => event.seq > after).map(clone);
  }

  snapshot() {
    return freezeClone({ entities: this.entities(), relationships: this.relationships(), actions: this.actions(), last_event_seq: this.#events.at(-1)?.seq ?? 0 });
  }

  #appendEvent(type: string, entityIds: string[], data: Record<string, unknown>): WorldEvent {
    const event = freezeClone({ seq: this.#events.length + 1, timestamp: this.#clock().toISOString(), type, entity_ids: [...entityIds], data: clone(data) });
    this.#events.push(event);
    return clone(event);
  }

  #requireEntity(entityId: string): WorldEntity {
    const entity = this.#entities.get(entityId);
    if (!entity) {
      throw new WorldRuntimeError("ENTITY_NOT_FOUND", `Entity ${entityId} does not exist.`, { entity_id: entityId });
    }
    return entity;
  }
}

function missingComponents(entity: WorldEntity, required: string[]): string[] {
  return required.filter((component) => !(component in entity.components));
}

function requireIdentifier(value: string, label: string): void {
  if (!value || !/^[a-z][a-z0-9_.:-]*$/i.test(value)) {
    throw new WorldRuntimeError("INVALID_IDENTIFIER", `${label} must be a non-empty portable identifier.`, { value });
  }
}

function relationshipKey(relationship: WorldRelationship): string {
  return `${relationship.subject_id}:${relationship.predicate}:${relationship.object_id}`;
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freezeClone<T>(value: T, cloneValue = true): T {
  const next = cloneValue ? clone(value) : value;
  return deepFreeze(next);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
