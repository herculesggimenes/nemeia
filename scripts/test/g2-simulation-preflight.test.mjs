import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSyntheticStandardFixture } from "../../perception/src/index.ts";
import { LocalController, FakeNoMotionExecutor } from "../../local-controller/src/local-controller.ts";
import { newStationaryG2Observation } from "../g2-simulation-preflight.mjs";

test("fixture-only G2 acquisition preserves old G1 evidence and frame without a map reset", () => {
  const retained = createSyntheticStandardFixture({ capturedAt: "2026-09-19T12:00:45.000Z", receivedAt: "2026-09-19T12:00:46.000Z", mapCapturedAt: "2026-09-19T12:00:46.000Z" });
  const fresh = newStationaryG2Observation(retained, { now: Date.parse("2026-09-20T22:00:00Z"), suffix: "fixture" });
  assert.equal(retained.samples[0].capturedAt, "2026-09-19T12:00:45.000Z");
  assert.equal(fresh.observation.entityId, retained.unitId);
  assert.equal(fresh.observation.pose.frameId, retained.spatialFrameId);
  assert.equal(fresh.observation.localMapId, retained.localMapId);
  assert.equal(fresh.mapProduct, undefined);
  assert.notEqual(fresh.observation.id, retained.observation.id);
  assert.equal(fresh.samples[0].capturedAt, "2026-09-20T22:00:00.000Z");
  assert.deepEqual(fresh.observation.pose.value.positionM, { x: 0, y: 0, z: 0 });
});

test("actual local no-motion safety startup clears stop without execute or receipt", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-g2-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executor = new FakeNoMotionExecutor();
  const local = new LocalController({ path: join(directory, "controller.sqlite"), unitId: "fixture-unit", executor, initialEpoch: 7n });
  try {
    assert.equal(local.status().stopLatched, true);
    assert.equal(local.status().safeState, "unknown");
    const status = await local.clearStop();
    assert.equal(status.controllerEpoch, 7n);
    assert.equal(status.stopLatched, false);
    assert.equal(status.safeState, "confirmed");
    assert.equal(status.activeExecutionId, undefined);
    assert.equal(executor.executeCalls, 0);
    assert.deepEqual(local.receipts(), []);
  } finally { local.close(); }
});
