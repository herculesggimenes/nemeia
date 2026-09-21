import assert from "node:assert/strict";
import test from "node:test";
import { createBackpackFixture, createSimulationClock } from "../src/backpack-fixture.ts";
import { runFakeBackpackE8 } from "../src/backpack-harness.ts";
import { MockBackpackWorld } from "../src/mock-world-adapter.ts";

test("mock-contract backpack flow retains evidence across simulated restart and records reviewed progress", async () => {
  const clock = createSimulationClock();
  clock.advance(35_000);
  const fixture = createBackpackFixture();
  const world = new MockBackpackWorld();
  const flow = await runFakeBackpackE8({ world, fixture });
  assert.equal(flow.report.mode, "mock-contract");
  assert.equal(flow.report.result, "blocked");
  assert.equal(flow.report.claimable, false);
  assert.equal(flow.completion.state, "succeeded");
  assert.equal(flow.progress.objectiveId, fixture.mission.objectiveId);
  assert.equal(flow.afterRestart.recordedAcquisitionAt, fixture.firstObservation.recordedAcquisitionAt);
  assert.equal(clock.now(), 35_000);
});
