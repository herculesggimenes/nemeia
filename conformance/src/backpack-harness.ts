import { createQualificationReport } from "./qualification-report.ts";
import { assertRecordedAcquisitionPreserved, createBackpackFixture } from "./backpack-fixture.ts";

export async function runRetainedBackpackFlow({ world, fixture = createBackpackFixture() }) {
  await world.start();
  const identityBefore = await world.getScopedIdentityFingerprint();
  await world.ingestRecordedBackpackFixture(fixture);
  const beforeRestart = await world.readBackpackProjection();
  await world.restartWorldProcess();
  const identityAfter = await world.getScopedIdentityFingerprint();
  const afterRestart = await world.readBackpackProjection();
  assertRecordedAcquisitionPreserved(fixture.firstObservation, {
    recordedAcquisitionAt: afterRestart.recordedAcquisitionAt
  });
  return {
    fixture,
    identityBefore,
    identityAfter,
    beforeRestart,
    afterRestart,
    checks: {
      actualModule: world.mode === "loopback-spacetimedb",
      loopbackEndpoint: world.mode === "loopback-spacetimedb" && /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(world.endpoint),
      processRestart: world.processRestartCount >= 1,
      retainedDataAfterRestart: afterRestart.entityIds.includes(fixture.firstObservation.entityId)
        && afterRestart.mapRevisionIds.includes(fixture.mapCheckpoint.id)
        && afterRestart.resourceIds.includes(fixture.resourceRef.id),
      sameScopedIdentityAfterRestart: identityBefore === identityAfter,
      sourceAcquisitionTimesPreserved: afterRestart.recordedAcquisitionAt === fixture.firstObservation.recordedAcquisitionAt,
      ingestedFixture: afterRestart.resourceIds.includes(fixture.resourceRef.id)
    }
  };
}

export async function runFakeBackpackE8({ world, fixture = createBackpackFixture() }) {
  const retained = await runRetainedBackpackFlow({ world, fixture });
  await world.createMission(fixture.mission);
  await world.assignUnit(fixture.unit);
  const proposed = await world.proposeNavigate({
    executionId: "execution-viewpoint-001",
    missionId: fixture.mission.id,
    objectiveId: fixture.mission.objectiveId,
    action: "navigate@1",
    frameId: fixture.frame.id,
    mapRevisionId: fixture.mapCheckpoint.id
  });
  await world.claimExecution(proposed.executionId);
  const completion = await world.completeExecution(proposed.executionId);
  await world.publishObservation(fixture.secondObservation);
  const finding = await world.recordReviewedFinding({
    missionId: fixture.mission.id,
    objectiveId: fixture.mission.objectiveId,
    entityId: fixture.secondObservation.entityId,
    evidence: fixture.secondObservation.evidence
  });
  const progress = await world.recordObjectiveProgress({ missionId: fixture.mission.id, objectiveId: fixture.mission.objectiveId, finding });
  return {
    ...retained,
    proposed,
    completion,
    finding,
    progress,
    report: createQualificationReport({
      gate: "G3",
      mode: world.mode,
      fixtureDigest: fixture.fixtureDigest,
      checks: {
        ...retained.checks,
        missionAssignment: false,
        unitGrant: false,
        trustedAgentCommand: false,
        admissionClaim: false,
        retainedControllerReceipt: false,
        measuredFeedback: completion.state === "succeeded" && completion.measured === true,
        reviewedObjectiveProgress: false,
        safeCancellation: false,
        noDuplicateRetry: false,
      },
      details: { note: "Fake controller/software flow only; this report cannot claim G3." }
    })
  };
}

export async function runLoopbackBackpackQualification({ world, fixture = createBackpackFixture() }) {
  const retained = await runRetainedBackpackFlow({ world, fixture });
  return {
    ...retained,
    report: createQualificationReport({
      gate: "G1",
      mode: world.mode,
      fixtureDigest: fixture.fixtureDigest,
      checks: retained.checks,
      evidence: ["resource-gateway-commit", "confirmed-read-before-restart", "process-restart", "confirmed-read-after-restart"]
    })
  };
}

export async function runLoopbackSoftwareQualification({ world, fixture = createBackpackFixture() }) {
  if (typeof world.runG3BackpackFlow !== "function") {
    throw new Error("World/control loopback adapter must expose runG3BackpackFlow for G3 qualification");
  }
  const retained = await runRetainedBackpackFlow({ world, fixture });
  const outcome = await world.runG3BackpackFlow(fixture);
  return {
    ...retained,
    outcome,
    report: createQualificationReport({
      gate: "G3",
      mode: world.mode,
      fixtureDigest: fixture.fixtureDigest,
      checks: {
        ...retained.checks,
        missionAssignment: outcome.missionAssignment === true,
        unitGrant: outcome.unitGrant === true,
        trustedAgentCommand: outcome.trustedAgentCommand === true,
        admissionClaim: outcome.admissionClaim === true,
        retainedControllerReceipt: outcome.retainedControllerReceipt === true,
        measuredFeedback: outcome.measuredFeedback === true,
        reviewedObjectiveProgress: outcome.reviewedObjectiveProgress === true,
        safeCancellation: outcome.safeCancellation === true,
        noDuplicateRetry: outcome.noDuplicateRetry === true,
      },
      evidence: ["operator-assignment", "typed-action-admission", "controller-receipt", "reviewed-finding", "objective-progress"]
    })
  };
}
