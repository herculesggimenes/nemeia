import assert from "node:assert/strict";
import type { DbConnection } from "../../world-client/src/generated/index.ts";
import type { Execution } from "../../world-client/src/generated/types.ts";
import type { RequestExecutionParams } from "../../world-client/src/generated/types/reducers.ts";
import type { GeneratedControllerSession } from "../src/generated-controller-session.ts";

/**
 * Integration-only helpers. These deliberately accept a real generated
 * connection supplied by the loopback fixture; they do not emulate a module
 * or add an authentication/authorization checker.
 */
export async function expectActualModuleAdmissionRejects(
  connection: DbConnection,
  request: RequestExecutionParams,
): Promise<void> {
  await assert.rejects(() => connection.reducers.requestExecution(request));
}

export async function waitForActualExecution(
  connection: DbConnection,
  executionId: string,
  predicate: (row: Execution) => boolean = () => true,
  timeoutMs = 10_000,
): Promise<Execution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const row = connection.db.relevantExecutions.id.find(executionId);
    if (row && predicate(row)) return row;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`actual_module_execution_timeout:${executionId}`);
}

export async function waitForActualTerminalExecution(
  connection: DbConnection,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Execution> {
  return waitForActualExecution(connection, executionId, (row) =>
    row.state.tag === "Succeeded" || row.state.tag === "Cancelled" || row.state.tag === "Failed", timeoutMs);
}

/** Exercise Accepted -> Cancelling without claiming or executing the work. */
export async function cancelActualAcceptedBeforeClaim(
  connection: DbConnection,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Execution> {
  const row = await waitForActualExecution(connection, executionId, (candidate) => candidate.state.tag === "Accepted", timeoutMs);
  await connection.reducers.requestExecutionCancel({ executionId: row.id });
  return waitForActualTerminalExecution(connection, executionId, timeoutMs);
}

/** Exercise Running -> Cancelling against the actual module row while the host executor is live. */
export async function cancelActualRunningExecution(
  connection: DbConnection,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Execution> {
  const row = await waitForActualExecution(connection, executionId, (candidate) => candidate.state.tag === "Running", timeoutMs);
  await connection.reducers.requestExecutionCancel({ executionId: row.id });
  return waitForActualTerminalExecution(connection, executionId, timeoutMs);
}

/** Start the real session and await its scoped subscription before a good-path assertion. */
export async function runActualModuleGoodPath(
  session: GeneratedControllerSession,
  connection: DbConnection,
  executionId: string,
  timeoutMs = 10_000,
): Promise<Execution> {
  await session.start();
  return waitForActualTerminalExecution(connection, executionId, timeoutMs);
}
