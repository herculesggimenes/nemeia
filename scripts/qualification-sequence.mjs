import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// These guards sequence observed qualification reports. They are not World
// authorization, resource validation, or substitutes for the actual runners.
export function assertPassedReport(report, { gate, runDirectory, qualificationRunId } = {}) {
  if (report?.gate !== gate || report.result !== "pass" || report.claimable !== true ||
      !report.checks || Object.keys(report.checks).length === 0 ||
      Object.values(report.checks).some((value) => value !== true) ||
      (report.failures?.length ?? 0) > 0) throw new Error(`${gate} did not pass every required check`);
  if (runDirectory && report.details?.runDirectory !== runDirectory) throw new Error(`${gate} belongs to another fixture`);
  if (qualificationRunId && report.details?.qualificationRunId !== qualificationRunId) throw new Error(`${gate} belongs to another attempt`);
  if (gate === "G2-automatic-wake" && (report.automaticWakeTested !== true || report.executionMutationCount !== 0)) {
    throw new Error("automatic wake requires actual action-free proof with zero execution mutations");
  }
  return report;
}

export async function readPassedReport(pathname, expected) {
  const bytes = await readFile(pathname);
  const report = assertPassedReport(JSON.parse(bytes), expected);
  return { report, path: pathname, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function qualifiedG2Release({ runDirectory, qualificationRunId, standardPath, automaticPath }) {
  const common = { runDirectory, qualificationRunId };
  const standard = await readPassedReport(standardPath, { gate: "G2", ...common });
  const automatic = await readPassedReport(automaticPath, { gate: "G2-automatic-wake", ...common });
  if (automatic.report.automaticWakeTested !== true) throw new Error("automatic wake actual proof is missing");
  return {
    schemaVersion: 2, gate: "G2", runDirectory, qualificationRunId,
    result: "pass", claimable: true, completedAt: new Date().toISOString(),
    reportPath: standard.path, reportSha256: standard.sha256,
    automaticWake: { result: "pass", claimable: true, automaticWakeTested: true,
      reportPath: automatic.path, reportSha256: automatic.sha256 },
  };
}
