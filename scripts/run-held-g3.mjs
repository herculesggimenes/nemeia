import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { register } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createQualificationReport } from "../conformance/src/qualification-report.ts";
import { writeQualificationReport } from "./qualification-provenance.mjs";
import { qualifyOperatorMissionExpiry, startOperatorMissionTicker } from "./operator-mission-ticker.mjs";
import { assertNoPendingExecutions, hasCurrentG2Release } from "./composition-guards.mjs";
import { canonicalJson } from "../world-client/src/json.ts";
import { qualifiedG2Release } from "./qualification-sequence.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
register(pathToFileURL(join(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const handoffPath = resolve(root, process.env.NEMEIA_QUALIFICATION_HANDOFF ?? ".artifacts/qualification/current-handoff.json");
const adapters = [];
let operatorTicker;
let reportPath;
let handoff;
let g1;
let qualificationReportWritten = false;

async function privateFile(pathname) {
  if (((await stat(pathname)).mode & 0o777) !== 0o600) throw new Error("held qualification requires private mode-600 credentials");
  return readFile(pathname);
}

async function main() {
  handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  if (handoff.available !== true) throw new Error("held qualification handoff is unavailable");
  const uri = new URL(handoff.uri);
  if (uri.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname)) throw new Error("held G3 requires an HTTP loopback server");
  const releasePath = resolve(process.env.NEMEIA_G2_GATE_FILE ?? join(handoff.runDirectory, "g2-complete.json"));
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  if (!hasCurrentG2Release(release, handoff.runDirectory)) {
    throw new Error("G3 requires current-run standard G2 and automatic wake qualification");
  }
  const checkedRelease = await qualifiedG2Release({ runDirectory: handoff.runDirectory,
    qualificationRunId: release.qualificationRunId, standardPath: release.reportPath,
    automaticPath: release.automaticWake.reportPath });
  if (checkedRelease.reportSha256 !== release.reportSha256 ||
      checkedRelease.automaticWake.reportSha256 !== release.automaticWake.reportSha256) throw new Error("G2 release evidence changed");
  const reportDirectory = resolve(process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? join(dirname(handoff.runDirectory), "qualification"));
  reportPath = join(reportDirectory, `g3-held-${process.pid}-${Date.now()}.json`);
  g1 = JSON.parse(await readFile(join(reportDirectory, "g1-loopback.json"), "utf8"));
  if (g1.claimable !== true || g1.details?.endpoint !== handoff.uri) throw new Error("G3 requires retained restart evidence from this owned held server");
  if (process.argv.includes("--check-ready")) {
    console.log(JSON.stringify({ available: true, uri: handoff.uri, gate: "G3", releasePath }));
    return;
  }
  const { createLoopbackAdapter } = await import("../conformance/src/loopback-adapter.ts");
  const { createSyntheticStandardFixture } = await import("../perception/src/index.ts");
  const { ResourceGateway } = await import("../world-resources/src/index.ts");
  const { createAuthorizedPerception, createFreshG3Fixture, runAssignedG3Flow } = await import("./g3-composition.mjs");
  const connect = async (tokenFile, allowNewIdentity = false) => {
    try { await privateFile(tokenFile); } catch (error) {
      if (!allowNewIdentity || error.code !== "ENOENT") throw error;
    }
    const adapter = await createLoopbackAdapter({
      modulePath: join(handoff.runDirectory, "generated-module-bindings"),
      uri: handoff.uri,
      databaseName: handoff.databaseName,
      scopedIdentityFile: tokenFile,
    });
    adapters.push(adapter);
    await adapter.start();
    return adapter;
  };
  if (!handoff.adminTokenFile || handoff.operatorTokenFile === handoff.adminTokenFile) throw new Error("bootstrap must provide distinct administrator and World Operator credentials");
  const operator = await connect(handoff.operatorTokenFile);
  const scopedWorldOperator = (await operator.readSnapshot()).readiness.some((row) => row.role === "world_operator");
  if (!scopedWorldOperator) throw new Error("G3 requires a distinct enrolled World Operator, not publisher/admin");
  const controller = await connect(handoff.controllerTokenFile);
  const perception = await connect(handoff.perceptionTokenFile);
  const standardFixture = createSyntheticStandardFixture({
    unitId: handoff.unitId,
    capturedAt: "2026-09-19T12:00:45.000Z",
    receivedAt: "2026-09-19T12:00:46.000Z",
    mapCapturedAt: "2026-09-19T12:00:46.000Z",
  });
  const credential = new Uint8Array(await privateFile(join(handoff.runDirectory, "credentials/replay-producer.credential")));
  const resourceGateway = await ResourceGateway.open({ root: handoff.resourceRoot, bindings: [{
    bindingId: "replay-binding-001",
    producerId: standardFixture.producerId,
    producerSession: standardFixture.producerSession,
    unitId: handoff.unitId,
    package: standardFixture.mapProduct.producer,
    credential,
    allowedSchemas: ["image/png", "text/x.pcd", "application/json", "nemeia/native-map-manifest@1", "nemeia/native-map-evidence-index@1"],
    referenceCommitAdapter: { commitPublishedReferences: (request) => perception.commitPublishedReferences(request) },
  }] });
  const resourceSession = resourceGateway.authenticateWorker({ bindingId: "replay-binding-001", credential });
  const resourceReader = resourceGateway.createReader({ authorizeRead: () => true });
  perception.attachResourceGateway({ gateway: resourceGateway, session: resourceSession, reader: resourceReader });
  const { closePriorG2Requests } = await import("./g3-preflight.mjs");
  const cancellationCleanup = await closePriorG2Requests({ operator, controller, perception, standardFixture, runDirectory: handoff.runDirectory });
  await writeFile(join(cancellationCleanup.cleanupDirectory ?? handoff.runDirectory, "g2-cancellation-cleanup.json"), `${canonicalJson(cancellationCleanup)}\n`, { mode: 0o600 });
  const preflight = assertNoPendingExecutions(await controller.readSnapshot(), handoff.unitId);
  const authorizedPerception = await createAuthorizedPerception({ perception, standardFixture });
  const operatorTickerEvidence = await qualifyOperatorMissionExpiry(operator, { unitId: handoff.unitId });
  if (!operatorTickerEvidence.expiredWithoutExecution) throw new Error("operator timer did not expire a mission without executions");
  operatorTicker = startOperatorMissionTicker(operator);
  const attemptDirectory = join(handoff.runDirectory, `g3-attempt-${process.pid}-${Date.now()}`);
  await mkdir(attemptDirectory, { recursive: true, mode: 0o700 });
  const fixture = createFreshG3Fixture(standardFixture);
  const outcome = await runAssignedG3Flow({
    operator, controller, perception, fixture,
    runDirectory: attemptDirectory,
    endpoint: handoff.uri,
    databaseName: handoff.databaseName,
    agentIdentityFile: handoff.agentTokenFile,
    resourceGateway, resourceSession, resourceReader, authorizedPerception,
  });
  const report = createQualificationReport({
    gate: "G3", mode: "loopback-spacetimedb", fixtureDigest: g1.fixtureDigest,
    checks: {
      ...outcome.checks,
      scopedWorldOperator,
      missionDeadlineWithoutExecutions: operatorTickerEvidence.expiredWithoutExecution,
      processRestart: g1.checks.processRestart,
      retainedDataAfterRestart: g1.checks.retainedDataAfterRestart,
      sameScopedIdentityAfterRestart: g1.checks.sameScopedIdentityAfterRestart,
    },
    evidence: outcome.evidence,
    details: {
      endpoint: handoff.uri, runDirectory: handoff.runDirectory, attemptDirectory,
      restartEvidencePath: join(reportDirectory, "g1-loopback.json"),
      moduleBuildHash: handoff.moduleBuildHash, schemaFingerprint: handoff.schemaFingerprint,
      observedChecks: outcome.observedChecks, notRunChecks: outcome.notRunChecks,
      ids: outcome.ids, receipts: outcome.receipts, diagnostics: outcome.diagnostics,
      operatorTickerEvidence,
      preflight,
      cancellationCleanup,
    },
  });
  await writeQualificationReport(reportPath, report);
  qualificationReportWritten = true;
  if (report.claimable) {
    const current = JSON.parse(await readFile(handoffPath, "utf8"));
    if (current.runDirectory !== handoff.runDirectory || current.uri !== handoff.uri) {
      throw new Error("held handoff changed during G3; refusing to release another fixture");
    }
    await writeFile(handoffPath, `${canonicalJson({ ...current, phase: "g3-complete-ui-ready", g3ReportPath: reportPath })}\n`, { mode: 0o600 });
    await chmod(handoffPath, 0o600);
  }
  console.log(JSON.stringify({ gate: "G3", result: report.result, claimable: report.claimable, reportPath }));
  if (!report.claimable) process.exitCode = 2;
}

async function close() {
  await operatorTicker?.close();
  for (const adapter of adapters) await adapter.close().catch(() => {});
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, async () => { await close(); process.exit(130); });
try { await main(); } catch (error) {
  if (reportPath && g1 && !qualificationReportWritten) await writeQualificationReport(reportPath, createQualificationReport({
    gate: "G3", mode: "loopback-spacetimedb", requestedResult: "blocked", fixtureDigest: g1.fixtureDigest,
    details: { reason: error.message, cause: error.cause?.message, endpoint: handoff?.uri, errorStack: error.stack },
  }));
  console.error(`held G3 blocked: ${error.message}`);
  process.exitCode = 2;
} finally { await close(); }
