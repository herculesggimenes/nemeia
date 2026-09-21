import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { LocalController, FakeNoMotionExecutor } from "../local-controller/src/local-controller.ts";
import { GeneratedControllerSession } from "../local-controller/src/generated-controller-session.ts";
import { createSyntheticStandardFixture } from "../perception/src/index.ts";

export function newStationaryG2Observation(retained, { now = Date.now(), suffix = randomUUID() } = {}) {
  const capturedAt = new Date(now).toISOString();
  const fixture = createSyntheticStandardFixture({
    unitId: retained.unitId, producerId: retained.producerId, producerSession: retained.producerSession,
    sourceSessionId: retained.sourceSessionId, spatialFrameId: retained.spatialFrameId,
    localMapId: retained.localMapId, mapId: retained.mapId,
    capturedAt, receivedAt: capturedAt, mapCapturedAt: capturedAt,
  });
  return {
    samples: fixture.samples.map((sample) => ({ ...sample, sequence: BigInt(now) })),
    observation: { ...fixture.observation, id: `g2-initial-unit-${suffix}`, entityId: retained.unitId,
      trackId: `g2-initial-unit-track-${suffix}`, semantic: undefined,
      pose: { observedAt: capturedAt, frameId: retained.spatialFrameId,
        value: { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } } },
    mapProduct: undefined,
  };
}

async function confirm(read, predicate, description) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) throw new Error(`G2 simulation startup not confirmed: ${description}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

/** Fresh Simulation-only startup. No claim loop survives this function, and
 * no action proposal is submitted. World bootstrap still starts fail closed. */
export async function prepareG2Simulation({ controller, perception, agent, standardFixture, runDirectory }) {
  const unitId = standardFixture.unitId;
  const before = await controller.readSnapshot();
  if (!before.readiness.some((row) => row.mode === "simulation" && row.role === "controller" && row.unitId === unitId)) throw new Error("G2 startup requires an enrolled scoped Simulation controller");
  if (before.relevantExecutions.length !== 0) throw new Error("G2 initial startup requires a fresh fixture with zero executions");
  const control = before.relevantUnitControls.find((row) => row.unitId === unitId);
  const connection = controller.generatedConnection();
  if (!control || !connection.identity?.isEqual(control.controller) || control.activeExecutionId !== undefined) throw new Error("G2 initial startup requires its own unreserved controller identity");
  const executor = new FakeNoMotionExecutor();
  const ledgerPath = join(runDirectory, "g2-initial-controller.sqlite");
  const local = new LocalController({ path: ledgerPath, unitId, executor, initialEpoch: control.epoch });
  const diagnostics = [];
  const session = new GeneratedControllerSession({ connection, controller: local, unitId,
    diagnostics: (event) => diagnostics.push(event) });
  let armed;
  let receiptCount;
  try {
    await session.start(); // Public startup invokes the executor's proveSafeState and reportControl reducer.
    armed = await confirm(() => controller.readSnapshot(), (snapshot) => snapshot.relevantUnitControls.some((row) =>
      row.unitId === unitId && row.epoch === local.controllerEpoch && row.safeStateConfirmed && !row.stopLatched && row.activeExecutionId === undefined), "native control state");
    receiptCount = local.receipts().length;
    if (executor.executeCalls !== 0 || receiptCount !== 0 || armed.relevantExecutions.length !== 0) throw new Error("G2 startup unexpectedly observed an execution");
  } finally {
    // Stop callbacks before G2 may submit a request. The closed session ignores
    // subsequent generated row events; it cannot claim the G2 proposal.
    await session.stop();
    local.close();
  }
  const observation = newStationaryG2Observation(standardFixture);
  const published = await perception.ingestStandardSyntheticFixture(observation);
  const committed = await perception.callProcedure("readObservationDetail", { observationId: observation.observation.id });
  if (committed?.id !== observation.observation.id || committed.unitId !== unitId || !committed.recordedAt) throw new Error("G2 initial Unit observation did not commit through the gateway");
  const visible = await confirm(() => agent.readSnapshot(), (snapshot) =>
    snapshot.relevantUnitControls.some((row) => row.unitId === unitId && row.safeStateConfirmed && !row.stopLatched && row.activeExecutionId === undefined) &&
    snapshot.relevantPoses.some((row) => row.entityId === unitId && row.frameId === standardFixture.spatialFrameId && row.observationId === committed.id), "agent scoped control and new Unit pose");
  const checks = {
    simulationEnrolledController: true,
    actualControllerStartup: diagnostics.some((event) => event.name === "controller.stop_cleared") || armed.relevantUnitControls.some((row) => row.unitId === unitId && row.safeStateConfirmed && !row.stopLatched),
    controllerSessionStoppedBeforeG2: true,
    noExecuteOrActionReceipt: executor.executeCalls === 0 && receiptCount === 0 && visible.relevantExecutions.length === 0,
    agentSeesSafeUnlatchedUnreserved: visible.relevantUnitControls.some((row) => row.unitId === unitId && row.safeStateConfirmed && !row.stopLatched && row.activeExecutionId === undefined),
    gatewayCommittedNewUnitObservation: published.replay.accepted.length > 0 && committed.id === observation.observation.id,
    agentSeesNewUnitPose: visible.relevantPoses.some((row) => row.entityId === unitId && row.observationId === committed.id && row.frameId === standardFixture.spatialFrameId),
  };
  if (Object.values(checks).some((value) => !value)) throw new Error("G2 simulation preflight evidence failed");
  return { checks, ledgerPath, executeCalls: executor.executeCalls, receiptCount, initialControl: control,
    confirmedControl: visible.relevantUnitControls.find((row) => row.unitId === unitId),
    observationId: committed.id, recordedAt: committed.recordedAt, capturedAt: observation.observation.pose.observedAt,
    poseBasis: "explicit-new-stationary-no-motion-simulation-origin", frameId: standardFixture.spatialFrameId,
    resourceReferences: published.replay.accepted.map((sample) => sample.resource),
    retainedG1Acquisition: standardFixture.samples[0].capturedAt, diagnostics };
}
