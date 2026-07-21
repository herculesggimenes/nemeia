import { DEFAULT_LABEL_MAP, DEFAULT_TYPES, VERB_AFFORDANCE } from "./ontology.ts";
import { SceneError } from "./scene-errors.ts";

export class SceneProjector {
  #eventLog;
  #clock;
  #labelMap;
  #types;
  #ontologyVersion;
  #labelMapVersion;

  constructor({
    eventLog,
    clock = () => new Date(),
    labelMap = DEFAULT_LABEL_MAP,
    types = DEFAULT_TYPES,
    ontologyVersion = 1,
    labelMapVersion = 1
  }) {
    this.#eventLog = eventLog;
    this.#clock = clock;
    this.#labelMap = labelMap;
    this.#types = types;
    this.#ontologyVersion = ontologyVersion;
    this.#labelMapVersion = labelMapVersion;
  }

  appendObservation({ source, robot_id, mission_id, refs = [], payload, severity = 0 }) {
    return this.#eventLog.append({
      schema_version: 1,
      source,
      event_type: "scene.observation",
      severity,
      robot_id,
      mission_id,
      refs,
      payload
    });
  }

  appendTombstone({ source, robot_id, mission_id, entity_id, reason, refs = [], severity = 0 }) {
    return this.#eventLog.append({
      schema_version: 1,
      source,
      event_type: "scene.tombstone",
      severity,
      robot_id,
      mission_id,
      refs,
      payload: {
        entity_id,
        ...(reason ? { reason } : {})
      }
    });
  }

  appendRelation({ source, robot_id, mission_id, subject_id, relation, object_id, provenance = "observed", refs = [], severity = 0 }) {
    return this.#eventLog.append({
      schema_version: 1,
      source,
      event_type: "scene.relation",
      severity,
      robot_id,
      mission_id,
      refs,
      payload: {
        subject_id,
        relation,
        object_id,
        provenance
      }
    });
  }

  getScene() {
    return this.#sceneFromEvents(this.#sceneEvents());
  }

  getSceneSince(snapshotId) {
    const sinceSeq = Number(String(snapshotId).replace(/^ssg_/, ""));
    const sceneEvents = this.#sceneEvents();
    const before = this.#sceneFromEvents(sceneEvents.filter((event) => event.seq <= sinceSeq));
    const current = this.#sceneFromEvents(sceneEvents);
    const beforeById = new Map(before.entities.map((entity) => [entity.id, entity]));
    const currentById = new Map(current.entities.map((entity) => [entity.id, entity]));
    const added = [];
    const changed = [];
    const removed = [];

    for (const entity of current.entities) {
      const prior = beforeById.get(entity.id);
      if (!prior) {
        added.push(entity);
      } else if (entityChanged(prior, entity)) {
        changed.push(entity);
      }
    }
    for (const entity of before.entities) {
      if (!currentById.has(entity.id)) {
        removed.push({ id: entity.id, last_observation_seq: entity.last_observation_seq });
      }
    }

    return {
      added,
      changed,
      removed,
      coalesced_counts: {
        observations: sceneEvents.filter((event) => event.seq > sinceSeq && event.event_type === "scene.observation").length,
        relations: sceneEvents.filter((event) => event.seq > sinceSeq && event.event_type === "scene.relation").length,
        tombstones: sceneEvents.filter((event) => event.seq > sinceSeq && event.event_type === "scene.tombstone").length,
        entities: added.length + changed.length + removed.length
      }
    };
  }

  #sceneFromEvents(sceneEvents) {
    const entitiesById = new Map();
    const tombstonesById = new Map();
    const relationEvents = [];
    for (const event of sceneEvents) {
      if (event.event_type === "scene.tombstone") {
        const entityId = event.payload?.entity_id;
        if (entityId) {
          tombstonesById.set(entityId, event);
          entitiesById.delete(entityId);
        }
        continue;
      }
      if (event.event_type === "scene.relation") {
        relationEvents.push(event);
        continue;
      }
      const entity = this.#entityFromObservation(event);
      if (!entity) {
        continue;
      }
      const tombstone = tombstonesById.get(entity.id);
      if (tombstone && tombstone.seq > event.seq) {
        continue;
      }
      const existing = entitiesById.get(entity.id);
      if (!existing || entity.last_seq > existing.last_seq) {
        entitiesById.set(entity.id, entity);
      }
    }
    const entities = this.#materializeEntities(entitiesById);
    const relations = materializeRelations(relationEvents, new Map(entities.map((entity) => [entity.id, entity])));

    const lastSeq = sceneEvents.at(-1)?.seq ?? 0;
    return {
      scene_snapshot_id: `ssg_${lastSeq}`,
      ontology_version: this.#ontologyVersion,
      label_map_version: this.#labelMapVersion,
      freshness_ms: entities.length === 0 ? 0 : Math.max(...entities.map((entity) => entity.freshness_ms)),
      robots: [],
      hazards: entities.filter((entity) => this.#types[entity.type]?.protected),
      entities,
      relations
    };
  }

  bind({ verb, target, confidenceThreshold = 0.7, freshnessMaxMs = 700 }) {
    const snapshot = this.getScene();
    const entity = snapshot.entities.find((candidate) => candidate.id === target.entity_id);
    if (!entity) {
      throw new SceneError("ENTITY_NOT_IN_SCENE", `Entity ${target.entity_id} is not in the current scene.`, {
        entity_id: target.entity_id
      });
    }
    const requiredAffordance = VERB_AFFORDANCE[verb];
    if (!requiredAffordance) {
      throw new SceneError("VERB_NOT_APPLICABLE", `Verb ${verb} has no registered affordance binding.`, { verb });
    }
    const affordance = entity.affordances.find((candidate) => candidate.name === requiredAffordance);
    if (!affordance) {
      throw new SceneError("VERB_NOT_APPLICABLE", `Entity ${entity.id} does not support ${requiredAffordance}.`, {
        entity_id: entity.id,
        required_affordance: requiredAffordance
      });
    }
    if (affordance.confidence < confidenceThreshold) {
      throw new SceneError("AFFORDANCE_LOW_CONFIDENCE", `Affordance confidence ${affordance.confidence} is below ${confidenceThreshold}.`, {
        entity_id: entity.id,
        affordance: requiredAffordance,
        confidence: affordance.confidence,
        threshold: confidenceThreshold
      });
    }
    if (entity.freshness_ms > freshnessMaxMs) {
      throw new SceneError("SCENE_STALE", `Entity ${entity.id} is ${entity.freshness_ms} ms old; required <= ${freshnessMaxMs} ms.`, {
        entity_id: entity.id,
        freshness_ms: entity.freshness_ms,
        max_ms: freshnessMaxMs
      });
    }
    return {
      entity_id: entity.id,
      snapshot_id: snapshot.scene_snapshot_id,
      evidence_refs: entity.evidence_refs
    };
  }

  #sceneEvents() {
    const all = this.#eventLog.read({ event_types: ["scene.observation", "scene.tombstone", "scene.relation"] }, { limit: 10_000 }).items;
    const fusedRefs = new Set();
    for (const event of all) {
      if (event.event_type === "scene.observation" && String(event.source).startsWith("perception:fusion-")) {
        for (const ref of event.refs ?? []) {
          if (typeof ref === "number") {
            fusedRefs.add(ref);
          }
        }
      }
    }
    return all.filter((event) => event.event_type !== "scene.observation" || !fusedRefs.has(event.seq));
  }

  #entityFromObservation(event) {
    const payload = event.payload;
    const labels = payload.labels ?? [];
    const label = labels[0];
    const type = this.#labelMap[label];
    if (!type) {
      return null;
    }
    const typeRow = this.#types[type];
    if (!typeRow) {
      return null;
    }
    const confidence = Number(payload.confidence ?? 0);
    const entityKey = payload.track_id ?? payload.entity_hint ?? `${type}:${label}`;
    const evidence_refs = [...(payload.artifact_refs ?? []), `event:${event.seq}`];
    const observedAt = new Date(event.timestamp).getTime();
    return {
      id: stableEntityId(entityKey),
      type,
      affordances: typeRow.affordances.map((name) => ({ name, confidence })),
      freshness_ms: Math.max(0, this.#clock().getTime() - observedAt),
      evidence_refs,
      physical_schema: typeRow.physics?.deformable ? "deformable" : "rigid",
      physics_proxy: typeRow.physics?.proxy ?? "box",
      ...(payload.geometry ? { geometry: structuredClone(payload.geometry) } : {}),
      last_seq: event.seq
    };
  }

  #materializeEntities(entitiesById) {
    return [...entitiesById.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entity) => ({
        id: entity.id,
        type: entity.type,
        affordances: entity.affordances,
        freshness_ms: entity.freshness_ms,
        evidence_refs: entity.evidence_refs,
        physical_schema: entity.physical_schema,
        physics_proxy: entity.physics_proxy,
        ...(entity.geometry ? { geometry: entity.geometry } : {}),
        last_observation_seq: entity.last_seq
      }));
  }
}

function stableEntityId(value) {
  const normalized = String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.startsWith("ent_") ? normalized : `ent_${normalized}`;
}

function entityChanged(before, after) {
  const stableBefore = comparableEntity(before);
  const stableAfter = comparableEntity(after);
  return JSON.stringify(stableBefore) !== JSON.stringify(stableAfter);
}

function comparableEntity(entity) {
  const { freshness_ms, last_observation_seq, evidence_refs, ...stable } = entity;
  return stable;
}

function materializeRelations(relationEvents, entitiesById) {
  const byKey = new Map();
  for (const event of relationEvents) {
    const { subject_id, relation, object_id, provenance = "observed" } = event.payload ?? {};
    if (!subject_id || !relation || !object_id) {
      continue;
    }
    const subject = entitiesById.get(subject_id);
    const object = entitiesById.get(object_id);
    if (!subject || !object) {
      continue;
    }
    const key = `${subject_id}\u0000${relation}\u0000${object_id}`;
    const existing = byKey.get(key);
    if (!existing || event.seq > existing.last_relation_seq) {
      byKey.set(key, {
        subject_id,
        relation,
        object_id,
        provenance,
        freshness_ms: Math.max(subject.freshness_ms, object.freshness_ms),
        evidence_refs: [`event:${event.seq}`],
        last_relation_seq: event.seq
      });
    }
  }
  return [...byKey.values()].sort((left, right) => relationSortKey(left).localeCompare(relationSortKey(right)));
}

function relationSortKey(relation) {
  return `${relation.subject_id}:${relation.relation}:${relation.object_id}`;
}
