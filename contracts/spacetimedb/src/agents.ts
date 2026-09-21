import { t, type Infer } from "spacetimedb/server";

export const ReadScope = t.object("ReadScope", {
  worldId: t.string(),
});
export type ReadScope = Infer<typeof ReadScope>;

export const AwarenessPolicy = t.object("AwarenessPolicy", {
  maxEntities: t.u32(),
  maxObservationRows: t.u32(),
  maxEventRows: t.u32(),
  maxMessageRows: t.u32(),
  radiusM: t.option(t.f64()),
  minIntervalMs: t.u32(),
  maxWaitMs: t.u32(),
});
export type AwarenessPolicy = Infer<typeof AwarenessPolicy>;
