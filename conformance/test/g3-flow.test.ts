import assert from "node:assert/strict";
import test from "node:test";
import { Identity, Timestamp } from "spacetimedb";
import {
  confirmedG3ControllerEpoch,
  assertG3ReceiptMatchesExecution,
  createG3StationarySimulationFixture,
  HeldNoMotionExecutor,
  type ActualEveInvocationEvidence,
  type InvokeTrustedCommandInput,
  runActualG3Flow,
  runG3ConcurrentInvocation,
} from "../src/g3-flow.ts";
import type { ControllerCommand, ExecutorResult } from "../../local-controller/src/local-controller.ts";
import type { Execution, UnitControl } from "../../world-client/src/generated/types.ts";
import type { ActionReceipt } from "../../agent/lib/world-bridge/action-boundary.ts";
import { createSyntheticStandardFixture } from "../../perception/src/fixture.ts";
import { canonicalJson } from "../../world-client/src/json.ts";

function controllerEpochFixture(epoch: bigint) {
  const identity = new Identity(7n);
  const state: { control: UnitControl | null } = {
    control: {
      unitId: "entity-go2-001",
      controller: identity,
      epoch,
      activeExecutionId: undefined,
      stopLatched: false,
      safeStateConfirmed: true,
      observedAt: Timestamp.fromDate(new Date("2026-09-20T00:00:00Z")),
    },
  };
  const lookups: string[] = [];
  // Only the generated read surface is supplied: no reducer, connection
  // builder, LocalController constructor, or database file is used here.
  const connection: Parameters<typeof confirmedG3ControllerEpoch>[0] = {
    isActive: true,
    identity,
    db: { relevantUnitControls: { unitId: { find: (unitId) => {
      lookups.push(unitId);
      return state.control;
    } } } },
  };
  return { connection, state, lookups };
}

test("G3 seeds a new controller from the current enrolled epoch without losing u64 precision", () => {
  for (const epoch of [0n, 19n, 9_007_199_254_740_993n]) {
    const { connection, state, lookups } = controllerEpochFixture(epoch);
    assert.equal(confirmedG3ControllerEpoch(connection, "entity-go2-001"), epoch);
    state.control = { ...state.control!, epoch: epoch + 3n };
    assert.equal(confirmedG3ControllerEpoch(connection, "entity-go2-001"), epoch + 3n);
    assert.deepEqual(lookups, ["entity-go2-001", "entity-go2-001"]);
  }
});

test("G3 refuses to default the epoch when the enrolled Unit control is absent", () => {
  const { connection, state } = controllerEpochFixture(19n);
  state.control = null;
  assert.throws(() => confirmedG3ControllerEpoch(connection, "entity-go2-001"), /enrolled Unit control/);
});

test("G3 requires the control to belong to the requested Unit and connected controller", () => {
  const { connection, state } = controllerEpochFixture(19n);
  assert.throws(() => confirmedG3ControllerEpoch(connection, "another-unit"), /enrolled Unit control/);
  state.control = { ...state.control!, controller: new Identity(8n) };
  assert.throws(() => confirmedG3ControllerEpoch(connection, "entity-go2-001"), /current controller identity/);
  connection.identity = undefined;
  assert.throws(() => confirmedG3ControllerEpoch(connection, "entity-go2-001"), /current controller identity/);
});

test("G3 cannot seed an epoch from an inactive controller connection", () => {
  const { connection, lookups } = controllerEpochFixture(19n);
  connection.isActive = false;
  assert.throws(() => confirmedG3ControllerEpoch(connection, "entity-go2-001"), /connection is inactive/);
  assert.deepEqual(lookups, []);
});

function navigationCommand(): Extract<ControllerCommand, { kind: "navigate@1" }> {
  return {
    kind: "navigate@1",
    executionId: "g3-held-execution",
    unitId: "entity-go2-001",
    controllerEpoch: 1n,
    requestDigest: "sha256:test",
    normalizedRequest: {} as ControllerCommand["normalizedRequest"],
    bindingPolicy: { mode: "simulation", maxRunMs: 10_000 },
    mapId: "g3-map",
    basisMapRevision: 1n,
    targetFrameId: "g3-frame",
    targetPose: {
      positionM: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

test("held G3 executor stop resolves the pending execute exactly once before release", async () => {
  const executor = new HeldNoMotionExecutor();
  const controller = navigationCommand();
  const abort = new AbortController();
  const pending = executor.execute(controller, abort.signal);

  const stopped = await executor.stop("qualification-cancel");
  const result = await pending;
  assert.equal(stopped.safeState, "confirmed");
  assert.equal(result.outcome, "cancelled");
  assert.equal(executor.executeCalls, 1);
  assert.equal(executor.stopCalls, 1);
  assert.equal(executor.released, false);

  // A late release cannot resolve a second result after stop cleared the
  // pending token. This is the regression that previously hung G3.
  executor.release();
  assert.equal(executor.released, false);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const aborted = await executor.execute({ ...controller, executionId: "g3-held-aborted" }, alreadyAborted.signal);
  assert.equal(aborted.outcome, "cancelled");
  assert.equal(executor.executeCalls, 2);
});

test("G3 exports the production callback boundary without manufacturing Eve evidence", () => {
  assert.equal(typeof runActualG3Flow, "function");
  const callback: (input: InvokeTrustedCommandInput) => Promise<ActualEveInvocationEvidence> = async ({ argv }) => {
    assert.deepEqual(argv.slice(0, 4), ["nemeia", "world", "action", "propose"]);
    throw new Error("not invoked in the unit-only conformance test");
  };
  assert.equal(typeof callback, "function");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("slow Eve teardown cannot hold the fake execution past its unchanged 10s watchdog", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const executor = new HeldNoMotionExecutor();
  const command = navigationCommand();
  const started = deferred<void>();
  const settled = deferred<ExecutorResult>();
  let execution!: Promise<ExecutorResult>;
  let eveReturned = false;
  let watchdogFired = false;
  const invocation = runG3ConcurrentInvocation(async () => {
    // Real Eve takes time before reaching requestExecution/claim/execute.
    await new Promise<void>((done) => setTimeout(done, 50));
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      void executor.stop("watchdog");
    }, command.bindingPolicy.maxRunMs);
    execution = executor.execute(command, new AbortController().signal);
    void execution.then(() => clearTimeout(watchdog));
    started.resolve();
    // This callback remains pending longer than the production binding's
    // 10_000ms budget; only virtual time is used, and no controller DB exists.
    await new Promise<void>((done) => setTimeout(done, 10_026));
    eveReturned = true;
    return { executionId: command.executionId };
  }, async () => {
    await started.promise;
    assert.equal(executor.pendingCommand?.executionId, command.executionId);
    executor.release(command.executionId);
    const result = await execution;
    settled.resolve(result);
    return command.executionId;
  });
  await Promise.resolve();
  assert.equal(executor.pendingCommand, undefined);
  t.mock.timers.tick(50);
  assert.equal((await settled.promise).outcome, "succeeded");
  assert.equal(eveReturned, false);
  assert.equal(command.bindingPolicy.maxRunMs, 10_000);
  t.mock.timers.tick(10_026);
  const joined = await invocation;
  assert.equal(joined.delivery.executionId, joined.observed);
  assert.equal(watchdogFired, false);
  assert.equal(executor.executeCalls, 1);
  assert.equal(executor.stopCalls, 0);
});

test("held cancellation runs during a pending Eve callback, before release and exactly once", async () => {
  const executor = new HeldNoMotionExecutor();
  const command = navigationCommand();
  const started = deferred<void>();
  const teardown = deferred<void>();
  const cancelled = deferred<ExecutorResult>();
  let execution!: Promise<ExecutorResult>;
  let eveReturned = false;
  const invocation = runG3ConcurrentInvocation(async () => {
    execution = executor.execute(command, new AbortController().signal);
    started.resolve();
    await teardown.promise;
    eveReturned = true;
    return command.executionId;
  }, async () => {
    await started.promise;
    assert.equal(executor.pendingCommand?.executionId, command.executionId);
    await executor.stop("observed generated cancellation (unit fixture)");
    cancelled.resolve(await execution);
    return command.executionId;
  });
  assert.equal((await cancelled.promise).outcome, "cancelled");
  assert.equal(eveReturned, false);
  assert.equal(executor.released, false);
  assert.equal(executor.stopCalls, 1);
  teardown.resolve();
  const joined = await invocation;
  assert.equal(joined.delivery, joined.observed);
  assert.equal(executor.executeCalls, 1);
});

test("pre-claim lifecycle cancels the observed Accepted row before starting its controller or joining Eve", async () => {
  const accepted = deferred<void>();
  const closed = deferred<void>();
  const teardown = deferred<void>();
  const events: string[] = [];
  // Pure lifecycle fixture, not claimed as generated-module cancellation proof.
  let state: "Accepted" | "Cancelling" | "Cancelled" | undefined;
  const invocation = runG3ConcurrentInvocation(async () => {
    state = "Accepted";
    events.push("accepted");
    accepted.resolve();
    await teardown.promise;
    events.push("eve-returned");
    return "observed-execution";
  }, async () => {
    await accepted.promise;
    assert.equal(state, "Accepted");
    state = "Cancelling";
    events.push("cancel-confirmed");
    assert.equal(state, "Cancelling");
    events.push("controller-started");
    state = "Cancelled";
    closed.resolve();
    return "observed-execution";
  });
  await closed.promise;
  assert.deepEqual(events, ["accepted", "cancel-confirmed", "controller-started"]);
  teardown.resolve();
  const joined = await invocation;
  assert.equal(joined.delivery, joined.observed);
  assert.equal(events.at(-1), "eve-returned");
});

test("an invocation failure aborts concurrent lifecycle work rather than allowing later effects", async () => {
  let lifecycleAborted = false;
  await assert.rejects(runG3ConcurrentInvocation(async () => { throw new Error("Eve command rejected"); }, async (signal) => {
    await new Promise<void>((done) => signal.addEventListener("abort", () => {
      lifecycleAborted = true;
      done();
    }, { once: true }));
    signal.throwIfAborted();
  }), /Eve command rejected/);
  assert.equal(lifecycleAborted, true);
});

test("release requires an installed pending token for the exact observed execution", async () => {
  const executor = new HeldNoMotionExecutor();
  const command = navigationCommand();
  assert.throws(() => executor.release(command.executionId), /matching pending/);
  const pending = executor.execute(command, new AbortController().signal);
  assert.throws(() => executor.release("another-execution"), /matching pending/);
  executor.release(command.executionId);
  assert.equal((await pending).outcome, "succeeded");
  assert.throws(() => executor.release(command.executionId), /matching pending/);
});

test("initial simulation pose uses fresh acquisition and the pinned frame without rebuilding a map", () => {
  const fixture = createSyntheticStandardFixture();
  const original = canonicalJson(fixture);
  const executor = new HeldNoMotionExecutor();
  const before = Date.now();
  const input = createG3StationarySimulationFixture(fixture, "g3-initial-unit-observation", executor.initialSimulationPose);
  const acquiredAt = Date.parse(input.samples[0]!.capturedAt);
  assert.ok(acquiredAt >= before && acquiredAt <= Date.now());
  assert.equal(input.observation.pose?.observedAt, input.samples[0]!.capturedAt);
  assert.equal(input.observation.pose?.frameId, fixture.spatialFrameId);
  assert.deepEqual(input.observation.pose?.value, executor.initialSimulationPose);
  assert.equal(input.observation.entityId, fixture.unitId);
  assert.equal(input.observation.localMapId, fixture.mapId);
  assert.equal(input.samples[0]!.sequence, 2n);
  assert.equal(input.observation.semantic, undefined);
  assert.equal(input.mapProduct, undefined);
  assert.equal(canonicalJson(fixture), original, "existing samples must not be retimestamped");
});

test("joined receipts must match the entire committed generated request even after transient Running is gone", () => {
  const command = navigationCommand();
  const at = Timestamp.fromDate(new Date());
  const row: Execution & { input: Extract<Execution["input"], { tag: "Navigate" }> } = {
    id: command.executionId, unitId: command.unitId, requestedBy: new Identity(7n), agentId: "g3-agent",
    missionId: "g3-mission", objectiveId: "located-object", missionRevision: 2n, assignmentRevision: 19n,
    requestFingerprint: "world-fingerprint", acceptBy: at,
    input: { tag: "Navigate", value: { mapId: command.mapId, basisRevision: 9_007_199_254_740_993n,
      targetFrameId: command.targetFrameId, target: command.targetPose } },
    binding: { executor: { name: "fake", version: "1", sha256: "a".repeat(64) },
      mode: { tag: "Simulation" }, maxRunMs: 10_000, maxEvidenceAgeMs: 120_000, maxLinearMps: 0.2, toleranceM: 0.1 },
    bindingVersion: 1n, targetVersion: 9_007_199_254_740_993n, claimedAt: at, targetFrameId: command.targetFrameId,
    targetBasisObservationId: undefined, state: { tag: "Succeeded" }, controller: new Identity(8n), controllerEpoch: 19n,
    createdAt: at, updatedAt: at, result: undefined, receiptId: "local-receipt", safeStateProof: undefined,
  };
  const receipt: ActionReceipt = {
    executionId: row.id, status: "accepted", requestFingerprint: "agent-fingerprint", unitId: row.unitId,
    missionId: row.missionId!, objectiveId: row.objectiveId!, acceptBy: at.toISOString(),
    step: { sessionId: "real-eve-session", turnId: "real-eve-turn", stepIndex: 3 },
    request: { executionId: row.id, unitId: row.unitId,
      assignment: { agentId: row.agentId!, revision: row.assignmentRevision! },
      missionLink: { missionId: row.missionId!, objectiveId: row.objectiveId!, expectedRevision: row.missionRevision! },
      input: row.input, bindingVersion: row.bindingVersion, targetVersion: row.targetVersion, acceptBy: row.acceptBy },
  };
  assert.doesNotThrow(() => assertG3ReceiptMatchesExecution(receipt, row));
  const parsed = JSON.parse(canonicalJson(receipt)) as ActionReceipt;
  assert.doesNotThrow(() => assertG3ReceiptMatchesExecution(parsed, row));
  for (const changed of [
    { ...row, id: "unrelated-execution" },
    { ...row, assignmentRevision: 20n },
    { ...row, missionRevision: 3n },
    { ...row, bindingVersion: 2n },
    { ...row, targetVersion: row.targetVersion + 1n },
    { ...row, acceptBy: Timestamp.fromDate(new Date(Date.now() + 1_000)) },
    { ...row, input: { tag: "Navigate" as const, value: { ...row.input.value, basisRevision: 4n } } },
  ]) {
    assert.throws(() => assertG3ReceiptMatchesExecution(parsed, changed), /identity\/body\/pins\/deadline/);
  }
});
