import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson } from "../../world-client/src/json.ts";

export const requiredEvidence = {
  G1: [
    "actualModule",
    "generatedDbConnection",
    "adminAuthorizedGeneratedViews",
    "scopedWorkerRead",
    "processRestart",
    "retainedDataAfterRestart",
    "sameScopedIdentityAfterRestart",
    "fixtureBackedRetention",
    "sourceAcquisitionTimesPreserved",
    "resourceGatewayReopenedAfterRestart",
    "resourceBytesVerifiedAfterRestart",
    "sameBodyReplayNoNewRows",
    "changedBodyReplayRejected",
    "missingResourceRejected",
    "corruptResourceRejected",
  ],
  G2: [
    "actualEveLifecycle",
    "injectedModel",
    "worldChangedDuringThinking",
    "actualGeneratedWorldSubscription",
    "usefulWorldContext",
    "authenticatedJustBashRead",
    "nextStepFresh",
    "sameStepPinned",
    "revokedAccessDenied",
  ],
  G3: [
    "actualModule",
    "actualEve",
    "processRestart",
    "retainedDataAfterRestart",
    "sameScopedIdentityAfterRestart",
    "missionAssignment",
    "unitGrant",
    "trustedAgentCommand",
    "admissionClaim",
    "retainedControllerReceipt",
    "measuredFeedback",
    "reviewedObjectiveProgress",
    "safeCancellation",
    "noDuplicateRetry",
  ]
};

export function createQualificationReport({
  gate,
  mode,
  requestedResult = "pass",
  checks = {},
  versions = {},
  fixtureDigest,
  evidence = [],
  details = {}
}) {
  if (!requiredEvidence[gate]) throw new Error(`Unsupported qualification gate: ${gate}`);
  if (!fixtureDigest) throw new Error("Qualification reports require a fixture digest");
  const failures = [];
  if (["G1", "G3"].includes(gate) && mode !== "loopback-spacetimedb") {
    failures.push(`${gate} requires actual loopback SpacetimeDB evidence; ${mode} is diagnostic only`);
  }
  if (gate === "G2" && mode !== "eve-loopback") {
    failures.push("G2 requires an actual Eve lifecycle; context-only and mock modes are diagnostic only");
  }
  for (const key of requiredEvidence[gate]) {
    if (checks[key] !== true) failures.push(`missing required evidence: ${key}`);
  }
  for (const [key, value] of Object.entries(checks)) {
    if (value === false) failures.push(`required check failed: ${key}`);
  }
  const result = requestedResult === "pass" && failures.length ? "blocked" : requestedResult;
  return {
    schemaVersion: 1,
    gate,
    mode,
    result,
    claimable: result === "pass" && failures.length === 0,
    fixtureDigest,
    versions,
    checks,
    evidence,
    failures,
    details,
    safety: {
      robotAccess: false,
      paidInference: false,
      physicalActuation: false,
      sourceAcquisitionTimesPreserved: true
    }
  };
}

export function assertClaimable(report) {
  if (!report || report.result !== "pass" || report.claimable !== true) {
    throw new Error(`Qualification report is not claimable: ${report?.gate ?? "unknown"}/${report?.result ?? "missing"}`);
  }
  return report;
}

export async function writeQualificationReport(path, report) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(JSON.parse(canonicalJson(report)), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(target, 0o600);
  return target;
}
