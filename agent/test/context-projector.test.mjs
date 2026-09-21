import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorldContextProjector } from "../lib/world-bridge/context-projector.ts";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";

test("same-step context is pinned while a new step gets fresh projection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-context-"));
  const ledger = new DeliveryLedger(join(directory, "ledger.sqlite"));
  let reads = 0;
  try {
    const projection = {
      worldId: "world",
      agentId: "agent",
      worldRevision: "revision-1",
      missionLog: [
        { missionId: "mission-1", description: "inspect", lifecycle: "active", readyObjectiveIds: ["o1"], pendingObjectiveIds: [] },
        { missionId: "mission-2", description: "report", lifecycle: "active", readyObjectiveIds: [], pendingObjectiveIds: ["o2"] },
      ],
      summary: { state: "ready" },
      sourceIds: ["source-1"],
      dirtyKeys: ["mission"],
      mustHandleIds: ["evidence-1"],
      rescanRequired: false,
      acquisitionTimes: ["2026-09-20T00:00:00.000Z"],
      evidence: [],
    };
    const projector = new WorldContextProjector({
      ledger,
      worldId: "world",
      agentId: "agent",
      maxContextBytes: 4096,
      world: { async readProjection() { reads += 1; return projection; } },
    });
    const principal = { principalId: "current", principalType: "service", authenticator: "jwt-hmac" };
    const step = { sessionId: "session", turnId: "turn", stepIndex: 0 };
    const first = await projector.prepare(step, principal, { now: () => new Date("2026-09-20T01:00:00.000Z") });
    const retry = await projector.prepare(step, principal, { now: () => new Date("2026-09-20T02:00:00.000Z") });
    const next = await projector.prepare({ ...step, stepIndex: 1 }, principal, {
      now: () => new Date("2026-09-20T02:00:00.000Z"),
    });
    assert.equal(reads, 3);
    assert.equal(retry.contextId, first.contextId);
    assert.notEqual(next.contextId, first.contextId);
    assert.match(first.files.find((file) => file.path === "/world/mission-log.json").content, /mission-2/);
    assert.deepEqual(first.acquisitionTimes, projection.acquisitionTimes);
  } finally {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("same-step retained context is not returned after current principal loses access", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-context-auth-"));
  const ledger = new DeliveryLedger(join(directory, "ledger.sqlite"));
  let authorized = true;
  try {
    const projection = {
      worldId: "world",
      agentId: "agent",
      worldRevision: "revision-1",
      missionLog: [],
      summary: { state: "ready" },
      sourceIds: [],
      dirtyKeys: [],
      mustHandleIds: [],
      rescanRequired: false,
      acquisitionTimes: [],
      evidence: [],
    };
    const projector = new WorldContextProjector({
      ledger,
      world: {
        async readProjection({ principal }) {
          if (!authorized || principal.principalId !== "allowed") throw new Error("world read denied");
          return projection;
        },
      },
      worldId: "world",
      agentId: "agent",
      maxContextBytes: 4096,
    });
    const step = { sessionId: "session", turnId: "turn", stepIndex: 0 };
    const allowed = { principalId: "allowed", principalType: "service", authenticator: "jwt-hmac" };
    const revoked = { principalId: "revoked", principalType: "service", authenticator: "jwt-hmac" };
    const first = await projector.prepare(step, allowed);
    authorized = false;
    await assert.rejects(() => projector.prepare(step, revoked), /world read denied/);
    assert.equal(projector["input"].ledger.getContext(step)?.contextId, first.contextId);
  } finally {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
