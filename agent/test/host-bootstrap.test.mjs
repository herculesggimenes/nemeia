import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createConnectedNemeiaWorldHost, createReadyNemeiaWorldHost } from "../lib/world-bridge/host-bootstrap.ts";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";
import { WorldContextProjector } from "../lib/world-bridge/context-projector.ts";
import { generatedWorldSnapshot } from "./generated-world-fixture.ts";

function snapshot(messageId, watermarkSequence) {
  return {
    readiness: [],
    addressedMessages: messageId === undefined ? [] : [{ id: messageId, body: "bounded" }],
    assignedMissions: generatedWorldSnapshot().assignedMissions,
    relevantActionBindings: [],
    relevantAgents: [{ id: "agent-1", paused: false }],
    relevantEntities: [],
    relevantExecutions: [],
    relevantFeedbackWatermarks: watermarkSequence === undefined
      ? []
      : [{ missionId: "mission-1", sequence: BigInt(watermarkSequence), eventId: `event-${watermarkSequence}`, recordedAt: new Date("2026-09-20T00:00:00.000Z") }],
    relevantGeometry: [],
    relevantLocalMaps: [],
    relevantMissionAgents: [{ missionId: "mission-1", agentId: "agent-1", active: true }],
    relevantMissionObjectiveProgress: [],
    relevantPoses: [],
    relevantSemantic: [],
    relevantUnitAssignments: [],
    relevantUnitControls: [],
  };
}

function makeLedger() {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-host-wake-"));
  return { directory, ledger: new DeliveryLedger(join(directory, "delivery.sqlite")) };
}

function delayedReadHost(ledger) {
  const owner = { principalId: "owner", principalType: "service", authenticator: "test" };
  const value = {
    callbacks: undefined, nativeReady: false, disconnects: 0, connects: 0, dispatches: 0,
    current: generatedWorldSnapshot(), currentPrincipal: owner,
  };
  const options = {
    uri: "http://127.0.0.1:1", databaseName: "no-live-database", worldId: "world-1", agentId: "agent-1", ledger,
    snapshotRevision: () => "revision-ready", currentPrincipal: () => value.currentPrincipal,
    // A JS caller must not be able to turn authenticated read startup into a dispatcher.
    wakeDispatcher: () => { value.dispatches++; },
    worldClientFactory(callbacks) {
      value.callbacks = callbacks;
      return {
        connect() { value.connects++; callbacks.onStateChange("connecting"); },
        subscribeCurrentWorld() {},
        disconnect() { value.disconnects++; value.nativeReady = false; callbacks.onStateChange("disconnected"); },
        snapshot() {
          if (!value.nativeReady) throw new Error("world_client_not_ready");
          return value.current;
        },
        requestExecution: async () => {},
      };
    },
  };
  return { value, options, owner };
}

test("authenticated read startup waits for native authorized readiness AND the initial snapshot before projection", async () => {
  const { directory, ledger } = makeLedger();
  const { value, options, owner } = delayedReadHost(ledger);
  let host;
  let prepared = false;
  const initialized = createReadyNemeiaWorldHost(options).then(async (readyHost) => {
    host = readyHost;
    const projector = new WorldContextProjector({ ledger, world: host.world, worldId: "world-1", agentId: "agent-1", maxContextBytes: 96 * 1024 });
    const context = await projector.prepare({ sessionId: "session", turnId: "turn", stepIndex: 0 }, owner);
    prepared = true;
    return context;
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prepared, false, "connect/subscribe return is not native readiness");
    value.nativeReady = true;
    value.callbacks.onStateChange("ready");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(prepared, false, "first context also waits for initial attention to be collected");
    value.callbacks.onSnapshotChange(value.current);
    const context = await initialized;
    assert.equal(prepared, true);
    assert.ok(context.sourceIds.includes("world.assigned_missions"));
    assert.equal(context.worldRevision, "revision-ready");
    assert.equal(value.dispatches, 0);
    value.currentPrincipal = { ...owner, principalId: "revoked-owner" };
    await assert.rejects(host.world.readProjection({ worldId: "world-1", agentId: "agent-1", principal: owner, operation: "summary", maxBytes: 96 * 1024 }), /principal/);
  } finally {
    host?.close(); await host?.settled();
    ledger.close(); rmSync(directory, { recursive: true, force: true });
  }
});

for (const failure of ["error", "disconnected", "timeout", "unauthorized", "ready-then-disconnected"]) {
  test(`read startup ${failure} closes the native client, suppresses late callbacks, and permits explicit retry`, async () => {
    const { directory, ledger } = makeLedger();
    const { value, options } = delayedReadHost(ledger);
    let host;
    try {
      const failed = createReadyNemeiaWorldHost(options, 25);
      const rejected = assert.rejects(failed, /world_client_/);
      if (failure === "error") value.callbacks.onStateChange("error", new Error("world_client_not_authorized"));
      if (failure === "disconnected") value.callbacks.onStateChange("disconnected");
      if (failure === "unauthorized" || failure === "ready-then-disconnected") {
        value.nativeReady = true;
        if (failure === "unauthorized") value.current = { ...value.current, readiness: value.current.readiness.map((row) => ({ ...row, authorized: false })) };
        value.callbacks.onStateChange("ready");
        value.callbacks.onSnapshotChange(value.current);
        if (failure === "ready-then-disconnected") value.callbacks.onStateChange("disconnected");
      }
      await rejected;
      assert.equal(value.disconnects, 1);
      assert.equal(value.dispatches, 0);
      const deadCallbacks = value.callbacks;
      ledger.close();
      // A queued native callback after teardown cannot touch even a closed WAL.
      assert.doesNotThrow(() => deadCallbacks.onSnapshotChange(generatedWorldSnapshot()));
      // A new authenticated initialization uses a fresh client, never the
      // failed cached promise. This intentionally is not background reconnect.
      const retryLedger = new DeliveryLedger(join(directory, "delivery.sqlite"));
      try {
        value.current = generatedWorldSnapshot();
        const retry = createReadyNemeiaWorldHost({ ...options, ledger: retryLedger });
        value.nativeReady = true;
        value.callbacks.onStateChange("ready");
        value.callbacks.onSnapshotChange(value.current);
        host = await retry;
        assert.equal(value.connects, 2);
        assert.equal(value.dispatches, 0);
        host.close(); await host.settled();
      } finally { retryLedger.close(); }
    } finally {
      host?.close();
      try { ledger.close(); } catch { /* Failure path already closed the test WAL. */ }
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("synchronous native subscribe failure closes a connected client before factory rejection", async () => {
  const { directory, ledger } = makeLedger();
  const { value, options } = delayedReadHost(ledger);
  const factory = options.worldClientFactory;
  try {
    await assert.rejects(createReadyNemeiaWorldHost({ ...options, worldClientFactory(callbacks) {
      return { ...factory(callbacks), subscribeCurrentWorld() { throw new Error("world_client_subscription_failed"); } };
    } }), /world_client_subscription_failed/);
    assert.equal(value.disconnects, 1);
    assert.equal(value.dispatches, 0);
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("connected generated host dispatches one pending public wake while snapshots coalesce", async () => {
  const first = snapshot("message-1", 1);
  const second = snapshot("message-2", 2);
  const third = snapshot("message-3", 3);
  let notify;
  let current = first;
  const { directory, ledger } = makeLedger();
  let releaseFirst;
  const firstWake = new Promise((resolve) => { releaseFirst = resolve; });
  const wakeCalls = [];
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(current); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return current; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (attention) => {
      wakeCalls.push(attention);
      if (wakeCalls.length === 1) await firstWake;
    },
  });

  notify(second);
  notify(third);
  assert.equal(wakeCalls.length, 1, "a busy channel handoff must not queue one turn per snapshot");
  releaseFirst();
  for (let attempt = 0; attempt < 20 && wakeCalls.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(wakeCalls.length, 2);
  assert.ok(wakeCalls[1].sourceIds.includes("world.relevant_feedback_watermarks"));
  assert.ok(wakeCalls[1].mustHandleIds.some((id) => id.includes("message-3")));
  host.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

test("wake handoff can be held during an active Eve step and flushed on idle", async () => {
  const current = snapshot("message-idle", 4);
  const changedBeforeStepStarted = snapshot("message-before-step-start", 5);
  let notify;
  const { directory, ledger } = makeLedger();
  ledger.markSessionBusy("eve-session-active");
  let calls = 0;
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(current); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return current; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async () => {
      if (ledger.hasActiveTurn()) return "deferred";
      calls += 1;
    },
  });
  assert.equal(calls, 0);
  notify(changedBeforeStepStarted);
  host.flushPendingWake();
  assert.equal(calls, 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  ledger.markTurnIdle("eve-session-active", "turn-1");
  host.flushPendingWake();
  for (let attempt = 0; attempt < 20 && calls < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, "the update before turn start is delivered after the initial wake without a second queued turn");
  host.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

test("transport retry keeps one durable wake id until the server becomes ready beyond the first retry batch", async () => {
  const current = snapshot("message-retry", 10);
  const { directory, ledger } = makeLedger();
  let notify;
  let attempts = 0;
  const wakeIds = [];
  const wakePayloads = [];
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    wakeRetryBaseDelayMs: 1,
    wakeRetryCapDelayMs: 2,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(current); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return current; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => {
      attempts += 1;
      wakeIds.push(wake.wakeId);
      wakePayloads.push({ sourceIds: [...wake.sourceIds], dirtyKeys: [...wake.dirtyKeys], mustHandleIds: [...wake.mustHandleIds], rescanRequired: wake.rescanRequired });
      if (attempts <= 7) throw new Error("Eve server is still building");
    },
  });
  for (let attempt = 0; attempt < 100 && attempts < 8; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(attempts >= 8, `expected retry after initial batch, got ${attempts}`);
  assert.equal(new Set(wakeIds).size, 1);
  assert.ok(wakePayloads.every((payload) => JSON.stringify(payload) === JSON.stringify(wakePayloads[0])));
  assert.equal(ledger.getWake(wakeIds[0]).status, "accepted");
  host.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

test("restart replays the exact uncertain wake identity and payload", async () => {
  const current = snapshot("message-restart", 11);
  const { directory, ledger: firstLedger } = makeLedger();
  const filename = join(directory, "delivery.sqlite");
  // Reopen the same WAL path after the first process leaves an uncertain row.
  firstLedger.close();
  let ledger = new DeliveryLedger(filename);
  let firstWake;
  let notify;
  const firstHost = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    wakeRetryBaseDelayMs: 1_000,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(current); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return current; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => {
      firstWake = wake;
      throw new Error("process stopped before wake delivery");
    },
  });
  for (let attempt = 0; attempt < 20 && firstWake === undefined; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(firstWake);
  firstHost.close();
  ledger.close();

  ledger = new DeliveryLedger(filename);
  let secondWake;
  let secondNotify;
  const secondHost = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      secondNotify = options.onSnapshotChange;
      return {
        connect() { secondNotify?.(current); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return current; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => { secondWake = wake; },
  });
  for (let attempt = 0; attempt < 20 && secondWake === undefined; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(secondWake);
  assert.equal(secondWake.wakeId, firstWake.wakeId);
  assert.deepEqual({ sourceIds: [...secondWake.sourceIds], dirtyKeys: [...secondWake.dirtyKeys], mustHandleIds: [...secondWake.mustHandleIds], rescanRequired: secondWake.rescanRequired }, { sourceIds: [...firstWake.sourceIds], dirtyKeys: [...firstWake.dirtyKeys], mustHandleIds: [...firstWake.mustHandleIds], rescanRequired: firstWake.rescanRequired });
  secondHost.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

test("feedback watermark row keys are mission plus sequence and only the current sequence is durable", async () => {
  const { directory, ledger } = makeLedger();
  const first = snapshot(undefined, 1);
  const second = snapshot(undefined, 2);
  let notify;
  const wakes = [];
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(first); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return first; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => { wakes.push(wake); },
  });
  for (let attempt = 0; attempt < 20 && wakes.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  const sequenceOne = "world.relevant_feedback_watermarks:mission-1:1";
  const sequenceTwo = "world.relevant_feedback_watermarks:mission-1:2";
  assert.ok(wakes[0].mustHandleIds.includes(sequenceOne));
  assert.equal(host.acknowledgeMustHandle(sequenceOne), true);
  notify(second);
  for (let attempt = 0; attempt < 20 && wakes.length < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(wakes[1].mustHandleIds.includes(sequenceTwo));
  assert.ok(!wakes[1].mustHandleIds.includes(sequenceOne));
  host.close();
  ledger.close();
  const reopened = new DeliveryLedger(join(directory, "delivery.sqlite"));
  assert.deepEqual(reopened.listPendingMustHandle(), [sequenceTwo]);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test("paused agents retain coalesced work and resume with one useful wake", async () => {
  const { directory, ledger } = makeLedger();
  const paused = { ...snapshot("message-paused", 12), relevantAgents: [{ id: "agent-1", paused: true }] };
  const pausedSensorUpdate = { ...paused, relevantGeometry: [{ id: "geometry-1" }] };
  const resumed = { ...pausedSensorUpdate, relevantAgents: [{ id: "agent-1", paused: false }] };
  let notify;
  const wakes = [];
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(paused); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return resumed; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => { wakes.push(wake); },
  });
  notify(pausedSensorUpdate);
  notify(pausedSensorUpdate);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wakes.length, 0, "paused streams do not start inference");
  notify(resumed);
  for (let attempt = 0; attempt < 20 && wakes.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wakes.length, 1);
  assert.ok(wakes[0].sourceIds.includes("world.relevant_geometry"));
  host.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

test("without an active mission, sensor churn is retained until assignment makes it meaningful", async () => {
  const { directory, ledger } = makeLedger();
  const initial = {
    ...snapshot(undefined, undefined),
    relevantAgents: [],
    relevantMissionAgents: [],
  };
  const sensor = { ...initial, relevantPoses: [{ id: "pose-1" }] };
  const sensorAgain = { ...initial, relevantPoses: [{ id: "pose-2" }] };
  const assignment = {
    ...sensorAgain,
    relevantAgents: [{ id: "agent-1", paused: false }],
    relevantMissionAgents: [{ missionId: "mission-1", agentId: "agent-1", active: true }],
  };
  let notify;
  const wakes = [];
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:3000",
    databaseName: "nemeia",
    worldId: "world-1",
    agentId: "agent-1",
    ledger,
    snapshotRevision: () => "revision",
    currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
    worldClientFactory(options) {
      notify = options.onSnapshotChange;
      return {
        connect() { notify?.(initial); },
        subscribeCurrentWorld() {},
        disconnect() {},
        snapshot() { return assignment; },
        requestExecution() { return Promise.resolve(); },
      };
    },
    wakeDispatcher: async (wake) => { wakes.push(wake); },
  });
  notify(sensor);
  notify(sensorAgain);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wakes.length, 0, "ordinary sensor changes do not wake an unassigned agent");
  notify(assignment);
  for (let attempt = 0; attempt < 20 && wakes.length < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(wakes.length, 1);
  assert.ok(wakes[0].sourceIds.includes("world.relevant_mission_agents"));
  host.close();
  ledger.close();
  rmSync(directory, { recursive: true, force: true });
});

for (const state of ["Succeeded", "Failed", "Cancelled"]) {
  test(`${state} mission with retained active membership suppresses sensor wakes`, async () => {
    const { directory, ledger } = makeLedger();
    let current = generatedWorldSnapshot();
    let notify;
    const wakes = [];
    const host = createConnectedNemeiaWorldHost({
      uri: "http://127.0.0.1:3000",
      databaseName: "nemeia",
      worldId: "world-1",
      agentId: "agent-1",
      ledger,
      snapshotRevision: () => "revision",
      currentPrincipal: () => ({ principalId: "owner", principalType: "service", authenticator: "test" }),
      worldClientFactory(options) {
        notify = options.onSnapshotChange;
        return {
          connect() { notify(current); },
          subscribeCurrentWorld() {},
          disconnect() {},
          snapshot() { return current; },
          requestExecution() { return Promise.resolve(); },
        };
      },
      wakeDispatcher: async (wake) => { wakes.push(wake); },
    });
    const publish = async (next) => {
      current = next;
      notify(current);
      await new Promise((resolve) => setImmediate(resolve));
    };
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(wakes.length, 1);
      await publish({
        ...current,
        assignedMissions: current.assignedMissions.map((mission) => ({ ...mission, state: { tag: state } })),
      });
      assert.equal(current.relevantMissionAgents[0].active, true);
      assert.equal(wakes.length, 2, "the terminal outcome itself is meaningful once");
      for (let index = 0; index < 3; index += 1) {
        await publish({
          ...current,
          relevantPoses: current.relevantPoses.map((pose) => ({ ...pose, version: pose.version + 1n })),
        });
      }
      assert.equal(wakes.length, 2, "retained membership does not enable sensor-only inference");
      assert.ok(host.attention().sourceIds.includes("world.relevant_poses"), "sensor changes remain pending");

      // An Active mission with a different id does not satisfy the retained membership.
      const activeMission = generatedWorldSnapshot().assignedMissions[0];
      await publish({ ...current, assignedMissions: [...current.assignedMissions, { ...activeMission, id: "mission-2" }] });
      assert.equal(wakes.length, 3, "new mission availability is meaningful once");
      await publish({
        ...current,
        relevantPoses: current.relevantPoses.map((pose) => ({ ...pose, version: pose.version + 1n })),
      });
      assert.equal(wakes.length, 3, "ordinary sensor wakes require membership in that Active mission");
      await publish({
        ...current,
        relevantMissionAgents: [...current.relevantMissionAgents, { key: "mission-2:agent-1", missionId: "mission-2", agentId: "agent-1", active: true }],
      });
      assert.equal(wakes.length, 4, "assignment releases retained attention");
      await publish({
        ...current,
        relevantPoses: current.relevantPoses.map((pose) => ({ ...pose, version: pose.version + 1n })),
      });
      assert.equal(wakes.length, 5, "sensor changes wake again with a matching Active mission");
    } finally {
      host.close();
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
