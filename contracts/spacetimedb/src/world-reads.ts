import { type Infer } from "spacetimedb";
import { t, type ReducerCtx } from "spacetimedb/server";
import {
  db,
  geometry,
  mapRevision,
  member,
  observation,
  spatialFrame,
  worldEvent,
  type WorldDb,
} from "./schema.ts";
import { key } from "./world-reducers.ts";

type ReadContext = ReducerCtx<WorldDb["schemaType"]>;
type MemberRow = Infer<typeof member.rowType>;
type ObservationRow = Infer<typeof observation.rowType>;
type GeometryRow = Infer<typeof geometry.rowType>;
type MapRevisionRow = Infer<typeof mapRevision.rowType>;

const ObservationPage = t.object("ObservationPage", {
  rows: t.array(observation.rowType),
  nextSequence: t.u64(),
  historyGap: t.bool(),
});

const EventPage = t.object("EventPage", {
  rows: t.array(worldEvent.rowType),
  nextSequence: t.u64(),
  historyGap: t.bool(),
});

const MapPage = t.object("MapPage", {
  rows: t.array(mapRevision.rowType),
  nextRevision: t.u64(),
  historyGap: t.bool(),
});

function memberForRead(ctx: ReadContext): MemberRow {
  const member = ctx.db.member.identity.find(ctx.sender);
  if (!member) throw new Error("unauthorized_member_required");
  return member;
}

function hasWorldRead(ctx: ReadContext, member: MemberRow): boolean {
  if (["viewer", "world_operator", "admin"].includes(member.role.tag)) return true;
  if (member.role.tag !== "agent") return false;
  const agent = ctx.db.agent.principal.find(ctx.sender);
  const world = ctx.db.worldConfig.id.find(0);
  return !!agent && !!world && agent.readScope.worldId === world.worldId;
}

function canReadObservation(ctx: ReadContext, row: ObservationRow, member: MemberRow): boolean {
  return hasWorldRead(ctx, member) || (member.unitId !== undefined && member.unitId === row.unitId);
}

export const readObservationDetail = db.procedure(
  { name: "read_observation_detail" },
  { observationId: t.string() },
  t.option(observation.rowType),
  (ctx, { observationId }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    const row = tx.db.observation.id.find(observationId);
    return row && canReadObservation(tx, row, member) ? row : undefined;
  })
);

export const readObservationHistory = db.procedure(
  { name: "read_observation_history" },
  { afterSequence: t.u64(), limit: t.u32() },
  ObservationPage,
  (ctx, { afterSequence, limit }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    const requested = Math.max(1, Math.min(limit || 100, 1_000));
    const rows: ObservationRow[] = [];
    let nextSequence = afterSequence;
    let firstObserved: bigint | undefined;
    const maxScan = requested * 8 + 32;
    for (let offset = 1; offset <= maxScan && rows.length < requested; offset += 1) {
      const sequence = afterSequence + BigInt(offset);
      const row = tx.db.observation.sequence.find(sequence);
      if (!row) continue;
      firstObserved ??= sequence;
      nextSequence = sequence;
      if (canReadObservation(tx, row, member)) rows.push(row);
    }
    return {
      rows,
      nextSequence,
      historyGap: firstObserved !== undefined && firstObserved > afterSequence + 1n,
    };
  })
);

export const readEventHistory = db.procedure(
  { name: "read_event_history" },
  { subjectId: t.string(), afterSequence: t.u64(), limit: t.u32() },
  EventPage,
  (ctx, { subjectId, afterSequence, limit }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    if (!hasWorldRead(tx, member)) return { rows: [], nextSequence: afterSequence, historyGap: true };
    const requested = Math.max(1, Math.min(limit || 100, 1_000));
    const rows: Infer<typeof worldEvent.rowType>[] = [];
    let nextSequence = afterSequence;
    let firstObserved: bigint | undefined;
    const maxScan = requested * 8 + 32;
    for (let offset = 1; offset <= maxScan && rows.length < requested; offset += 1) {
      const sequence = afterSequence + BigInt(offset);
      const row = tx.db.worldEvent.sequence.find(sequence);
      if (!row) continue;
      firstObserved ??= sequence;
      nextSequence = sequence;
      if (row.subjectId === subjectId) rows.push(row);
    }
    return {
      rows,
      nextSequence,
      historyGap: firstObserved !== undefined && firstObserved > afterSequence + 1n,
    };
  })
);

export const readMapHistory = db.procedure(
  { name: "read_map_history" },
  { mapId: t.string(), afterRevision: t.u64(), limit: t.u32() },
  MapPage,
  (ctx, { mapId, afterRevision, limit }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    const map = tx.db.localMap.id.find(mapId);
    if (!map || (!hasWorldRead(tx, member) && member.unitId !== map.unitId)) {
      return { rows: [], nextRevision: afterRevision, historyGap: true };
    }
    const requested = Math.max(1, Math.min(limit || 100, 1_000));
    const rows: MapRevisionRow[] = [];
    let nextRevision = afterRevision;
    let firstObserved: bigint | undefined;
    for (let offset = 1; offset <= requested; offset += 1) {
      const revision = afterRevision + BigInt(offset);
      const row = tx.db.mapRevision.key.find(key(mapId, revision));
      if (!row) continue;
      firstObserved ??= revision;
      nextRevision = revision;
      rows.push(row);
    }
    return {
      rows,
      nextRevision,
      historyGap: firstObserved !== undefined && firstObserved > afterRevision + 1n,
    };
  })
);

export const readSpatialFrameDetail = db.procedure(
  { name: "read_spatial_frame_detail" },
  { frameId: t.string() },
  t.option(spatialFrame.rowType),
  (ctx, { frameId }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    const row = tx.db.spatialFrame.id.find(frameId);
    return row && (hasWorldRead(tx, member) || member.unitId === row.unitId) ? row : undefined;
  })
);

export const readGeometryDetail = db.procedure(
  { name: "read_geometry_detail" },
  { key: t.string() },
  t.option(geometry.rowType),
  (ctx, { key: geometryKey }) => ctx.withTx((tx) => {
    const member = memberForRead(tx);
    const row = tx.db.geometry.key.find(geometryKey) as GeometryRow | undefined;
    if (!row) return undefined;
    if (hasWorldRead(tx, member)) return row;
    const observationRow = tx.db.observation.id.find(row.observationId);
    return observationRow && canReadObservation(tx, observationRow, member) ? row : undefined;
  })
);
