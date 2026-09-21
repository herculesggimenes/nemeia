import { readFile, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../world-client/src/json.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
register(pathToFileURL(join(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const selected = process.argv.slice(2);
if (selected.length === 0 || selected.some((id) => !/^exec_[a-zA-Z0-9-]+$/.test(id))) throw new Error("pass the explicit G2 execution IDs assigned for exclusive cleanup");
const handoff = JSON.parse(await readFile(join(root, ".artifacts/qualification/current-handoff.json"), "utf8"));
if (!handoff.available || new URL(handoff.uri).hostname !== "127.0.0.1") throw new Error("cleanup requires the available owned loopback handoff");
const adapters = [];
async function privateBytes(pathname) {
  if (((await stat(pathname)).mode & 0o777) !== 0o600) throw new Error("private credential file required");
  return readFile(pathname);
}
try {
  const { createLoopbackAdapter } = await import("../conformance/src/loopback-adapter.ts");
  const connect = async (pathname) => {
    await privateBytes(pathname);
    const adapter = await createLoopbackAdapter({ modulePath: join(handoff.runDirectory, "generated-module-bindings"),
      uri: handoff.uri, databaseName: handoff.databaseName, scopedIdentityFile: pathname });
    adapters.push(adapter); await adapter.start(); return adapter;
  };
  const operator = await connect(handoff.operatorTokenFile);
  const controller = await connect(handoff.controllerTokenFile);
  const perception = await connect(handoff.perceptionTokenFile);
  const pending = (await controller.readSnapshot()).relevantExecutions.filter((row) => row.unitId === handoff.unitId &&
    !["Succeeded", "Failed", "Cancelled"].includes(row.state.tag));
  if (pending.length !== selected.length || pending.some((row) => !selected.includes(row.id) || row.state.tag !== "Cancelling")) {
    throw new Error("read-only preflight does not match the explicitly assigned Cancelling requests");
  }
  const { createSyntheticStandardFixture } = await import("../perception/src/index.ts");
  const standardFixture = createSyntheticStandardFixture({ unitId: handoff.unitId });
  const { ResourceGateway } = await import("../world-resources/src/index.ts");
  const credential = new Uint8Array(await privateBytes(join(handoff.runDirectory, "credentials/replay-producer.credential")));
  const gateway = await ResourceGateway.open({ root: handoff.resourceRoot, bindings: [{
    bindingId: "replay-binding-001", producerId: standardFixture.producerId, producerSession: standardFixture.producerSession,
    unitId: handoff.unitId, package: standardFixture.mapProduct.producer, credential,
    allowedSchemas: ["image/png", "text/x.pcd", "application/json", "nemeia/native-map-manifest@1", "nemeia/native-map-evidence-index@1"],
    referenceCommitAdapter: { commitPublishedReferences: (request) => perception.commitPublishedReferences(request) },
  }] });
  perception.attachResourceGateway({ gateway, session: gateway.authenticateWorker({ bindingId: "replay-binding-001", credential }),
    reader: gateway.createReader({ authorizeRead: () => true }) });
  const { closePriorG2Requests } = await import("./g3-preflight.mjs");
  const outcome = await closePriorG2Requests({ operator, controller, perception, standardFixture, runDirectory: handoff.runDirectory });
  const snapshot = await operator.readSnapshot();
  const executions = snapshot.relevantExecutions.filter((row) => selected.includes(row.id));
  const missions = snapshot.assignedMissions.filter((row) => pending.some((execution) => execution.missionId === row.id));
  const control = snapshot.relevantUnitControls.find((row) => row.unitId === handoff.unitId);
  const observations = await Promise.all(outcome.safetyEvidence.map((proof) => perception.callProcedure("readObservationDetail", { observationId: proof.observationId })));
  const checks = {
    allCancelled: executions.length === selected.length && executions.every((row) => row.state.tag === "Cancelled" && row.result?.tag === "Cancelled" && !!row.receiptId),
    missionsCancelled: missions.length > 0 && missions.every((row) => row.state.tag === "Cancelled"),
    noActiveReservation: control?.activeExecutionId === undefined,
    safeStateConfirmed: control?.safeStateConfirmed === true,
    noExecute: outcome.executeCalls === 0,
    freshCommittedProof: outcome.safetyEvidence.every((proof) => {
      const observation = observations.find((row) => row?.id === proof.observationId);
      const execution = executions.find((row) => row.id === proof.executionId);
      return !!observation && !!execution?.safeStateProof && proof.proofObservedAt.microsSinceUnixEpoch > proof.executionUpdatedAtBeforeProof.microsSinceUnixEpoch &&
        proof.proofObservedAt.microsSinceUnixEpoch >= observation.recordedAt.microsSinceUnixEpoch &&
        proof.proofObservedAt.microsSinceUnixEpoch <= execution.updatedAt.microsSinceUnixEpoch;
    }),
  };
  const reportPath = join(outcome.cleanupDirectory, "cleanup-report.json");
  await writeFile(reportPath, `${canonicalJson({ checks, outcome, executions, missions, control, observations, runDirectory: handoff.runDirectory })}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ checks, reportPath, executions: executions.map((row) => ({ id: row.id, state: row.state.tag, receiptId: row.receiptId })),
    missions: missions.map((row) => ({ id: row.id, state: row.state.tag })) }));
  if (Object.values(checks).some((value) => !value)) process.exitCode = 2;
} catch (error) {
  console.error(`exclusive G2 cleanup failed: ${error.message}`); process.exitCode = 2;
} finally {
  for (const adapter of adapters) await adapter.close().catch(() => {});
}
