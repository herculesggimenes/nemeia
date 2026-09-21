import { register } from "node:module";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeQualificationReport } from "./qualification-provenance.mjs";
import { assertPassedReport } from "./qualification-sequence.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
register(pathToFileURL(join(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const reportPath = resolve(process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? join(root, `.artifacts/qualification/automatic-wake/run-${process.pid}-${Date.now()}`), "automatic-wake.json");
let adapter;
let written = false;
const handoffPath = process.env.NEMEIA_QUALIFICATION_HANDOFF ?? join(root, ".artifacts/qualification/current-handoff.json");
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.once(signal, async () => {
  await adapter?.close();
  process.exit(130);
});
try {
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  if (!handoff.available) throw new Error("automatic wake requires the current owned fixture");
  process.env.NEMEIA_QUALIFICATION_HANDOFF = handoffPath;
  const { createEveQualificationAdapter } = await import("../agent/test/g2-loopback-adapter.ts");
  adapter = await createEveQualificationAdapter();
  const outcome = await adapter.runAutomaticWakeQualification();
  if (outcome.automaticWakeTested !== true) throw new Error("automatic wake actual lifecycle did not pass");
  const source = JSON.parse(await readFile(outcome.reportFile, "utf8"));
  assertPassedReport(source, { gate: "G2-automatic-wake" });
  await adapter.close();
  adapter = undefined;
  await writeQualificationReport(reportPath, { ...source, details: {
    sourceReportPath: outcome.reportFile, runDirectory: handoff.runDirectory,
    qualificationRunId: process.env.NEMEIA_QUALIFICATION_RUN_ID,
  } });
  written = true;
  console.log(JSON.stringify({ gate: "G2-automatic-wake", result: "pass", reportPath }));
} catch (error) {
  if (!written) await writeQualificationReport(reportPath, {
    gate: "G2-automatic-wake", result: "fail", claimable: false, automaticWakeTested: false,
    checks: { actualAutomaticWake: false }, details: { reason: String(error.message).replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu, "[jwt-redacted]") },
  });
  console.error(`Automatic wake qualification failed; report ${reportPath}`);
  process.exitCode = 2;
} finally { await adapter?.close(); }
