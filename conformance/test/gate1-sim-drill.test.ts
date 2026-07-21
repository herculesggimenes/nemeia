import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { runGate1SimDrill } from "../src/gate1-sim-drill.ts";

test("Gate 1 sim drill proves signed bounded execution, live stop, and replay", () => {
  const drill = runGate1SimDrill();

  assert.equal(drill.report.result, "pass");
  assert.equal(verifyCanonicalJson(drill.authorization, drill.server.publicKey), true);
  assert.equal(drill.report.checks.every((entry) => entry.result === "pass"), true);
  assert.ok(drill.report.checks.some((entry) => entry.name === "mission_server_projects_run_terminal_state"));
  assert.deepEqual(drill.activeTick.chunk_ack.applied_setpoint, { vx_mps: 0.15, vy_mps: 0, yaw_rps: 0.2 });
  assert.equal(drill.driver.status().safe_state_active, true);
  assert.ok(drill.replay.events.some((event) => event.event_type === "authorization.issued"));
  assert.ok(drill.replay.events.some((event) => event.event_type === "kernel.chunk_applied"));
  assert.ok(drill.replay.events.some((event) => event.event_type === "authorization.stopped"));
  assert.equal(drill.replay.events.every((event) => event.run_id === drill.run.id), true);
  assert.deepEqual(drill.replay.authorization_ids, [drill.authorization.id]);
  assertReplayEventsMatchRegistry(drill.replay.events);
});

function assertReplayEventsMatchRegistry(events) {
  const registry = JSON.parse(readFileSync(new URL("../../contracts/registries/event-types.json", import.meta.url), "utf8"));
  const eventTypes = new Map(registry.values.map((entry) => [entry.name, entry]));
  for (const event of events) {
    const metadata = eventTypes.get(event.event_type);
    assert.ok(metadata, `${event.event_type} must be registered`);
    if (metadata.run_id_required) {
      assert.ok(event.run_id, `${event.event_type} must carry run_id`);
    }
  }
}
