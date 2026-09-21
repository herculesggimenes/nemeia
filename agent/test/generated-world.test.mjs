import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedWorldReadPort } from "../lib/world-bridge/generated-world.ts";
import { generatedWorldSnapshot } from "./generated-world-fixture.ts";

const snapshot = generatedWorldSnapshot;

test("generated authorized feeds produce a bounded mission and world projection", async () => {
  const calls = [];
  const port = createGeneratedWorldReadPort({
    client: { snapshot },
    snapshotRevision: () => "world-revision-7",
    authorizeCurrentPrincipal: (request) => calls.push(request.principal.principalId),
    attention: () => ({ generation: 1, sourceIds: ["wake-source"], dirtyKeys: ["entity-1"], mustHandleIds: ["evidence-1"], rescanRequired: false }),
  });
  const projection = await port.readProjection({
    worldId: "world-1",
    agentId: "agent-1",
    principal: { principalId: "principal", principalType: "agent", authenticator: "eve" },
    operation: "summary",
    maxBytes: 64 * 1024,
  });
  assert.deepEqual(calls, ["principal"]);
  assert.equal(projection.worldRevision, "world-revision-7");
  assert.deepEqual(projection.missionLog[0].readyObjectiveIds, ["objective-2"]);
  assert.deepEqual(projection.missionLog[0].pendingObjectiveIds, []);
  assert.deepEqual(projection.summary.unitState[0].control, {
    unitId: "unit-1",
    epoch: "4",
    activeExecutionId: "execution-1",
    stopLatched: false,
    safeStateConfirmed: true,
    observedAt: "2026-09-20T00:00:02.000000Z",
  });
  assert.equal(projection.summary.localMaps[0].headRevision, "2");
  assert.equal(projection.summary.objects[0].missingDepth, true, "BoundingBox2D does not establish depth");
  assert.deepEqual(projection.summary.objects[0].supportObservationIds, ["observation-1"]);
  assert.deepEqual(projection.mustHandleIds, ["evidence-1"]);
  assert.deepEqual(projection.dirtyKeys, ["entity-1"]);
  assert.ok(projection.sourceIds.includes("wake-source"));
  assert.ok(projection.sourceIds.includes("world.relevant_mission_objective_progress"));
  assert.ok(projection.acquisitionTimes.includes("2026-09-20T00:00:02.000000Z"));
  assert.equal(projection.summary.evidence[0].evidence.tag, "Observation");
  assert.equal(projection.missionLog[0].objectives[0].description, "observe the backpack semantically");
});

test("generated adapter requires current authorization and rejects unauthorized readiness", async () => {
  let authorized = false;
  const port = createGeneratedWorldReadPort({
    client: { snapshot },
    snapshotRevision: () => "world-revision-7",
    authorizeCurrentPrincipal: () => {
      if (!authorized) throw new Error("current principal revoked");
    },
    attention: () => ({ generation: 0, sourceIds: [], dirtyKeys: [], mustHandleIds: [], rescanRequired: false }),
  });
  await assert.rejects(() => port.readProjection({
    worldId: "world-1", agentId: "agent-1", principal: { principalId: "principal", principalType: "agent", authenticator: "eve" }, operation: "summary", maxBytes: 64 * 1024,
  }), /current principal revoked/);
  authorized = true;
  const revokedSnapshot = () => ({ ...snapshot(), readiness: [{ ...snapshot().readiness[0], authorized: false }] });
  const revokedPort = createGeneratedWorldReadPort({ client: { snapshot: revokedSnapshot }, snapshotRevision: () => "world-revision-8", authorizeCurrentPrincipal: () => undefined, attention: () => ({ generation: 0, sourceIds: [], dirtyKeys: [], mustHandleIds: [], rescanRequired: false }) });
  await assert.rejects(() => revokedPort.readProjection({
    worldId: "world-1", agentId: "agent-1", principal: { principalId: "principal", principalType: "agent", authenticator: "eve" }, operation: "mission-log", maxBytes: 64 * 1024,
  }), /authorized world projection is unavailable/);
});

test("generated detail command seam uses bounded canonical procedure arguments", async () => {
  let received;
  const port = createGeneratedWorldReadPort({
    client: {
      snapshot,
      readMapHistory: async (args) => {
        received = args;
        return { rows: [], nextRevision: 3n, historyGap: false };
      },
    },
    snapshotRevision: () => "world-revision-7",
    authorizeCurrentPrincipal: () => undefined,
    attention: () => ({ generation: 0, sourceIds: [], dirtyKeys: [], mustHandleIds: [], rescanRequired: false }),
  });
  const detail = await port.readDetail({
    worldId: "world-1",
    agentId: "agent-1",
    principal: { principalId: "principal", principalType: "agent", authenticator: "eve" },
    operation: "map-history",
    mapId: "map-1",
    afterRevision: "2",
    limit: 4,
    maxBytes: 4096,
  });
  assert.equal(received.afterRevision, 2n);
  assert.equal(received.limit, 4);
  assert.deepEqual(detail.value, { historyGap: false, nextRevision: "3", rows: [] });
});
