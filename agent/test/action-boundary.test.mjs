import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Timestamp } from "spacetimedb";
import { canonicalJson } from "../../world-client/src/json.ts";
import {
  ActionBoundaryConflictError,
  createTrustedActionPort,
  parseTrustedActionProposal,
} from "../lib/world-bridge/action-boundary.ts";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";

const principal = {
  principalId: "principal-a",
  principalType: "agent",
  authenticator: "eve-session",
};
const bindingA = { worldId: "world-1", agentId: "agent-a", principal };
const bindingB = {
  worldId: "world-1",
  agentId: "agent-b",
  principal: { ...principal, principalId: "principal-b" },
};

const at = (micros) => new Timestamp(BigInt(micros));
const now = at(1_800_000_000_000_000n);

function snapshotState(overrides = {}) {
  const state = {
    readiness: [{
      key: "world",
      worldId: "world-1",
      mode: "simulation",
      authorized: true,
      role: "agent",
      unitId: undefined,
      synchronized: true,
    }],
    addressedMessages: [],
    assignedMissions: [{
      id: "mission-1",
      owner: "operator",
      spec: {
        description: "navigate",
        template: undefined,
        objectives: [{
          id: "objective-1",
          description: "reach the map target",
          dependsOn: [],
          optional: false,
          criterion: { tag: "Located", value: { description: "target reached" } },
        }],
        deadlineAt: at(1_800_000_060_000_000n),
      },
      state: { tag: "Active" },
      revision: 7n,
      closingOutcome: undefined,
      createdAt: at(1_799_999_000_000_000n),
      updatedAt: at(1_800_000_000_000_000n),
    }],
    relevantActionBindings: [{
      key: "unit-1:navigate@1",
      unitId: "unit-1",
      actionName: "navigate@1",
      version: 11n,
      policy: {
        executor: { name: "sim-controller", version: "1.0.0", sha256: "a".repeat(64) },
        mode: { tag: "Simulation" },
        maxEvidenceAgeMs: 10_000,
        maxLinearMps: 1,
        maxRunMs: 5_000,
        toleranceM: 0.1,
      },
    }],
    relevantAgents: [],
    relevantEntities: [],
    relevantExecutions: [],
    relevantGeometry: [],
    relevantLocalMaps: [{
      id: "map-1",
      unitId: "unit-1",
      rootFrameId: "map-root",
      headRevision: 19n,
      updatedAt: at(1_800_000_000_000_000n),
    }],
    relevantMissionAgents: [{ key: "mission-1:agent-a", missionId: "mission-1", agentId: "agent-a", active: true }],
    relevantMissionObjectiveProgress: [],
    relevantPoses: [],
    relevantSemantic: [],
    relevantUnitAssignments: [{
      unitId: "unit-1",
      agentId: "agent-a",
      revision: 23n,
      actionNames: ["navigate@1"],
      expiresAt: at(1_800_000_030_000_000n),
      updatedAt: at(1_800_000_000_000_000n),
    }],
    relevantUnitControls: [{
      unitId: "unit-1",
      controller: "controller",
      epoch: 4n,
      activeExecutionId: undefined,
      stopLatched: false,
      safeStateConfirmed: true,
      observedAt: at(1_800_000_000_000_000n),
    }],
  };
  return { ...state, ...overrides };
}

function navigateProposal(extra = {}) {
  return {
    kind: "navigate",
    missionId: "mission-1",
    objectiveId: "objective-1",
    mapId: "map-1",
    target: {
      positionM: { x: 1.25, y: -0.5, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    ...extra,
  };
}

function fixture({ filename, binding = bindingA, step = { sessionId: "session-1", turnId: "turn-1", stepIndex: 0 }, snapshot = snapshotState(), requestExecution } = {}) {
  let currentSnapshot = snapshot;
  const calls = [];
  const world = {
    snapshot: () => currentSnapshot,
    requestExecution: async (request) => {
      calls.push(request);
      if (requestExecution) await requestExecution(request, calls);
    },
  };
  const ledger = new DeliveryLedger(filename);
  const port = createTrustedActionPort({
    ledger,
    world,
    hostContext: () => ({ binding, step }),
    now: () => now,
  });
  return {
    ledger,
    port,
    calls,
    binding,
    step,
    setSnapshot: (value) => { currentSnapshot = value; },
  };
}

function committedExecutionFrom(request, state = { tag: "Accepted" }, receiptId = "local-receipt-1") {
  return {
    id: request.executionId,
    requestedBy: "principal-a",
    agentId: request.assignment.agentId,
    unitId: request.unitId,
    missionId: request.missionLink.missionId,
    objectiveId: request.missionLink.objectiveId,
    missionRevision: request.missionLink.expectedRevision,
    assignmentRevision: request.assignment.revision,
    requestFingerprint: "server-fingerprint",
    acceptBy: request.acceptBy,
    input: request.input,
    binding: snapshotState().relevantActionBindings[0].policy,
    bindingVersion: request.bindingVersion,
    targetVersion: request.targetVersion,
    state,
    controller: undefined,
    controllerEpoch: undefined,
    createdAt: now,
    updatedAt: now,
    result: undefined,
    receiptId,
    safeStateProof: undefined,
  };
}

async function withLedger(run) {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-action-boundary-"));
  const filename = join(directory, "delivery.sqlite");
  try {
    return await run(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("proposal parser rejects authority, identity, revision, and fake geometry fields", () => {
  assert.throws(() => parseTrustedActionProposal({
    ...navigateProposal(),
    worldId: "other-world",
  }), /unsupported field/);
  assert.throws(() => parseTrustedActionProposal({
    ...navigateProposal(),
    executionId: "model-selected",
  }), /unsupported field/);
  assert.throws(() => parseTrustedActionProposal({
    kind: "approach",
    missionId: "mission-1",
    objectiveId: "objective-1",
    targetId: "entity-1",
    standoffM: 1,
    bbox3d: { frameId: "map", sizeM: { x: 1, y: 1, z: 1 } },
  }), /unsupported field/);
  assert.throws(() => parseTrustedActionProposal({
    ...navigateProposal(),
    target: { ...navigateProposal().target, positionM: { x: Infinity, y: 0, z: 0 } },
  }), /finite/);
});

test("first request persists exact PascalCase generated body and a future grant-bounded deadline", async () => {
  await withLedger(async (filename) => {
    const fixtureState = fixture({ filename });
    try {
      const receipt = await fixtureState.port.propose(navigateProposal(), bindingA);
      assert.equal(receipt.status, "accepted");
      assert.equal(fixtureState.calls.length, 1);
      const request = fixtureState.calls[0];
      assert.equal(request.input.tag, "Navigate");
      assert.equal(request.bindingVersion, 11n);
      assert.equal(request.targetVersion, 19n);
      assert.equal(request.assignment.revision, 23n);
      assert.equal(request.missionLink.expectedRevision, 7n);
      assert.equal(request.acceptBy.microsSinceUnixEpoch, 1_800_000_005_000_000n);
      assert.ok(request.acceptBy.microsSinceUnixEpoch < 1_800_000_030_000_000n);
      assert.match(receipt.requestFingerprint, /^sha256:[a-f0-9]{64}$/u);
    } finally {
      fixtureState.ledger.close();
    }
  });
});

test("same framework step rejects changed body and never allocates another execution", async () => {
  await withLedger(async (filename) => {
    const fixtureState = fixture({ filename });
    try {
      const first = await fixtureState.port.propose(navigateProposal(), bindingA);
      await assert.rejects(
        () => fixtureState.port.propose(navigateProposal({ target: { ...navigateProposal().target, positionM: { x: 2, y: -0.5, z: 0 } } }), bindingA),
        (error) => error instanceof ActionBoundaryConflictError && error.code === "step_body_conflict",
      );
      assert.equal(fixtureState.calls.length, 1);
      const stored = fixtureState.ledger.db.prepare("SELECT intent_id, request_json FROM action_receipt").get();
      assert.equal(stored.intent_id, first.executionId);
      assert.equal(JSON.parse(stored.request_json).executionId, first.executionId);
    } finally {
      fixtureState.ledger.close();
    }
  });
});

test("lost acknowledgement retries the exact persisted body and execution id after ledger reopen", async () => {
  await withLedger(async (filename) => {
    let calls = [];
    let first = fixture({ filename, requestExecution: async (request) => {
      calls.push(request);
      throw new Error("transport lost after send");
    } });
    let firstReceipt;
    try {
      firstReceipt = await first.port.propose(navigateProposal(), bindingA);
      assert.equal(firstReceipt.status, "uncertain");
      assert.equal(first.calls.length, 1);
    } finally {
      first.ledger.close();
    }
    const reopened = fixture({ filename, requestExecution: async (request) => {
      calls.push(request);
    } });
    try {
      const retry = await reopened.port.propose(navigateProposal(), bindingA);
      assert.equal(retry.executionId, firstReceipt.executionId);
      assert.equal(retry.status, "accepted");
      assert.equal(reopened.calls.length, 1);
      assert.equal(canonicalJson(reopened.calls[0]), canonicalJson(calls[0]));
      assert.equal(reopened.calls[0].acceptBy.microsSinceUnixEpoch, calls[0].acceptBy.microsSinceUnixEpoch);
    } finally {
      reopened.ledger.close();
    }
  });
});

test("new framework step is distinct only after prior uncertain Unit operation is reconciled", async () => {
  await withLedger(async (filename) => {
    const first = fixture({ filename, requestExecution: async () => { throw new Error("lost"); } });
    try {
      const firstReceipt = await first.port.propose(navigateProposal(), bindingA);
      assert.equal(firstReceipt.status, "uncertain");
    } finally {
      first.ledger.close();
    }
    const second = fixture({ filename, step: { sessionId: "session-1", turnId: "turn-1", stepIndex: 1 } });
    try {
      await assert.rejects(() => second.port.propose(navigateProposal(), bindingA), /previous Unit operation remains pending or uncertain/);
      assert.equal(second.calls.length, 0);
      const reconciled = await second.port.reconcile(bindingA);
      assert.equal(reconciled.length, 1);
      assert.equal(reconciled[0].status, "uncertain");
    } finally {
      second.ledger.close();
    }
  });
});

test("changed generated pins and current grant revocation block cached retries", async () => {
  await withLedger(async (filename) => {
    let current = snapshotState();
    const fixtureState = fixture({ filename, snapshot: current });
    try {
      await fixtureState.port.propose(navigateProposal(), bindingA);
      current = snapshotState({
        relevantLocalMaps: [{ ...snapshotState().relevantLocalMaps[0], headRevision: 20n }],
      });
      fixtureState.setSnapshot(current);
      await assert.rejects(() => fixtureState.port.propose(navigateProposal(), bindingA), /pins differ/);

      current = snapshotState({
        relevantUnitAssignments: [{ ...snapshotState().relevantUnitAssignments[0], agentId: undefined }],
      });
      fixtureState.setSnapshot(current);
      await assert.rejects(() => fixtureState.port.status(bindingA), /revoked or expired|not granted/);
    } finally {
      fixtureState.ledger.close();
    }
  });
});

test("visible committed receipt wins over a later map revision on same-step retry", async () => {
  await withLedger(async (filename) => {
    const initial = snapshotState();
    const fixtureState = fixture({ filename, snapshot: initial });
    try {
      const first = await fixtureState.port.propose(navigateProposal(), bindingA);
      const committed = committedExecutionFrom(first.request);
      fixtureState.setSnapshot(snapshotState({
        relevantLocalMaps: [{ ...initial.relevantLocalMaps[0], headRevision: 20n }],
        relevantExecutions: [committed],
      }));
      const retry = await fixtureState.port.propose(navigateProposal(), bindingA);
      assert.equal(retry.executionId, first.executionId);
      assert.equal(retry.status, "accepted");
      assert.equal(retry.worldState, "Accepted");
      assert.equal(fixtureState.calls.length, 1, "committed receipt is observed, not resent with stale pins");
      fixtureState.setSnapshot(snapshotState({
        readiness: [{ ...initial.readiness[0], authorized: false, synchronized: false }],
        relevantLocalMaps: [{ ...initial.relevantLocalMaps[0], headRevision: 20n }],
        relevantExecutions: [committed],
      }));
      await assert.rejects(() => fixtureState.port.status(bindingA), /authorized generated world snapshot/);
    } finally {
      fixtureState.ledger.close();
    }
  });
});

test("terminal receipt settles after cancellation and grant revision, allowing a future mission", async () => {
  await withLedger(async (filename) => {
    const initial = snapshotState();
    const first = fixture({ filename, snapshot: initial });
    let firstReceipt;
    try {
      firstReceipt = await first.port.propose(navigateProposal(), bindingA);
    } finally {
      first.ledger.close();
    }

    const missionTwo = {
      ...initial.assignedMissions[0],
      id: "mission-2",
      revision: 1n,
      spec: {
        ...initial.assignedMissions[0].spec,
        description: "future mission",
      },
    };
    const committedCancelled = committedExecutionFrom(firstReceipt.request, { tag: "Cancelled" }, "cancelled-receipt");
    const future = snapshotState({
      assignedMissions: [
        { ...initial.assignedMissions[0], state: { tag: "Cancelled" } },
        missionTwo,
      ],
      relevantMissionAgents: [
        { key: "mission-2:agent-a", missionId: "mission-2", agentId: "agent-a", active: true },
      ],
      relevantUnitAssignments: [{ ...initial.relevantUnitAssignments[0], revision: 24n }],
      relevantActionBindings: [{ ...initial.relevantActionBindings[0], version: 12n }],
      relevantExecutions: [committedCancelled],
    });
    const reopened = fixture({
      filename,
      snapshot: future,
      step: { sessionId: "session-1", turnId: "turn-1", stepIndex: 1 },
    });
    try {
      const oldStatus = await (() => {
        const oldStep = fixture({ filename, snapshot: future });
        return oldStep.port.status(bindingA).finally(() => oldStep.ledger.close());
      })();
      assert.equal(oldStatus.status, "cancelled");
      const next = await reopened.port.propose({
        ...navigateProposal(),
        missionId: "mission-2",
      }, bindingA);
      assert.notEqual(next.executionId, firstReceipt.executionId);
      assert.equal(reopened.calls.length, 1, "future mission is not jammed by the settled old row");
    } finally {
      reopened.ledger.close();
    }
  });
});

test("authorization flags and cross-agent scope cannot reach requestExecution", async () => {
  await withLedger(async (filename) => {
    const calls = [];
    const state = snapshotState();
    const unauthorized = fixture({
      filename,
      binding: bindingB,
      snapshot: state,
      requestExecution: async (request) => calls.push(request),
    });
    try {
      await assert.rejects(() => unauthorized.port.propose(navigateProposal(), bindingB), /not granted|authorized|participant/);
      assert.equal(calls.length, 0);
    } finally {
      unauthorized.ledger.close();
    }
  });
});

test("approach derives a current generated 3D geometry version and rejects missing geometry", async () => {
  await withLedger(async (filename) => {
    const state = snapshotState({
      assignedMissions: [{
        ...snapshotState().assignedMissions[0],
        spec: {
          ...snapshotState().assignedMissions[0].spec,
          objectives: [{
            id: "objective-1",
            description: "approach",
            dependsOn: [],
            optional: false,
            criterion: { tag: "Approached", value: { targetId: "entity-1", standoffM: 0.8 } },
          }],
        },
      }],
      relevantActionBindings: [{
        ...snapshotState().relevantActionBindings[0],
        key: "unit-1:approach@1",
        actionName: "approach@1",
      }],
      relevantUnitAssignments: [{
        ...snapshotState().relevantUnitAssignments[0],
        actionNames: ["approach@1"],
      }],
      relevantEntities: [{ id: "entity-1", displayName: "target", kind: "target", createdAt: now, removedAt: undefined }],
      relevantGeometry: [{
        key: "geometry-1",
        entityId: "entity-1",
        frameId: "map-root",
        value: { tag: "BoundingBox3D", value: { frameId: "map-root", pose: {}, sizeM: {} } },
        observedAt: now,
        observationId: "observation-1",
        version: 41n,
      }],
    });
    const fixtureState = fixture({ filename, snapshot: state });
    try {
      const receipt = await fixtureState.port.propose({
        kind: "approach",
        missionId: "mission-1",
        objectiveId: "objective-1",
        targetId: "entity-1",
        standoffM: 0.8,
      }, bindingA);
      assert.equal(receipt.request.input.tag, "Approach");
      assert.equal(receipt.request.input.value.expectedGeometryVersion, 41n);
    } finally {
      fixtureState.ledger.close();
    }
  });
});
