import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createSyntheticStandardFixture } from "../perception/src/index.ts";
import { closeUnclaimedCancellations } from "../conformance/src/close-unclaimed-cancellations.ts";
import { assertNoPendingExecutions } from "./composition-guards.mjs";
import { Timestamp } from "spacetimedb";

// Called only after G2 releases this run's mutation window. It is deliberately
// separate from G3's measured executions and contributes no G3 passing checks.
export async function closePriorG2Requests({ operator, controller, perception, standardFixture, runDirectory }) {
  const unitId = standardFixture.unitId;
  if (!(await operator.readSnapshot()).readiness.some((row) => row.mode === "simulation")) throw new Error("G2 cleanup requires the module's Simulation mode");
  const pending = (await controller.readSnapshot()).relevantExecutions.filter((row) => row.unitId === unitId &&
    !["Succeeded", "Cancelled", "Failed"].includes(row.state.tag));
  if (!pending.length) return { executionIds: [], executeCalls: 0, allCancelled: true };
  if (pending.some((row) => !row.missionId?.startsWith("mission-g2-eve-") ||
      !["Accepted", "Cancelling"].includes(row.state.tag) || row.claimedAt !== undefined || row.binding.mode.tag !== "Simulation")) {
    throw new Error("prior work is not an unclaimed G2 Simulation request; retained controller reconciliation is required");
  }
  for (const row of pending) {
    if (row.state.tag === "Accepted") await operator.callReducer("requestExecutionCancel", { executionId: row.id });
  }
  const end = Date.now() + 5000;
  while (pending.some((row) => controller.generatedConnection().db.relevantExecutions.id.find(row.id)?.state.tag !== "Cancelling")) {
    if (Date.now() > end) throw new Error("prior G2 cancellation was not confirmed by the generated subscription");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  const cleanupDirectory = join(runDirectory, "g2-cancellation");
  await mkdir(cleanupDirectory, { recursive: true, mode: 0o700 });
  const safetyEvidence = [];
  const outcome = await closeUnclaimedCancellations({
    connection: controller.generatedConnection(), unitId, executionIds: pending.map((row) => row.id), runDirectory: cleanupDirectory,
    publishStopObservation: async (execution, receipt, attestStopped) => {
      if (receipt.safeState !== "confirmed" || receipt.outcome !== "cancelled" || execution.input.tag !== "Navigate") {
        throw new Error("unclaimed G2 cleanup requires a confirmed no-motion cancellation receipt");
      }
      const now = new Date().toISOString();
      const frameId = execution.targetFrameId ?? execution.input.value.targetFrameId;
      const mapId = execution.input.value.mapId;
      const snapshot = await perception.readSnapshot();
      const existingPose = snapshot.relevantPoses.filter((row) => row.entityId === unitId && row.frameId === frameId)
        .sort((a, b) => a.version < b.version ? -1 : a.version > b.version ? 1 : 0).at(-1);
      // The isolated fake executor has never run this request. Its explicitly
      // configured initial state is stationary at the existing frame's origin.
      // This is a new synthetic sample, never a reconstructed historical pose.
      const stationaryPose = existingPose?.value ?? { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
      const fixture = createSyntheticStandardFixture({ unitId, producerId: standardFixture.producerId,
        producerSession: standardFixture.producerSession, sourceSessionId: standardFixture.sourceSessionId,
        spatialFrameId: frameId, localMapId: mapId, mapId, capturedAt: now, receivedAt: now, mapCapturedAt: now });
      const suffix = randomUUID();
      const observationId = `g2-stop-observation-${suffix}`;
      await perception.ingestStandardSyntheticFixture({
        samples: fixture.samples.map((sample) => ({ ...sample, sequence: BigInt(Date.now()) })),
        observation: { ...fixture.observation, id: observationId, entityId: unitId,
          pose: { observedAt: now, frameId, value: stationaryPose },
          trackId: `g2-stop-track-${suffix}`, semantic: { observedAt: now, frameId,
            value: { hypotheses: [{ label: "synthetic-no-motion-stop", score: 1 }] } } },
        mapProduct: undefined,
      });
      const observation = await perception.callProcedure("readObservationDetail", { observationId });
      if (observation?.id !== observationId || observation.unitId !== unitId || !observation.recordedAt) {
        throw new Error("cleanup safety observation was not committed through the resource gateway");
      }
      await attestStopped();
      // Sample actual host time after the confirmed commit. Waiting handles
      // millisecond wall-clock precision without rounding a proof into the
      // future. Sensor acquisition remains `now` in the retained input.
      let proofMicros;
      const deadline = Date.now() + 5000;
      do {
        proofMicros = BigInt(Date.now()) * 1000n;
        if (proofMicros >= observation.recordedAt.microsSinceUnixEpoch && proofMicros > execution.updatedAt.microsSinceUnixEpoch) break;
        if (Date.now() >= deadline) throw new Error("local wall clock did not advance past the committed safety observation");
        await new Promise((resolveWait) => setTimeout(resolveWait, 1));
      } while (true);
      const observedAt = new Timestamp(proofMicros);
      safetyEvidence.push({ executionId: execution.id, observationId, capturedAt: now,
        recordedAt: observation.recordedAt, executionUpdatedAtBeforeProof: execution.updatedAt, proofObservedAt: observedAt,
        stationaryPoseBasis: existingPose ? { kind: "retained-stationary-simulator-pose", observationId: existingPose.observationId }
          : { kind: "explicit-fake-initial-origin", frameId },
        localReceiptId: receipt.id, fixtureKind: "synthetic", physicalEffect: "none" });
      return { observationId, observedAt };
    },
  });
  for (const missionId of new Set(pending.map((row) => row.missionId))) {
    const mission = (await operator.readSnapshot()).assignedMissions.find((row) => row.id === missionId);
    if (mission?.state.tag === "Active") await operator.callReducer("cancelMission", { missionId, expectedRevision: mission.revision });
    await operator.callReducer("reconcileMission", { missionId });
  }
  return { ...outcome, cleanupDirectory, safetyEvidence, ...assertNoPendingExecutions(await controller.readSnapshot(), unitId) };
}
