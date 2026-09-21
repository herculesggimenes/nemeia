import { readFile, writeFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { register } from "node:module";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Timestamp } from "spacetimedb";
import { canonicalJson } from "../world-client/src/json.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
register(pathToFileURL(join(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const [executionId, directoryArgument] = process.argv.slice(2);
const handoff = JSON.parse(await readFile(join(root, ".artifacts/qualification/current-handoff.json"), "utf8"));
const attemptDirectory = resolve(directoryArgument ?? "missing");
if (!executionId || !handoff.available || new URL(handoff.uri).hostname !== "127.0.0.1" ||
    !attemptDirectory.startsWith(resolve(handoff.runDirectory) + sep + "g3-attempt-")) {
  throw new Error("recovery requires an explicit execution and retained G3 attempt under this held loopback run");
}
const adapters = [];
let local;
async function privateBytes(pathname) {
  if (((await stat(pathname)).mode & 0o777) !== 0o600) throw new Error("private credential file required");
  return readFile(pathname);
}
async function waitFor(read, predicate, label) {
  const end = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() > end) throw new Error(`recovery confirmation timed out: ${label}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
try {
  const { createLoopbackAdapter } = await import("../conformance/src/loopback-adapter.ts");
  const connect = async (tokenFile) => {
    await privateBytes(tokenFile);
    const adapter = await createLoopbackAdapter({ modulePath: join(handoff.runDirectory, "generated-module-bindings"),
      uri: handoff.uri, databaseName: handoff.databaseName, scopedIdentityFile: tokenFile });
    adapters.push(adapter); await adapter.start(); return adapter;
  };
  const operator = await connect(handoff.operatorTokenFile);
  const controller = await connect(handoff.controllerTokenFile);
  const perception = await connect(handoff.perceptionTokenFile);
  const before = await controller.readSnapshot();
  const execution = before.relevantExecutions.find((row) => row.id === executionId);
  if (!before.readiness.some((row) => row.mode === "simulation") || !execution?.missionId?.startsWith("g3-mission-") ||
      execution.unitId !== handoff.unitId || execution.binding.mode.tag !== "Simulation" || execution.input.tag !== "Navigate" ||
      !execution.claimedAt || !["Running", "Cancelling"].includes(execution.state.tag)) throw new Error("not the selected claimed Simulation execution");
  const ledgerPath = join(attemptDirectory, `controller-${handoff.unitId}.sqlite`);
  const ledger = new DatabaseSync(ledgerPath, { readOnly: true });
  const previousReceipt = ledger.prepare("SELECT * FROM execution_receipts WHERE execution_id = ?").get(executionId);
  ledger.close();
  if (previousReceipt?.outcome !== "failed" || previousReceipt.safe_state !== "confirmed") throw new Error("retained failed safe receipt required; no replacement receipt will be fabricated");
  const failedReport = await readFile(join(handoff.runDirectory, "../qualification/g3-loopback.json"));
  try { await writeFile(join(attemptDirectory, "g3-failure.json"), failedReport, { mode: 0o600, flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const { LocalController, FakeNoMotionExecutor } = await import("../local-controller/src/local-controller.ts");
  const executor = new FakeNoMotionExecutor();
  local = new LocalController({ path: ledgerPath, unitId: handoff.unitId, executor });
  const receipt = local.receipt(executionId);
  if (receipt?.id !== previousReceipt.receipt_id || receipt.outcome !== "failed") throw new Error("reopened receipt changed identity/outcome");
  const epoch = local.status().controllerEpoch;
  const mission = (await operator.readSnapshot()).assignedMissions.find((row) => row.id === execution.missionId);
  if (mission?.state.tag === "Active") await operator.callReducer("cancelMission", { missionId: mission.id, expectedRevision: mission.revision });
  await controller.callReducer("requestExecutionCancel", { executionId });
  await local.stop("retained_failed_g3_recovery");
  if (local.status().safeState !== "confirmed") throw new Error("no-motion stop is not confirmed");
  await controller.callReducer("reportControl", { unitId: handoff.unitId, epoch, stopLatched: true, safeStateConfirmed: true });
  await controller.callReducer("reconcileExecution", { executionId, expectedEpoch: epoch });
  const reconciled = await waitFor(async () => (await controller.readSnapshot()).relevantExecutions.find((row) => row.id === executionId),
    (row) => row?.state.tag === "Cancelling" && row.controllerEpoch === epoch, "reconciled epoch");

  const { ResourceGateway } = await import("../world-resources/src/index.ts");
  const { createSyntheticStandardFixture } = await import("../perception/src/index.ts");
  const now = new Date().toISOString();
  const frameId = execution.targetFrameId ?? execution.input.value.targetFrameId;
  const mapId = execution.input.value.mapId;
  const fixture = createSyntheticStandardFixture({ unitId: handoff.unitId, spatialFrameId: frameId, localMapId: mapId, mapId,
    capturedAt: now, receivedAt: now, mapCapturedAt: now });
  const credential = new Uint8Array(await privateBytes(join(handoff.runDirectory, "credentials/replay-producer.credential")));
  const gateway = await ResourceGateway.open({ root: handoff.resourceRoot, bindings: [{ bindingId: "replay-binding-001",
    producerId: fixture.producerId, producerSession: fixture.producerSession, unitId: handoff.unitId,
    package: fixture.mapProduct.producer, credential,
    allowedSchemas: ["image/png", "text/x.pcd", "application/json", "nemeia/native-map-manifest@1", "nemeia/native-map-evidence-index@1"],
    referenceCommitAdapter: { commitPublishedReferences: (request) => perception.commitPublishedReferences(request) } }] });
  perception.attachResourceGateway({ gateway, session: gateway.authenticateWorker({ bindingId: "replay-binding-001", credential }),
    reader: gateway.createReader({ authorizeRead: () => true }) });
  const poses = (await perception.readSnapshot()).relevantPoses.filter((row) => row.entityId === handoff.unitId && row.frameId === frameId);
  const existingPose = poses.sort((a, b) => a.version < b.version ? -1 : a.version > b.version ? 1 : 0).at(-1);
  // Explicitly authorized fake initial state: the held no-motion executor was
  // never released and has no physical actuator. Never use the requested target.
  const pose = existingPose?.value ?? { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
  const suffix = randomUUID(), observationId = `g3-recovery-stop-${suffix}`;
  await perception.ingestStandardSyntheticFixture({ samples: fixture.samples.map((sample) => ({ ...sample, sequence: BigInt(Date.now()) })),
    observation: { ...fixture.observation, id: observationId, entityId: handoff.unitId, trackId: `g3-recovery-track-${suffix}`,
      pose: { observedAt: now, frameId, value: pose }, semantic: { observedAt: now, frameId,
        value: { hypotheses: [{ label: "synthetic-no-motion-stationary-stop", score: 1 }] } } }, mapProduct: undefined });
  const observation = await perception.callProcedure("readObservationDetail", { observationId });
  if (observation?.id !== observationId || observation.unitId !== handoff.unitId) throw new Error("fresh safety observation was not committed");
  await local.stop("post_commit_failed_g3_stop_attestation");
  if (local.status().safeState !== "confirmed") throw new Error("post-commit stop is not confirmed");
  const observedAt = await waitFor(async () => new Timestamp(BigInt(Date.now()) * 1000n),
    (time) => time.microsSinceUnixEpoch > reconciled.updatedAt.microsSinceUnixEpoch && time.microsSinceUnixEpoch >= observation.recordedAt.microsSinceUnixEpoch,
    "actual wall-clock proof time");
  await controller.callReducer("reportControl", { unitId: handoff.unitId, epoch, stopLatched: true, safeStateConfirmed: true });
  await controller.callReducer("finishExecution", { executionId, controllerEpoch: epoch,
    result: { tag: "Failed", value: { code: "local_controller_failed", detail: "retained failed no-motion receipt; no successful completion measurement", localReceiptId: receipt.id } },
    safeProof: { executionId, unitId: handoff.unitId, controllerEpoch: epoch, observationId, observedAt } });
  const terminal = await waitFor(async () => (await controller.readSnapshot()).relevantExecutions.find((row) => row.id === executionId),
    (row) => row?.state.tag === "Cancelled" && row.result?.tag === "Failed", "terminal failed receipt with cancellation precedence");
  await operator.callReducer("reconcileMission", { missionId: execution.missionId });
  const finalSnapshot = await operator.readSnapshot();
  const finalMission = finalSnapshot.assignedMissions.find((row) => row.id === execution.missionId);
  const control = finalSnapshot.relevantUnitControls.find((row) => row.unitId === handoff.unitId);
  const checks = { retainedFailedReceipt: terminal.receiptId === receipt.id && local.receipt(executionId)?.outcome === "failed",
    epochAdvanced: epoch > BigInt(previousReceipt.controller_epoch), terminalExecution: terminal.state.tag === "Cancelled",
    missionCancelled: finalMission?.state.tag === "Cancelled", noActiveReservation: control?.activeExecutionId === undefined,
    stopConfirmedAndLatched: control?.stopLatched === true && control.safeStateConfirmed === true, noExecute: executor.executeCalls === 0,
    freshProof: observedAt.microsSinceUnixEpoch > reconciled.updatedAt.microsSinceUnixEpoch &&
      observedAt.microsSinceUnixEpoch >= observation.recordedAt.microsSinceUnixEpoch && observedAt.microsSinceUnixEpoch <= terminal.updatedAt.microsSinceUnixEpoch };
  const reportPath = join(attemptDirectory, `recovery-${Date.now()}.json`);
  await writeFile(reportPath, `${canonicalJson({ checks, before: execution, previousReceipt, terminal, control, mission: finalMission,
    observation, proofObservedAt: observedAt, reconciledUpdatedAt: reconciled.updatedAt, acquiredAt: now,
    stationaryPoseBasis: existingPose ? "retained-stationary-simulation-pose" : "explicit-fake-initial-origin-never-released",
    executorCalls: executor.executeCalls, stopCalls: executor.stopCalls, ledgerPath })}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ checks, executionId, state: terminal.state.tag, result: terminal.result.tag, epoch: String(epoch),
    receiptId: terminal.receiptId, missionState: finalMission?.state.tag, reportPath }));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 2;
} catch (error) {
  console.error(`retained G3 recovery failed: ${error.message}`); process.exitCode = 2;
} finally {
  local?.close();
  for (const adapter of adapters) await adapter.close().catch(() => {});
}
