import { join } from "node:path";
import type { Timestamp } from "spacetimedb";
import type { DbConnection } from "../../world-client/src/generated/index.ts";
import type { Execution } from "../../world-client/src/generated/types.ts";
import { FakeNoMotionExecutor, LocalController, type LocalReceipt, type ExecutorResult } from "../../local-controller/src/local-controller.ts";
import { GeneratedControllerSession } from "../../local-controller/src/generated-controller-session.ts";
import { adaptGeneratedExecutionCancellation } from "../../local-controller/src/generated-execution-adapter.ts";

/** Close explicitly selected, never-claimed simulation requests after their
 * owner requests cancellation. Not part of the measured G3 scenario. */
export async function closeUnclaimedCancellations(options: {
  connection: DbConnection;
  unitId: string;
  executionIds: readonly string[];
  runDirectory: string;
  publishStopObservation: (execution: Execution, receipt: LocalReceipt, attestStopped: () => Promise<void>) => Promise<{ observationId: string; observedAt: Timestamp }>;
}) {
  const selected = new Set(options.executionIds);
  const active = [...options.connection.db.relevantExecutions].filter((row) => row.unitId === options.unitId &&
    !["Succeeded", "Failed", "Cancelled"].includes(row.state.tag));
  if (active.length !== selected.size || active.some((row) => !selected.has(row.id) ||
    row.state.tag !== "Cancelling" || row.claimedAt !== undefined || row.binding.mode.tag !== "Simulation" ||
    (row.controller !== undefined && !options.connection.identity?.isEqual(row.controller)))) {
    throw new Error("cancellation cleanup requires exactly the selected unclaimed Simulation rows; no other active execution is allowed");
  }
  const control = options.connection.db.relevantUnitControls.unitId.find(options.unitId);
  if (!control || !options.connection.identity?.isEqual(control.controller)) throw new Error("scoped controller control row required");
  class StopOnlyExecutor extends FakeNoMotionExecutor {
    override async execute(): Promise<ExecutorResult> {
      this.executeCalls += 1;
      throw new Error("cleanup executor must never execute an intent");
    }
  }
  const executor = new StopOnlyExecutor();
  const controller = new LocalController({ path: join(options.runDirectory, "g2-cancellation-controller.sqlite"),
    unitId: options.unitId, initialEpoch: control.epoch, executor });
  const diagnostics: string[] = [];
  const session = new GeneratedControllerSession({
    connection: options.connection, controller, unitId: options.unitId,
    safeProofFor: async (execution, receipt) => {
      if (!selected.has(execution.id) || receipt.outcome !== "cancelled" || receipt.safeState !== "confirmed" || execution.controllerEpoch === undefined) {
        throw new Error("unexpected cleanup receipt");
      }
      const proof = await options.publishStopObservation(execution, receipt, async () => {
        await controller.stop("g2_post_commit_stop_attestation");
        if (controller.status().safeState !== "confirmed") throw new Error("post-commit no-motion stop is not confirmed");
      });
      return { ...proof, executionId: execution.id, unitId: execution.unitId, controllerEpoch: execution.controllerEpoch };
    },
    diagnostics: (event) => { if (event.name.includes("error") || event.name.includes("failed")) diagnostics.push(`${event.name}:${event.fields?.detail ?? "unknown"}`); },
  });
  try {
    // Reconciliation may already have installed an epoch without a claim.
    // A never-started cancellation is durable before the generated session
    // resumes it; no accepted intent is handed to LocalController.start.
    await controller.stop("g2_unclaimed_cancellation_cleanup");
    if (controller.status().safeState !== "confirmed") throw new Error("no-motion cleanup stop was not confirmed");
    for (const row of active) controller.recordNotStartedCancellation(adaptGeneratedExecutionCancellation({
      execution: row, controllerEpoch: controller.status().controllerEpoch,
    }));
    await session.start();
    const deadline = Date.now() + 15_000;
    while ([...selected].some((id) => options.connection.db.relevantExecutions.id.find(id)?.state.tag !== "Cancelled")) {
      if (Date.now() > deadline) throw new Error(`cancellation cleanup did not reach terminal rows: ${diagnostics.join("; ")}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    if (executor.executeCalls !== 0) throw new Error("cleanup attempted to execute a prior intent");
    return { executionIds: [...selected], executeCalls: executor.executeCalls, stopCalls: executor.stopCalls,
      allCancelled: true, receipts: controller.receipts(), diagnostics };
  } finally {
    await session.stop();
    controller.close();
  }
}
