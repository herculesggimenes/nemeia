import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createSyntheticStandardFixture } from "../perception/src/index.ts";
import { assertNoPendingExecutions } from "./composition-guards.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);

// This is a new synthetic acquisition for action admission, not a refreshed
// copy of the retained G1 facts. The G3 helper allocates its own observation,
// map and frame identities while preserving these acquisition timestamps.
export function createFreshG3Fixture(retainedFixture, { now = Date.now(), trackId } = {}) {
  const fixture = createSyntheticStandardFixture({
    unitId: retainedFixture.unitId,
    producerId: retainedFixture.producerId,
    producerSession: retainedFixture.producerSession,
    sourceSessionId: retainedFixture.sourceSessionId,
    capturedAt: new Date(now - 2).toISOString(),
    receivedAt: new Date(now - 1).toISOString(),
    mapCapturedAt: new Date(now).toISOString(),
  });
  return {
    ...fixture,
    observation: { ...fixture.observation, trackId: trackId ?? `g3-track-${process.pid}-${now}` },
  };
}

export async function runAssignedG3Flow({
  operator,
  agent,
  controller,
  perception,
  fixture,
  runDirectory,
  endpoint,
  databaseName,
  agentIdentityFile,
  resourceGateway,
  resourceSession,
  resourceReader,
  authorizedPerception,
}) {
  // Never let the real controller session pick up leftover G2/debug intents.
  // Cancellation is the prior owner's module/controller responsibility.
  assertNoPendingExecutions(await controller.readSnapshot(), fixture.unitId);
  const moduleUrl = pathToFileURL(resolve(root, "conformance/src/g3-flow.ts")).href;
  const helper = await import(moduleUrl);
  if (typeof helper.runActualG3Flow !== "function") {
    throw new Error("conformance/src/g3-flow.ts must export runActualG3Flow");
  }
  const operatorDbConnection = operator.generatedConnection?.();
  const controllerDbConnection = controller.generatedConnection?.();
  const perceptionDbConnection = perception.generatedConnection?.();
  if (!operatorDbConnection || !controllerDbConnection || !perceptionDbConnection) {
    throw new Error("actual G3 composition requires generated operator, controller, and perception DbConnection instances");
  }
  const g3LedgerFile = join(resolve(runDirectory), `g3-agent-${fixture.unitId}.sqlite`);
  const previousLedgerFile = process.env.NEMEIA_AGENT_LEDGER;
  const previousEveOwner = process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID;
  const previousEveIssuer = process.env.NEMEIA_WORLD_AUTH_ISSUER;
  const previousEveSubject = process.env.NEMEIA_WORLD_AUTH_SUBJECT;
  process.env.NEMEIA_AGENT_LEDGER = g3LedgerFile;
  // Eve's authenticated principal is a separate deterministic application
  // identity; it is never conflated with the generated SpacetimeDB identity.
  // The owner id is the canonical issuer:subject principal while the JWT
  // subject remains the subject component for the fixture signer.
  const eveIssuer = process.env.NEMEIA_WORLD_AUTH_ISSUER?.trim() || "nemeia-g2-loopback";
  const eveSubject = "eve-owner-g3-loopback";
  process.env.NEMEIA_WORLD_AUTH_ISSUER = eveIssuer;
  process.env.NEMEIA_WORLD_AUTH_SUBJECT = eveSubject;
  process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID = `${eveIssuer}:${eveSubject}`;
  let eveRuntime;
  try {
    // The dedicated Eve fixture is a real local Eve server/session path. It
    // reads only the path-only handoff and uses the same scoped agent ledger;
    // no model output is treated as a receipt or authority signal.
    const eveModule = await import(pathToFileURL(resolve(root, "agent/test/g2-loopback-adapter.ts")).href);
    eveRuntime = await eveModule.createEveQualificationAdapter();
    const invokeTrustedCommand = async (input) => {
      const raw = await eveRuntime.invokeTrustedCommand({ argv: input.argv });
      const lifecycle = raw?.evidence?.lifecycle;
      if (!Array.isArray(lifecycle) || typeof raw?.evidence?.bashTool !== "boolean" ||
          (typeof raw?.evidence?.actionCommandPath !== "boolean" && typeof raw?.evidence?.actionCommandPath !== "string")) {
        throw new Error("actual Eve command evidence is incomplete");
      }
      const receipt = typeof raw.receipt === "string" ? JSON.parse(raw.receipt) : raw.receipt;
      if (receipt === null || typeof receipt !== "object") throw new Error("actual Eve command returned no structured receipt");
      const retryReceipt = raw.retryReceipt === undefined
        ? undefined
        : typeof raw.retryReceipt === "string" ? JSON.parse(raw.retryReceipt) : raw.retryReceipt;
      return {
        receipt,
        ...(retryReceipt === undefined ? {} : { retryReceipt }),
        step: raw.step,
        evidence: raw.evidence,
      };
    };
    return await helper.runActualG3Flow({
      operatorDbConnection,
      controllerDbConnection,
      perceptionAdapter: perception,
      perceptionDbConnection,
      perceptionGateway: resourceGateway && resourceSession && resourceReader
        ? { gateway: resourceGateway, session: resourceSession, reader: resourceReader }
        : undefined,
      authorizedPerception,
      agentConnectionConfig: {
        uri: endpoint,
        databaseName,
        tokenFile: agentIdentityFile,
      },
      runDirectory,
      worldId: "nemeia-local-world",
      unitId: fixture.unitId,
      agentId: "agent-g3-loopback-001",
      fixture,
      invokeTrustedCommand,
    });
  } finally {
    await eveRuntime?.close?.();
    if (previousLedgerFile === undefined) delete process.env.NEMEIA_AGENT_LEDGER;
    else process.env.NEMEIA_AGENT_LEDGER = previousLedgerFile;
    if (previousEveOwner === undefined) delete process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID;
    else process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID = previousEveOwner;
    if (previousEveIssuer === undefined) delete process.env.NEMEIA_WORLD_AUTH_ISSUER;
    else process.env.NEMEIA_WORLD_AUTH_ISSUER = previousEveIssuer;
    if (previousEveSubject === undefined) delete process.env.NEMEIA_WORLD_AUTH_SUBJECT;
    else process.env.NEMEIA_WORLD_AUTH_SUBJECT = previousEveSubject;
  }
}


export async function createAuthorizedPerception({ perception, standardFixture }) {
  let postClaimEvidenceSequence = 0;
  const initialPerceptionSnapshot = await perception.readSnapshot();
  const retainedBackpackSemantic = initialPerceptionSnapshot.relevantSemantic.find((row) =>
    row.observationId === standardFixture.observation.id && row.entityId !== standardFixture.unitId,
  );
  if (!retainedBackpackSemantic?.entityId) {
    throw new Error("initial synthetic fixture did not expose a retained observed backpack entity");
  }
  const retainedBackpackEntityId = retainedBackpackSemantic.entityId;
  const authorizedPerception = {
    publishPostClaimEvidence: async ({ execution, localReceipt, measuredState, phase }) => {
      const suffix = `${execution.id}-${phase}-${postClaimEvidenceSequence++}`.replace(/[^a-zA-Z0-9_-]/g, "-");
      const now = new Date();
      const capturedAt = now.toISOString();
      const receivedAt = new Date(now.getTime() + 1).toISOString();
      if (execution.input.tag !== "Navigate") throw new Error("G3 post-claim evidence requires a generated Navigate execution");
      const localMapId = execution.input.value.mapId;
      const frameId = execution.targetFrameId ?? execution.input.value.targetFrameId;
      if (!frameId) throw new Error("G3 execution has no immutable target frame pin");
      let pose;
      let completion;
      // The controller requests safe proof before resultFor, including on a
      // successful receipt. Use its measured final pose for either callback;
      // only cancelled/failed closure reuses a retained stationary pose.
      if (measuredState.outcome === "succeeded") {
        if (measuredState.effect !== "none" || localReceipt.safeState !== "confirmed" || localReceipt.completion?.action !== "navigate@1") {
          throw new Error("G3 result evidence requires the held executor's successful Navigate completion");
        }
        completion = localReceipt.completion;
        if (!completion || completion.action !== "navigate@1" || completion.outcome !== "succeeded" || !completion.finalPose) {
          throw new Error("G3 held Navigate receipt has no measured final pose");
        }
        if (completion.finalPose.mapId !== localMapId || completion.finalPose.frameId !== frameId ||
            completion.finalPose.basisMapRevision !== execution.input.value.basisRevision) {
          throw new Error("G3 held Navigate completion does not match the immutable execution map/frame pin");
        }
        pose = completion.finalPose.targetPose;
      } else {
        if (phase === "result" || measuredState.effect !== "none" || localReceipt.safeState !== "confirmed") {
          throw new Error("G3 safe-closure evidence requires a cancelled no-motion receipt with confirmed safety");
        }
        const snapshot = await perception.readSnapshot();
        const currentPose = snapshot.relevantPoses
          .filter((row) => row.entityId === standardFixture.unitId && row.frameId === frameId)
          .sort((left, right) => left.version < right.version ? -1 : left.version > right.version ? 1 : 0)
          .at(-1);
        if (!currentPose) throw new Error("G3 safe-closure evidence has no retained current pose in the pinned frame");
        // The held fake executor never releases a cancelled command. Reusing
        // the latest generated pose is therefore a no-motion safety observation,
        // not a synthetic movement or a completion claim.
        pose = currentPose.value;
      }
      const sequence = 1_000n + BigInt(postClaimEvidenceSequence);
      const evidenceFixture = createSyntheticStandardFixture({
        unitId: standardFixture.unitId,
        producerId: standardFixture.producerId,
        producerSession: standardFixture.producerSession,
        sourceSessionId: standardFixture.sourceSessionId,
        localMapId,
        mapId: localMapId,
        spatialFrameId: frameId,
        capturedAt,
        receivedAt,
        mapCapturedAt: receivedAt,
      });
      const samples = evidenceFixture.samples.map((sample) => ({
        ...sample,
        spatialFrameId: frameId,
        sequence,
        capturedAt,
        receivedAt,
      }));
      const observationId = `g3-unit-observation-${suffix}`;
      const observation = {
        ...evidenceFixture.observation,
        id: observationId,
        localMapId,
        entityId: standardFixture.unitId,
        trackId: `g3-unit-track-${suffix}`,
        observedAt: capturedAt,
        semantic: undefined,
        pose: {
          observedAt: capturedAt,
          frameId,
          value: pose,
        },
      };
      // This is a post-claim observation in the already pinned map/frame. The
      // adapter publishes only new bytes/identity; it does not reset spatial
      // origin, create a second map, or invent a target observation.
      await perception.ingestStandardSyntheticFixture({
        samples,
        observation,
        mapProduct: undefined,
      });
      const committed = await perception.callProcedure("readObservationDetail", { observationId });
      if (committed?.id !== observationId || committed.unitId !== standardFixture.unitId || !committed.recordedAt) {
        throw new Error("G3 safety evidence is not visible through the scoped observation procedure");
      }
      return {
        unitObservationId: observationId,
        reviewObservationId: standardFixture.observation.id,
        safeObservationId: observationId,
        targetEntityId: retainedBackpackEntityId,
        // Safety proof attests to this committed observation. Acquisition time
        // remains unchanged in input.inputs/pose; retain SDK microseconds here.
        observedAt: committed.recordedAt,
        ...(phase === "result"
          ? {
              completion: {
                tag: "Succeeded",
                value: {
                  completion: {
                    tag: "Navigate",
                    value: { unitObservationId: observationId, localReceiptId: localReceipt.id },
                  },
                },
              },
            }
          : {}),
      };
    },
  };
  return authorizedPerception;
}
