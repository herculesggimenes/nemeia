import { Identity, Timestamp, type Infer } from "spacetimedb";
import { t, type ReducerCtx } from "spacetimedb/server";
import { db, entity, member, observation, relation, spatialFrame, unitControl, type WorldDb } from "./schema.ts";
import {
  ActionBindingPolicy,
  Geometry,
  MapCheckpointInput,
  ObservationInput,
  PackagePin,
  Pose3,
  ResourceRef,
  Role,
  Semantic,
  SpatialFrameInput,
} from "./values.ts";
import { AwarenessPolicy } from "./agents.ts";

export type WorldContext = ReducerCtx<WorldDb["schemaType"]>;
export type MemberRow = Infer<typeof member.rowType>;
type SpatialFrameRow = Infer<typeof spatialFrame.rowType>;
type ObservationRow = Infer<typeof observation.rowType>;

export const OBSERVED_BY_PREDICATE = "observed_by";

const DEFAULT_WORLD_ID = "nemeia-local-world";
const DEFAULT_AWARENESS_POLICY: Infer<typeof AwarenessPolicy> = {
  maxEntities: 2_000,
  maxObservationRows: 1_000,
  maxEventRows: 1_000,
  maxMessageRows: 256,
  radiusM: undefined,
  minIntervalMs: 250,
  maxWaitMs: 2_000,
};

export function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (typeof input === "bigint") return input.toString(10);
    if (input instanceof Timestamp) return input.toISOString();
    if (input instanceof Identity) return input.toHexString();
    if (Array.isArray(input)) return input.map(normalize);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)])
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value));
}

export function key(...parts: unknown[]): string {
  return canonical(parts);
}

function sameIdentity(left: Identity, right: Identity): boolean {
  return left.isEqual(right);
}

export function memberFor(ctx: WorldContext): MemberRow {
  const member = ctx.db.member.identity.find(ctx.sender);
  if (!member) throw new Error("unauthorized_member_required");
  return member;
}

export function requireRole(ctx: WorldContext, ...roles: string[]): MemberRow {
  const member = memberFor(ctx);
  if (!roles.includes(member.role.tag)) throw new Error("forbidden_role");
  return member;
}

export function requireProducer(ctx: WorldContext): MemberRow & { unitId: string; producerSession: string; package: Infer<typeof PackagePin> } {
  const member = requireRole(ctx, "perception");
  if (!member.unitId || !member.producerSession || !member.package) {
    throw new Error("producer_scope_incomplete");
  }
  return member as MemberRow & { unitId: string; producerSession: string; package: Infer<typeof PackagePin> };
}

function ensureFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`invalid_${name}`);
}

function validateVec3(value: Infer<typeof import("./values.ts").Vec3>, name: string): void {
  ensureFinite(value.x, `${name}_x`);
  ensureFinite(value.y, `${name}_y`);
  ensureFinite(value.z, `${name}_z`);
}

function validatePose(value: Infer<typeof Pose3>, name: string): void {
  validateVec3(value.positionM, `${name}_position`);
  validateVec3(value.orientation, `${name}_orientation`);
  const norm = Math.hypot(
    value.orientation.x,
    value.orientation.y,
    value.orientation.z,
    value.orientation.w
  );
  if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-3) {
    throw new Error(`invalid_${name}_quaternion`);
  }
}

function validateResource(value: Infer<typeof ResourceRef>): void {
  if (!value.id || !value.schema || !/^[a-f0-9]{64}$/i.test(value.sha256) || value.byteLength <= 0n) {
    throw new Error("invalid_resource_reference");
  }
}

function frameForGeometry(value: Infer<typeof Geometry>): string | undefined {
  switch (value.tag) {
    case "boundingBox3D":
      return value.value.frameId;
    case "pointCloud":
      return value.value.frameId;
    case "mesh":
      return value.value.frameId;
    case "boundingBox2D":
      return key("image", value.value.frame.streamId, value.value.frame.sessionId);
  }
}

function validateGeometry(value: Infer<typeof Geometry>): void {
  switch (value.tag) {
    case "boundingBox3D":
      validatePose(value.value.pose, "geometry");
      validateVec3(value.value.sizeM, "geometry_size");
      if (value.value.sizeM.x <= 0 || value.value.sizeM.y <= 0 || value.value.sizeM.z <= 0) {
        throw new Error("invalid_geometry_size");
      }
      break;
    case "boundingBox2D":
      for (const [name, number] of Object.entries({
        centerX: value.value.centerX,
        centerY: value.value.centerY,
        width: value.value.width,
        height: value.value.height,
        angleRad: value.value.angleRad,
      })) ensureFinite(number, `geometry_${name}`);
      if (value.value.width <= 0 || value.value.height <= 0) throw new Error("invalid_geometry_size");
      break;
    case "pointCloud":
      validateResource(value.value.resource);
      break;
    case "mesh":
      validatePose(value.value.pose, "geometry");
      validateResource(value.value.resource);
      break;
  }
}

function validateSemantic(value: Infer<typeof Semantic>): void {
  for (const hypothesis of value.hypotheses) {
    if (!hypothesis.label || !Number.isFinite(hypothesis.score) || hypothesis.score < 0 || hypothesis.score > 1) {
      throw new Error("invalid_semantic_hypothesis");
    }
  }
}

function validateInput(input: Infer<typeof ObservationInput>): void {
  if (!input.id || !input.producerSession || (!input.pose && !input.geometry && !input.semantic)) {
    throw new Error("invalid_observation_input");
  }
  for (const resource of input.retained) validateResource(resource);
  for (const transform of input.transforms) validatePose(transform.pose, "transform");
  if (input.pose) validatePose(input.pose.value, "pose");
  if (input.geometry) validateGeometry(input.geometry.value);
  if (input.semantic) validateSemantic(input.semantic.value);
}

function ensureLocality(ctx: WorldContext, member: MemberRow, input: Infer<typeof ObservationInput>): void {
  const map = ctx.db.localMap.id.find(input.localMapId);
  if (!map || !member.unitId || map.unitId !== member.unitId) throw new Error("wrong_local_map");

  const frameIds = new Set<string>();
  if (input.pose) frameIds.add(input.pose.frameId);
  if (input.geometry) {
    if (input.geometry.value.tag !== "boundingBox2D") {
      const frameId = frameForGeometry(input.geometry.value);
      if (frameId) frameIds.add(frameId);
    }
  }
  for (const transform of input.transforms) {
    frameIds.add(transform.parentFrameId);
    frameIds.add(transform.childFrameId);
  }
  for (const frameId of frameIds) {
    const frame = ctx.db.spatialFrame.id.find(frameId);
    if (!frame || !member.unitId || frame.unitId !== member.unitId) throw new Error("wrong_spatial_frame");
  }
}

function updatePose(ctx: WorldContext, entityId: string, sample: Infer<typeof import("./values.ts").PoseSample>, observationId: string): void {
  const rowKey = key(entityId, sample.frameId);
  const current = ctx.db.pose.key.find(rowKey);
  if (current && current.observedAt.microsSinceUnixEpoch > sample.observedAt.microsSinceUnixEpoch) return;
  const row = {
    key: rowKey,
    entityId,
    frameId: sample.frameId,
    value: sample.value,
    observedAt: sample.observedAt,
    observationId,
    version: (current?.version ?? 0n) + 1n,
  };
  if (current) ctx.db.pose.key.update(row);
  else ctx.db.pose.insert(row);
}

function updateGeometry(ctx: WorldContext, entityId: string, sample: Infer<typeof import("./values.ts").GeometrySample>, observationId: string): void {
  const frameId = frameForGeometry(sample.value);
  if (!frameId) return;
  const rowKey = key(entityId, frameId);
  const current = ctx.db.geometry.key.find(rowKey);
  if (current && current.observedAt.microsSinceUnixEpoch > sample.observedAt.microsSinceUnixEpoch) return;
  const row = {
    key: rowKey,
    entityId,
    frameId,
    value: sample.value,
    observedAt: sample.observedAt,
    observationId,
    version: (current?.version ?? 0n) + 1n,
  };
  if (current) ctx.db.geometry.key.update(row);
  else ctx.db.geometry.insert(row);
}

function updateSemantic(ctx: WorldContext, entityId: string, sample: Infer<typeof import("./values.ts").SemanticSample>, observationId: string): void {
  const current = ctx.db.semantic.entityId.find(entityId);
  if (current && current.observedAt.microsSinceUnixEpoch > sample.observedAt.microsSinceUnixEpoch) return;
  const row = {
    entityId,
    frameId: sample.frameId,
    value: sample.value,
    observedAt: sample.observedAt,
    observationId,
    version: (current?.version ?? 0n) + 1n,
  };
  if (current) ctx.db.semantic.entityId.update(row);
  else ctx.db.semantic.insert(row);
}

export function audit(ctx: WorldContext, kind: string, subjectId: string, detail: string): bigint {
  const row = ctx.db.worldEvent.insert({
    sequence: 0n,
    id: ctx.newUuidV7().toString(),
    kind,
    subjectId,
    principal: ctx.sender,
    recordedAt: ctx.timestamp,
    detail,
  });
  return row.sequence;
}

export const init = db.init((ctx) => {
  if (!ctx.db.worldConfig.id.find(0)) {
    ctx.db.worldConfig.insert({
      id: 0,
      worldId: DEFAULT_WORLD_ID,
      clockErrorBoundMs: 50,
      mode: { tag: "simulation" },
      awarenessPolicy: DEFAULT_AWARENESS_POLICY,
    });
  }
  if (!ctx.db.member.identity.find(ctx.sender)) {
    ctx.db.member.insert({
      identity: ctx.sender,
      role: { tag: "admin" },
      unitId: undefined,
      producerSession: undefined,
      package: undefined,
    });
  }
});

/** Register the canonical Unit and its scoped controller projection. */
export const configureUnit = db.reducer(
  { name: "configure_unit" },
  { unitId: t.string(), displayName: t.string(), controllerIdentity: t.identity() },
  (ctx, { unitId, displayName, controllerIdentity }) => {
    requireRole(ctx, "admin");
    if (!unitId || !displayName) throw new Error("invalid_unit_registration");
    const controller = ctx.db.member.identity.find(controllerIdentity);
    if (!controller || controller.role.tag !== "controller" || controller.unitId !== unitId) {
      throw new Error("unit_controller_member_required");
    }
    const existingControl = ctx.db.unitControl.unitId.find(unitId);
    if (existingControl && !existingControl.controller.isEqual(controllerIdentity)) {
      throw new Error("unit_controller_conflict");
    }
    if (!existingControl) {
      ctx.db.unitControl.insert({
        unitId,
        controller: controllerIdentity,
        epoch: 0n,
        activeExecutionId: undefined,
        stopLatched: true,
        safeStateConfirmed: false,
        observedAt: ctx.timestamp,
      });
    }
    const existing = ctx.db.entity.id.find(unitId);
    if (existing) {
      if (existing.kind !== "unit" || existing.removedAt) throw new Error("unit_id_conflict");
      if (existing.displayName === displayName) return;
      ctx.db.entity.id.update({ ...existing, displayName });
      audit(ctx, "unit.configured", unitId, `displayName=${displayName}`);
      return;
    }
    ctx.db.entity.insert({
      id: unitId,
      displayName,
      kind: "unit",
      createdAt: ctx.timestamp,
      removedAt: undefined,
    });
    audit(ctx, "unit.registered", unitId, `displayName=${displayName}`);
  },
);

export const configureMember = db.reducer(
  { name: "configure_member" },
  {
    identity: t.identity(),
    role: Role,
    unitId: t.option(t.string()),
    producerSession: t.option(t.string()),
    package: t.option(PackagePin),
  },
  (ctx, input) => {
    requireRole(ctx, "admin");
    if (input.role.tag === "perception" && (!input.unitId || !input.producerSession || !input.package)) {
      throw new Error("producer_scope_incomplete");
    }
    const existing = ctx.db.member.identity.find(input.identity);
    if (existing) {
      if (canonical(existing) === canonical({ ...existing, ...input })) return;
      ctx.db.member.identity.update({
        identity: existing.identity,
        role: input.role,
        unitId: input.unitId,
        producerSession: input.producerSession,
        package: input.package,
      });
      return;
    }
    ctx.db.member.insert({
      identity: input.identity,
      role: input.role,
      unitId: input.unitId,
      producerSession: input.producerSession,
      package: input.package,
    });
  }
);

export const registerSpatialFrame = db.reducer(
  { name: "register_spatial_frame" },
  { input: SpatialFrameInput },
  (ctx, { input }) => {
    const member = requireProducer(ctx);
    if (input.sourceSession !== member.producerSession) throw new Error("producer_session_mismatch");
    if (input.parentFrameId) {
      const parent = ctx.db.spatialFrame.id.find(input.parentFrameId);
      if (!parent) throw new Error("missing_parent_frame");
      if (parent.unitId !== member.unitId) throw new Error("wrong_parent_frame");
    }
    const existing = ctx.db.spatialFrame.id.find(input.frameId);
    const row: SpatialFrameRow = {
      id: input.frameId,
      unitId: member.unitId,
      sourceSession: input.sourceSession,
      originEpoch: input.originEpoch,
      parentFrameId: input.parentFrameId,
      createdAt: ctx.timestamp,
    };
    if (existing) {
      if (canonical({
        unitId: existing.unitId,
        sourceSession: existing.sourceSession,
        originEpoch: existing.originEpoch,
        parentFrameId: existing.parentFrameId,
      }) !== canonical({
        unitId: row.unitId,
        sourceSession: row.sourceSession,
        originEpoch: row.originEpoch,
        parentFrameId: row.parentFrameId,
      })) throw new Error("frame_id_conflict");
      return;
    }
    ctx.db.spatialFrame.insert(row);
    audit(ctx, "spatial_frame.registered", input.frameId, "immutable spatial frame");
  }
);

export const initializeLocalMap = db.reducer(
  { name: "initialize_local_map" },
  { mapId: t.string(), unitId: t.string(), rootFrameId: t.string() },
  (ctx, { mapId, unitId, rootFrameId }) => {
    const member = memberFor(ctx);
    const allowed = member.role.tag === "admin" || member.role.tag === "world_operator" ||
      (member.role.tag === "perception" && member.unitId === unitId);
    if (!allowed) throw new Error("forbidden_map_scope");
    const frame = ctx.db.spatialFrame.id.find(rootFrameId);
    if (!frame || frame.unitId !== unitId) throw new Error("wrong_root_frame");
    const existing = ctx.db.localMap.id.find(mapId);
    if (existing) {
      if (existing.unitId !== unitId || existing.rootFrameId !== rootFrameId) throw new Error("map_id_conflict");
      return;
    }
    ctx.db.localMap.insert({ id: mapId, unitId, rootFrameId, headRevision: undefined, updatedAt: ctx.timestamp });
    audit(ctx, "local_map.initialized", mapId, `rootFrameId=${rootFrameId}`);
  }
);

export const commitMapCheckpoint = db.reducer(
  { name: "commit_map_checkpoint" },
  { input: MapCheckpointInput },
  (ctx, { input }) => {
    const member = requireProducer(ctx);
    const map = ctx.db.localMap.id.find(input.mapId);
    if (!map || map.unitId !== member.unitId) throw new Error("wrong_local_map");
    const frame = ctx.db.spatialFrame.id.find(input.rootFrameId);
    if (!frame || frame.unitId !== member.unitId || input.rootFrameId !== map.rootFrameId) throw new Error("wrong_root_frame");
    validateResource(input.manifest);
    validateResource(input.evidenceIndex);
    if (input.estimatorState) validateResource(input.estimatorState);

    const existingManifest = ctx.db.mapRevision.manifestDigest.find(input.manifest.sha256);
    if (existingManifest) {
      if (existingManifest.mapId !== input.mapId || existingManifest.requestFingerprint !== canonical(input)) {
        throw new Error("manifest_digest_conflict");
      }
      return;
    }

    for (const observationId of input.inputObservationIds) {
      const observation = ctx.db.observation.id.find(observationId);
      if (!observation || observation.input.localMapId !== input.mapId) throw new Error("map_evidence_closure_missing");
    }

    const currentRevision = map.headRevision ?? 0n;
    if (input.expectedRevision !== currentRevision) throw new Error("map_revision_conflict");
    const revision = currentRevision + 1n;
    const row = {
      key: key(input.mapId, revision),
      mapId: input.mapId,
      revision,
      rootFrameId: input.rootFrameId,
      parentRevision: map.headRevision,
      manifest: input.manifest,
      evidenceIndex: input.evidenceIndex,
      estimatorState: input.estimatorState,
      inputObservationIds: input.inputObservationIds,
      manifestDigest: input.manifest.sha256,
      requestFingerprint: canonical(input),
      recordedAt: ctx.timestamp,
    };
    ctx.db.mapRevision.insert(row);
    ctx.db.localMap.id.update({ ...map, headRevision: revision, updatedAt: ctx.timestamp });
    audit(ctx, "local_map.checkpoint_committed", input.mapId, `revision=${revision}`);
  }
);

export const ingestObservation = db.reducer(
  { name: "ingest_observation" },
  { input: ObservationInput },
  (ctx, { input }) => {
    const member = requireProducer(ctx);
    if (input.producerSession !== member.producerSession) throw new Error("producer_session_mismatch");
    validateInput(input);
    ensureLocality(ctx, member, input);

    const existing = ctx.db.observation.id.find(input.id);
    const inputFingerprint = canonical(input);
    if (existing) {
      if (!sameIdentity(existing.producer, ctx.sender) || existing.inputFingerprint !== inputFingerprint) {
        throw new Error("observation_idempotency_conflict");
      }
      return;
    }

    let entityId = input.entityId;
    let trackKey: string | undefined;
    let trackRow = undefined;
    if (input.trackId) {
      trackKey = key(ctx.sender.toHexString(), input.producerSession, input.trackId);
      trackRow = ctx.db.track.key.find(trackKey);
      if (trackRow) {
        if (entityId && entityId !== trackRow.entityId) throw new Error("track_entity_conflict");
        entityId = trackRow.entityId;
      }
    }
    if (!entityId) entityId = ctx.newUuidV7().toString();
    const entity = ctx.db.entity.id.find(entityId);
    if (entity?.removedAt) throw new Error("entity_removed");
    if (input.entityId && !trackRow) {
      const prior = Array.from(ctx.db.observation.entityId.filter(entityId));
      const foreign = prior.find((row) => !sameIdentity(row.producer, ctx.sender));
      if (foreign) {
        const hasAuthorizedAssociation = input.supersedes.some((id) => {
          const predecessor = ctx.db.observation.id.find(id);
          return !!predecessor && predecessor.entityId === entityId && predecessor.unitId === member.unitId;
        });
        if (!hasAuthorizedAssociation) throw new Error("entity_association_forbidden");
      }
    }
    if (!entity) ctx.db.entity.insert({ id: entityId, displayName: "Observed entity", kind: "object", createdAt: ctx.timestamp, removedAt: undefined });

    const observation: ObservationRow = {
      sequence: 0n,
      id: input.id,
      producer: ctx.sender,
      package: member.package,
      unitId: member.unitId,
      entityId,
      input,
      inputFingerprint,
      recordedAt: ctx.timestamp,
    };
    ctx.db.observation.insert(observation);
    if (trackKey && trackRow) {
      ctx.db.track.key.update({ ...trackRow, lastObservationId: input.id });
    } else if (trackKey) {
      ctx.db.track.insert({
        key: trackKey,
        producer: ctx.sender,
        producerSession: input.producerSession,
        trackId: input.trackId!,
        entityId,
        lastObservationId: input.id,
      });
    }
    const awarenessKey = key(OBSERVED_BY_PREDICATE, member.unitId, entityId);
    const awareness = {
      key: awarenessKey,
      subjectId: member.unitId,
      predicate: OBSERVED_BY_PREDICATE,
      objectId: entityId,
      observationId: input.id,
    };
    const existingAwareness = ctx.db.relation.key.find(awarenessKey);
    if (existingAwareness) ctx.db.relation.key.update(awareness);
    else ctx.db.relation.insert(awareness);
    if (input.pose) updatePose(ctx, entityId, input.pose, input.id);
    if (input.geometry) updateGeometry(ctx, entityId, input.geometry, input.id);
    if (input.semantic) updateSemantic(ctx, entityId, input.semantic, input.id);
    audit(ctx, "observation.recorded", input.id, `entityId=${entityId}`);
  }
);

export const setActionBinding = db.reducer(
  { name: "set_action_binding" },
  {
    unitId: t.string(),
    actionName: t.string(),
    version: t.u64(),
    policy: ActionBindingPolicy,
  },
  (ctx, input) => {
    requireRole(ctx, "admin");
    if (!input.actionName || input.policy.maxRunMs === 0 || input.policy.maxLinearMps <= 0 || input.policy.toleranceM < 0) {
      throw new Error("invalid_action_binding");
    }
    const bindingKey = key(input.unitId, input.actionName);
    const existing = ctx.db.actionBinding.key.find(bindingKey);
    if (existing && input.version <= existing.version) throw new Error("binding_revision_conflict");
    const row = { key: bindingKey, ...input };
    if (existing) ctx.db.actionBinding.key.update(row);
    else ctx.db.actionBinding.insert(row);
    audit(ctx, "action_binding.configured", bindingKey, `version=${input.version}`);
  }
);
