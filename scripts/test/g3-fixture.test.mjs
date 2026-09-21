import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizedPerception, createFreshG3Fixture } from "../g3-composition.mjs";
import { createSyntheticStandardFixture } from "../../perception/src/index.ts";
import { Timestamp } from "spacetimedb";

test("G3 creates a new synthetic acquisition without retiming retained G1 facts", () => {
  const retained = createSyntheticStandardFixture({
    capturedAt: "2026-09-19T12:00:45.000Z",
    receivedAt: "2026-09-19T12:00:46.000Z",
    mapCapturedAt: "2026-09-19T12:00:46.000Z",
  });
  const original = structuredClone(retained);
  const now = Date.parse("2026-09-20T20:00:00.000Z");
  const fresh = createFreshG3Fixture(retained, { now, trackId: "g3-fresh-acquisition" });
  assert.deepEqual(retained, original);
  assert.equal(fresh.fixtureKind, "synthetic");
  assert.notEqual(fresh.samples[0].bytes, retained.samples[0].bytes);
  assert.equal(fresh.unitId, retained.unitId);
  assert.equal(fresh.producerSession, retained.producerSession);
  assert.equal(fresh.observation.trackId, "g3-fresh-acquisition");
  assert.equal(fresh.samples[0].capturedAt, new Date(now - 2).toISOString());
  assert.equal(fresh.samples[0].receivedAt, new Date(now - 1).toISOString());
  assert.equal(fresh.observation.observedAt, fresh.samples[0].capturedAt);
  assert.equal(fresh.mapProduct.acquiredFrom, fresh.samples[0].capturedAt);
  assert.equal(fresh.mapProduct.acquiredThrough, new Date(now).toISOString());
  assert.equal(fresh.mapProduct.layers[0].capturedAt, fresh.mapProduct.acquiredThrough);
});

test("successful safe-proof callback publishes the measured pose before the result callback", async () => {
  const standardFixture = createSyntheticStandardFixture();
  const published = [];
  const recordedAt = new Timestamp(1_789_935_012_123_456n);
  const perception = {
    readSnapshot: async () => ({
      relevantSemantic: [{ observationId: standardFixture.observation.id, entityId: "retained-backpack" }],
      relevantPoses: [],
    }),
    ingestStandardSyntheticFixture: async (fixture) => { published.push(fixture); },
    callProcedure: async (name, { observationId }) => {
      assert.equal(name, "readObservationDetail");
      return { id: observationId, unitId: standardFixture.unitId, recordedAt };
    },
  };
  const adapter = await createAuthorizedPerception({ perception, standardFixture });
  const targetPose = { positionM: { x: 2, y: 1, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const receipt = { id: "receipt-1", safeState: "confirmed", completion: {
    action: "navigate@1", outcome: "succeeded",
    finalPose: { mapId: "pinned-map", frameId: "pinned-frame", basisMapRevision: 1n, targetPose },
  } };
  const evidence = await adapter.publishPostClaimEvidence({
    execution: { id: "execution-1", targetFrameId: "pinned-frame", input: {
      tag: "Navigate", value: { mapId: "pinned-map", targetFrameId: "pinned-frame", basisRevision: 1n },
    } },
    localReceipt: receipt,
    measuredState: { outcome: "succeeded", effect: "none" },
    phase: "safe-closure",
  });
  assert.equal(published.length, 1);
  assert.equal(published[0].mapProduct, undefined);
  assert.deepEqual(published[0].observation.pose.value, targetPose);
  assert.equal(published[0].observation.pose.frameId, "pinned-frame");
  assert.equal(evidence.safeObservationId, published[0].observation.id);
  assert.equal(evidence.completion, undefined);
  assert.equal(evidence.observedAt, recordedAt);
  assert.equal(published[0].observation.semantic, undefined);
});
