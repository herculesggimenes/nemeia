import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Identity, Timestamp } from "spacetimedb";
import {
  FakeNoMotionExecutor,
  LocalController,
  LocalControllerError,
  PhysicalAdapterDisabledError,
  adaptAcceptedExecutionClaim,
  type ControllerCommand,
  type ExecutorResult,
  type GeneratedActionIntent,
  type NoMotionExecutor,
  normalizedGeneratedRequestDigest,
  stableReceiptId,
} from "../src/local-controller.ts";
import {
  adaptGeneratedExecutionClaim,
  type GeneratedAcceptedExecution,
} from "../src/generated-execution-adapter.ts";
import { GeneratedControllerSession } from "../src/generated-controller-session.ts";

function generatedNavigation(x = 1): GeneratedActionIntent {
  return {
    tag: "navigate",
    value: {
      mapId: "map-1",
      basisMapRevision: 7n,
      targetFrameId: "frame-local-1",
      targetPose: {
        positionM: { x, y: 2, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
  };
}

function fixtureCommand(epoch: bigint, options: { executionId?: string; input?: GeneratedActionIntent } = {}): ControllerCommand {
  const executionId = options.executionId ?? "exec-1";
  const input = options.input ?? generatedNavigation();
  return adaptAcceptedExecutionClaim({
    execution: {
      id: executionId,
      unitId: "unit-go2-sim",
      input,
      state: "accepted",
      binding: { policy: { mode: "simulation", maxRunMs: 30 } },
    },
    claim: { executionId, unitId: "unit-go2-sim", controllerEpoch: epoch },
  });
}

function tempDb(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-local-controller-"));
  return { dir, path: join(dir, "controller.sqlite") };
}

function closeTemp(controller: LocalController, dir: string): void {
  controller.close();
  rmSync(dir, { recursive: true, force: true });
}

test("canonical request digest ignores object key order and normalizes bigint/timestamps", async () => {
  const fixture = tempDb();
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const first = fixtureCommand(controller.controllerEpoch);
    const reordered = {
      ...first,
      normalizedRequest: { ...(first.normalizedRequest as Record<string, unknown>), value: {
        ...((first.normalizedRequest as Record<string, unknown>).value as Record<string, unknown>),
        targetPose: { ...(((first.normalizedRequest as Record<string, unknown>).value as Record<string, unknown>).targetPose as Record<string, unknown>),
          orientation: { w: 1, z: 0, y: 0, x: 0 } },
      } },
    } as ControllerCommand;
    const generated = generatedNavigation();
    const reorderedGenerated: GeneratedActionIntent = {
      tag: "navigate",
      value: {
        targetFrameId: generated.tag === "navigate" ? generated.value.targetFrameId : "",
        targetPose: generated.tag === "navigate" ? {
          orientation: { w: 1, z: 0, y: 0, x: 0 },
          positionM: generated.value.targetPose.positionM,
        } : { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        basisMapRevision: generated.tag === "navigate" ? generated.value.basisMapRevision : 0n,
        mapId: generated.tag === "navigate" ? generated.value.mapId : "",
      },
    };
    assert.equal(normalizedGeneratedRequestDigest(generated), normalizedGeneratedRequestDigest(reorderedGenerated));
    assert.equal(normalizedGeneratedRequestDigest(generated), first.requestDigest);
    assert.match(stableReceiptId(first.executionId, first.requestDigest), /^receipt:sha256:/);
    assert.equal(reordered.requestDigest, first.requestDigest);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("generated accepted execution adapter preserves the full request and takes fencing only from the claim", () => {
  const input: GeneratedActionIntent = {
    tag: "approach",
    value: {
      targetId: "entity-backpack",
      standoffM: 0.8,
      expectedGeometryVersion: 12n,
      bbox: { frameId: "frame-local-1", centerM: { x: 1, y: 2, z: 0.4 }, sizeM: { x: 0.4, y: 0.3, z: 0.5 } },
    },
  };
  const command = adaptAcceptedExecutionClaim({
    execution: {
      id: "exec-approach",
      unitId: "unit-go2-sim",
      input,
      state: "running",
      binding: { policy: { mode: "simulation", maxRunMs: 42 } },
    },
    claim: { executionId: "exec-approach", unitId: "unit-go2-sim", controllerEpoch: 99n },
  });
  assert.equal(command.kind, "approach@1");
  assert.equal(command.controllerEpoch, 99n);
  assert.equal(command.bindingPolicy.maxRunMs, 42);
  assert.equal(command.requestDigest, normalizedGeneratedRequestDigest(input));
  assert.equal((command.normalizedRequest as { value: { expectedGeometryVersion: string } }).value.expectedGeometryVersion, "12");
  assert.equal((command as Extract<ControllerCommand, { kind: "approach@1" }>).target.bbox?.frameId, "frame-local-1");
  assert.throws(() => adaptAcceptedExecutionClaim({
    execution: { id: "exec-approach", unitId: "unit-go2-sim", input, state: "running", binding: { policy: { mode: "physical", maxRunMs: 42 } } },
    claim: { executionId: "exec-approach", unitId: "unit-go2-sim", controllerEpoch: 99n },
  }), (error) => error instanceof PhysicalAdapterDisabledError);
});

test("canonical generated execution row adapter maps tagged bindings and claim epoch", () => {
  const execution = {
    id: "exec-generated",
    unitId: "unit-go2-sim",
    input: {
      tag: "Navigate",
      value: {
        mapId: "map-1",
        basisRevision: 7n,
        targetFrameId: "frame-local-1",
        target: {
          positionM: { x: 1, y: 2, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
    },
    state: { tag: "Running" },
    binding: {
      executor: { name: "fake-no-motion", version: "1.0.0", sha256: "a".repeat(64) },
      mode: { tag: "Simulation" },
      maxEvidenceAgeMs: 500,
      maxLinearMps: 0.5,
      maxRunMs: 25,
      toleranceM: 0.05,
    },
  } as GeneratedAcceptedExecution;
  const command = adaptGeneratedExecutionClaim({
    execution,
    claim: { executionId: execution.id, unitId: execution.unitId, controllerEpoch: 17n },
  });
  assert.equal(command.kind, "navigate@1");
  assert.equal(command.controllerEpoch, 17n);
  assert.equal(command.bindingPolicy.maxEvidenceAgeMs, 500);
  assert.equal(command.bindingPolicy.executor?.name, "fake-no-motion");
  assert.equal(command.mapId, "map-1");
  assert.equal(command.basisMapRevision, 7n);
});

test("fake no-motion executor admits once, reserves one Unit, and returns a durable receipt", async () => {
  const fixture = tempDb();
  const executor = new FakeNoMotionExecutor();
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const command = fixtureCommand(controller.controllerEpoch);
    const receipt = await controller.start(command);
    assert.equal(receipt.outcome, "succeeded");
    assert.equal(receipt.safeState, "confirmed");
    assert.equal(receipt.completion?.action, "navigate@1");
    assert.deepEqual(receipt.normalizedRequest, command.normalizedRequest);
    assert.equal(receipt.bindingPolicy.maxRunMs, 30);
    assert.equal(executor.executeCalls, 1);
    assert.deepEqual(controller.status(), {
      unitId: "unit-go2-sim",
      controllerEpoch: controller.controllerEpoch,
      stopLatched: false,
      safeState: "confirmed",
    });

    const retry = await controller.start(command);
    assert.equal(retry.id, receipt.id);
    assert.equal(executor.executeCalls, 1);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("same execution ID with a changed typed request conflicts", async () => {
  const fixture = tempDb();
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const command = fixtureCommand(controller.controllerEpoch);
    await controller.start(command);
    const changed = fixtureCommand(controller.controllerEpoch, { input: generatedNavigation(1.1) });
    await assert.rejects(() => controller.start(changed), (error) => error instanceof LocalControllerError && error.code === "idempotency_conflict");
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("restart fences the old epoch and preserves an unknown crash receipt without repeating effect", async () => {
  const fixture = tempDb();
  class CrashExecutor implements NoMotionExecutor {
    readonly kind = "fake-no-motion" as const;
    executeCalls = 0;
    async execute(_command: ControllerCommand, _signal: AbortSignal): Promise<ExecutorResult> {
      this.executeCalls += 1;
      throw new Error("simulated process loss after admission");
    }
    async stop(): Promise<{ safeState: "unknown" }> { return { safeState: "unknown" }; }
    async proveSafeState(): Promise<{ safeState: "confirmed" }> { return { safeState: "confirmed" }; }
  }
  const crashExecutor = new CrashExecutor();
  const first = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor: crashExecutor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  const oldEpoch = first.controllerEpoch;
  try {
    await first.clearStop();
    const command = fixtureCommand(oldEpoch);
    const receipt = await first.start(command);
    assert.equal(receipt.outcome, "unknown");
    assert.equal(receipt.safeState, "unknown");
    assert.equal(crashExecutor.executeCalls, 1);
    first.close();

    const restartedExecutor = new FakeNoMotionExecutor();
    const second = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor: restartedExecutor, clock: () => new Date("2026-09-20T19:00:01.000Z") });
    try {
      assert.equal(second.controllerEpoch, oldEpoch + 1n);
      assert.equal(second.reconcile(command.executionId).id, receipt.id);
      await assert.rejects(() => second.start(command), (error) => error instanceof LocalControllerError && error.code === "fenced");
      const recovered = second.reconcile(command.executionId, {
        outcome: "failed",
        safeState: "confirmed",
        source: "executor",
        completion: {
          action: "navigate@1",
          outcome: "failed",
          localReceiptId: receipt.id,
          safeClosureReceiptId: receipt.id,
          detail: "reconciled after crash with no physical effect",
        },
      });
      assert.equal(recovered.outcome, "failed");
      assert.equal(restartedExecutor.executeCalls, 0);
      assert.equal(second.status().activeExecutionId, undefined);
    } finally {
      second.close();
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("local stop is independent of world access and retains reservation when safe closure is unknown", async () => {
  const fixture = tempDb();
  class UnknownStopExecutor extends FakeNoMotionExecutor {
    async execute(_command: ControllerCommand, _signal: AbortSignal): Promise<ExecutorResult> {
      return { outcome: "unknown", safeState: "unknown", effect: "none" };
    }
    async stop(): Promise<{ safeState: "unknown" }> {
      this.stopCalls += 1;
      return { safeState: "unknown" };
    }
  }
  const executor = new UnknownStopExecutor();
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const receipt = await controller.start(fixtureCommand(controller.controllerEpoch));
    assert.equal(receipt.outcome, "unknown");
    const stopped = await controller.stop("world-outage");
    assert.equal(stopped?.outcome, "unknown");
    assert.equal(controller.status().activeExecutionId, "exec-1");
    assert.equal(controller.status().safeState, "unknown");
    assert.equal(executor.stopCalls, 1);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("accepted work can be durably cancelled before claim without invoking the executor", async () => {
  const fixture = tempDb();
  const executor = new FakeNoMotionExecutor();
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    await controller.stop("cancel-before-claim");
    const command = fixtureCommand(controller.controllerEpoch);
    const receipt = controller.recordNotStartedCancellation(command);
    assert.equal(receipt.outcome, "cancelled");
    assert.equal(receipt.safeState, "confirmed");
    assert.equal(receipt.cancellationRequested, true);
    assert.equal(executor.executeCalls, 0);
    assert.equal(controller.status().activeExecutionId, undefined);
    assert.equal(controller.status().safeState, "confirmed");
    assert.equal(controller.recordNotStartedCancellation(command).id, receipt.id);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("cancellation interrupts a held executor before its promise resolves and stops once", async () => {
  const fixture = tempDb();
  let markStarted!: () => void;
  let release!: (result: ExecutorResult) => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const executor: NoMotionExecutor & { executeCalls: number; stopCalls: number } = {
    kind: "fake-no-motion",
    executeCalls: 0,
    stopCalls: 0,
    execute: async () => {
      executor.executeCalls += 1;
      markStarted();
      return new Promise<ExecutorResult>((resolve) => { release = resolve; });
    },
    stop: async () => {
      executor.stopCalls += 1;
      return { safeState: "confirmed" };
    },
    proveSafeState: async () => ({ safeState: "confirmed" }),
  };
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const command = fixtureCommand(controller.controllerEpoch);
    let startResolved = false;
    const start = controller.start(command).then((receipt) => {
      startResolved = true;
      return receipt;
    });
    await started;
    const cancelled = await controller.cancel(command.executionId);
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(cancelled.safeState, "confirmed");
    assert.equal(executor.executeCalls, 1);
    assert.equal(executor.stopCalls, 1);
    assert.equal(startResolved, false);
    release({ outcome: "succeeded", safeState: "confirmed", effect: "none", completion: { action: "navigate@1", outcome: "succeeded", localReceiptId: cancelled.id } });
    const late = await start;
    assert.equal(late.id, cancelled.id);
    assert.equal(late.outcome, "cancelled");
    assert.equal(executor.stopCalls, 1);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("cancellation wins while a late success remains recorded as a fact", async () => {
  const fixture = tempDb();
  let release!: (result: ExecutorResult) => void;
  const executor: NoMotionExecutor = {
    kind: "fake-no-motion",
    execute: () => new Promise<ExecutorResult>((resolve) => { release = resolve; }),
    stop: async () => ({ safeState: "unknown" }),
    proveSafeState: async () => ({ safeState: "confirmed" }),
  };
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const command = fixtureCommand(controller.controllerEpoch);
    const pending = controller.start(command);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cancelled = await controller.cancel("exec-1");
    assert.equal(cancelled.outcome, "unknown");
    assert.equal(controller.status().activeExecutionId, "exec-1");
    release({
      outcome: "succeeded",
      safeState: "confirmed",
      effect: "none",
      completion: {
        action: "navigate@1",
        outcome: "succeeded",
        finalPose: command.kind === "navigate@1" ? {
          frameId: command.targetFrameId,
          mapId: command.mapId,
          basisMapRevision: command.basisMapRevision,
          targetPose: command.targetPose,
        } : undefined,
        localReceiptId: cancelled.id,
        safeClosureReceiptId: cancelled.id,
      },
    });
    const late = await pending;
    assert.equal(late.outcome, "cancelled");
    assert.equal(late.lateFacts.at(-1)?.outcome, "succeeded");
    assert.equal(controller.status().activeExecutionId, undefined);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("unknown cancellation stays unresolved across restart until a confirmed local safe receipt", async () => {
  const fixture = tempDb();
  const executor: NoMotionExecutor = {
    kind: "fake-no-motion",
    execute: async () => ({ outcome: "unknown", safeState: "unknown", effect: "none" }),
    stop: async () => ({ safeState: "unknown" }),
    proveSafeState: async () => ({ safeState: "confirmed" }),
  };
  const first = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  const command = fixtureCommand(first.controllerEpoch);
  try {
    await first.clearStop();
    const started = await first.start(command);
    assert.equal(started.outcome, "unknown");
    const unresolved = await first.cancel(command.executionId);
    assert.equal(unresolved.outcome, "unknown");
    assert.equal(unresolved.cancellationRequested, true);
    assert.equal(first.status().activeExecutionId, command.executionId);
    first.close();

    const restarted = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:01.000Z") });
    try {
      assert.equal(restarted.reconcile(command.executionId).outcome, "unknown");
      const closed = restarted.reconcile(command.executionId, {
        outcome: "succeeded",
        safeState: "confirmed",
        source: "executor",
        safeStateProof: { receiptId: "safe-closure-2", observedAt: new Date("2026-09-20T19:00:02.000Z"), producer: "fake-no-motion", state: "confirmed" },
        completion: {
          action: "navigate@1",
          outcome: "succeeded",
          localReceiptId: started.id,
          safeClosureReceiptId: "safe-closure-2",
        },
      });
      assert.equal(closed.outcome, "cancelled");
      assert.equal(closed.safeState, "confirmed");
      assert.equal(closed.lateFacts.at(-1)?.outcome, "succeeded");
      const terminalLate = restarted.reconcile(command.executionId, {
        outcome: "failed",
        safeState: "unknown",
        source: "late-receipt",
      });
      assert.equal(terminalLate.outcome, "cancelled");
      assert.equal(terminalLate.lateFacts.length, 2);
      assert.equal(restarted.status().activeExecutionId, undefined);
      assert.equal(restarted.status().activeExecutionId, undefined);
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("watchdog stops independently and reports a failed safe closure", async () => {
  const fixture = tempDb();
  const executor: NoMotionExecutor = {
    kind: "fake-no-motion",
    execute: (_intent, signal) => new Promise<ExecutorResult>((resolve) => {
      signal.addEventListener("abort", () => resolve({ outcome: "failed", safeState: "confirmed", effect: "none" }), { once: true });
    }),
    stop: async () => ({ safeState: "confirmed" }),
    proveSafeState: async () => ({ safeState: "confirmed" }),
  };
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, maxRunMs: 10, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const receipt = await controller.start(fixtureCommand(controller.controllerEpoch));
    assert.equal(receipt.outcome, "failed");
    assert.equal(receipt.safeState, "confirmed");
    assert.equal(controller.status().activeExecutionId, undefined);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("operator reconciliation requires a measured local safe-state proof", async () => {
  const fixture = tempDb();
  const executor: NoMotionExecutor = {
    kind: "fake-no-motion",
    execute: async () => ({ outcome: "unknown", safeState: "unknown", effect: "none" }),
    stop: async () => ({ safeState: "unknown" }),
    proveSafeState: async () => ({ safeState: "confirmed" }),
  };
  const controller = new LocalController({ path: fixture.path, unitId: "unit-go2-sim", executor, clock: () => new Date("2026-09-20T19:00:00.000Z") });
  try {
    await controller.clearStop();
    const command = fixtureCommand(controller.controllerEpoch);
    const receipt = await controller.start(command);
    assert.throws(() => controller.reconcile(command.executionId, {
      outcome: "failed",
      safeState: "confirmed",
      source: "operator",
      completion: { action: "navigate@1", outcome: "failed", localReceiptId: receipt.id },
    }), (error) => error instanceof LocalControllerError && error.code === "safe_state_proof_required");
    const reconciled = controller.reconcile(command.executionId, {
      outcome: "failed",
      safeState: "confirmed",
      source: "operator",
      safeStateProof: { receiptId: "safe-proof-1", observedAt: new Date("2026-09-20T19:00:01.000Z"), producer: "fake-no-motion", state: "confirmed" },
      completion: { action: "navigate@1", outcome: "failed", localReceiptId: receipt.id, safeClosureReceiptId: "safe-proof-1" },
    });
    assert.equal(reconciled.outcome, "failed");
    assert.equal(controller.status().activeExecutionId, undefined);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("default physical adapter is disabled and diagnostics cannot affect safety", async () => {
  const fixture = tempDb();
  const events: string[] = [];
  const controller = new LocalController({
    path: fixture.path,
    unitId: "unit-go2-sim",
    diagnostics: () => { events.push("seen"); throw new Error("diagnostics down"); },
    clock: () => new Date("2026-09-20T19:00:00.000Z"),
  });
  try {
    await controller.clearStop();
    const receipt = await controller.start(fixtureCommand(controller.controllerEpoch));
    assert.equal(receipt.outcome, "succeeded");
    assert.ok(events.length > 0);
  } finally {
    closeTemp(controller, fixture.dir);
  }
});

test("generated session obtains safe proof before reporting control and finishing", async () => {
  const fixture = tempDb();
  const controllerIdentity = new Identity(91n);
  const at = Timestamp.fromDate(new Date("2026-09-20T19:00:00.000Z"));
  const executionId = "generated-ordering-execution";
  const row: any = {
    id: executionId,
    requestedBy: controllerIdentity,
    agentId: "agent-g3",
    unitId: "unit-go2-sim",
    missionId: "mission-g3",
    objectiveId: "located-object",
    missionRevision: 1n,
    assignmentRevision: 1n,
    requestFingerprint: normalizedGeneratedRequestDigest({
      tag: "navigate",
      value: {
        mapId: "map-g3",
        basisMapRevision: 1n,
        targetFrameId: "frame-g3",
        targetPose: { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      },
    }),
    acceptBy: at,
    input: {
      tag: "Navigate",
      value: {
        mapId: "map-g3",
        basisRevision: 1n,
        targetFrameId: "frame-g3",
        target: { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      },
    },
    binding: {
      executor: { name: "fake-no-motion", version: "1", sha256: "a".repeat(64) },
      mode: { tag: "Simulation" },
      maxEvidenceAgeMs: 120_000,
      maxLinearMps: 0.2,
      maxRunMs: 10_000,
      toleranceM: 0.1,
    },
    bindingVersion: 1n,
    targetVersion: 1n,
    claimedAt: undefined,
    targetFrameId: "frame-g3",
    targetBasisObservationId: "basis-g3",
    state: { tag: "Accepted" },
    controller: undefined,
    controllerEpoch: undefined,
    createdAt: at,
    updatedAt: at,
    result: undefined,
    receiptId: undefined,
    safeStateProof: undefined,
  };
  const control = {
    unitId: "unit-go2-sim",
    controller: controllerIdentity,
    epoch: 0n,
    activeExecutionId: undefined as string | undefined,
    stopLatched: true,
    safeStateConfirmed: false,
    observedAt: at,
  };
  const inserts: Array<(context: unknown, value: typeof row) => void> = [];
  const updates: Array<(context: unknown, oldValue: typeof row, value: typeof row) => void> = [];
  const executionTable = {
    *[Symbol.iterator](): IterableIterator<typeof row> { yield row; },
    id: { find: (id: string): typeof row | null => id === row.id ? row : null },
    onInsert: (listener: (context: unknown, value: typeof row) => void): void => { inserts.push(listener); },
    onUpdate: (listener: (context: unknown, oldValue: typeof row, value: typeof row) => void): void => { updates.push(listener); },
  };
  const order: string[] = [];
  const diagnostics: string[] = [];
  const emitUpdate = (): void => {
    for (const listener of updates) listener({}, row, row);
  };
  let applied!: () => void;
  const subscriptionBuilder = {
    onApplied: (listener: () => void) => { applied = listener; return subscriptionBuilder; },
    onError: (_listener: (context: unknown) => void) => subscriptionBuilder,
    subscribe: () => ({ isEnded: () => false, unsubscribe: () => undefined }),
  };
  const connection = {
    isActive: true,
    identity: controllerIdentity,
    db: {
      relevantExecutions: executionTable,
      relevantUnitControls: { unitId: { find: (id: string) => id === control.unitId ? control : null } },
    },
    subscriptionBuilder: () => subscriptionBuilder,
    reducers: {
      claimExecution: async () => {
        row.state = { tag: "Running" };
        row.controller = controllerIdentity;
        row.controllerEpoch = control.epoch;
        row.claimedAt = at;
        emitUpdate();
      },
      reportControl: async (input: { readonly stopLatched: boolean; readonly safeStateConfirmed: boolean; readonly epoch: bigint }) => {
        order.push("report");
        control.stopLatched = input.stopLatched;
        control.safeStateConfirmed = input.safeStateConfirmed;
        control.epoch = input.epoch;
        control.observedAt = Timestamp.fromDate(new Date());
      },
      finishExecution: async (input: { readonly result: unknown; readonly safeProof: unknown }) => {
        order.push("finish");
        row.result = input.result;
        row.safeStateProof = input.safeProof;
        row.state = { tag: "Succeeded" };
        emitUpdate();
      },
      requestExecutionCancel: async () => undefined,
      reconcileExecution: async () => undefined,
    },
  } as unknown as ConstructorParameters<typeof GeneratedControllerSession>[0]["connection"];
  const local = new LocalController({ path: fixture.path, unitId: control.unitId });
  const session = new GeneratedControllerSession({
    connection,
    controller: local,
    unitId: control.unitId,
    resultFor: async (_execution, receipt) => {
      order.push("result");
      return {
        tag: "Succeeded",
        value: { completion: { tag: "Navigate", value: { unitObservationId: "pose-after-claim", localReceiptId: receipt.id } } },
      };
    },
    safeProofFor: async (execution) => {
      order.push("proof");
      return { executionId: execution.id, unitId: execution.unitId, controllerEpoch: execution.controllerEpoch!, observationId: "pose-safe", observedAt: Timestamp.fromDate(new Date()) };
    },
    diagnostics: (event) => { diagnostics.push(`${event.name}:${event.fields?.detail ?? ""}`); },
  });
  try {
    const started = session.start();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    applied();
    await started;
    const deadline = Date.now() + 2_000;
    while (!order.includes("finish") && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 5));
    const proofIndex = order.indexOf("proof");
    assert.deepEqual(order.slice(proofIndex, proofIndex + 4), ["proof", "report", "result", "finish"], diagnostics.join(","));
  } finally {
    await session.stop();
    local.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
