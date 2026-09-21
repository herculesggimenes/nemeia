import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { register } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createBackpackFixture } from "../conformance/src/backpack-fixture.ts";
import { runEveLoopbackQualification } from "../conformance/src/eve-harness.ts";
import { createQualificationReport } from "../conformance/src/qualification-report.ts";
import { writeQualificationReport } from "./qualification-provenance.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
register(pathToFileURL(resolve(root, "scripts/resolve-ts-specifiers.mjs")).href, import.meta.url);
const reportPath = resolve(root, process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? `.artifacts/qualification/eve/run-${process.pid}-${Date.now()}`, "g2-eve.json");
const fixture = createBackpackFixture();

async function defaultAdapterPath() {
  const candidates = [
    "conformance/src/g2-eve-adapter.ts",
    "conformance/src/g2-eve-loopback.ts",
    "agent/eve-eval-fixture/g2-adapter.ts",
    "agent/eve-eval-fixture/g2-loopback-adapter.ts",
    "agent/test/g2-loopback-adapter.ts",
  ];
  for (const candidate of candidates) {
    const pathname = resolve(root, candidate);
    try {
      await access(pathname, constants.R_OK);
      return pathname;
    } catch {
      // The dedicated G2 worker may not have landed its in-repo adapter yet.
    }
  }
  return undefined;
}

async function main() {
  const adapterPath = process.env.NEMEIA_EVE_ADAPTER ?? await defaultAdapterPath();
  if (!adapterPath) {
    const report = createQualificationReport({ gate: "G2", mode: "eve-loopback", requestedResult: "blocked", fixtureDigest: fixture.fixtureDigest, details: { reason: "no in-repo dedicated G2 adapter is available yet", handoffPath: resolve(root, ".artifacts/qualification/current-handoff.json") } });
    await writeQualificationReport(reportPath, report);
    console.error("Eve qualification blocked: no in-repo dedicated G2 adapter is available yet");
    process.exitCode = 2;
    return;
  }
  process.env.NEMEIA_CURRENT_HANDOFF_FILE ??= resolve(root, ".artifacts/qualification/current-handoff.json");
  const module = await import(pathToFileURL(resolve(adapterPath)).href);
  if (typeof module.createEveQualificationAdapter !== "function") throw new Error("Eve adapter must export createEveQualificationAdapter");
  const runtime = await module.createEveQualificationAdapter();
  try {
    const result = await runEveLoopbackQualification({ runtime, fixture });
    const handoff = JSON.parse(await readFile(process.env.NEMEIA_QUALIFICATION_HANDOFF ?? process.env.NEMEIA_CURRENT_HANDOFF_FILE, "utf8"));
    result.report.details = { ...result.report.details, runDirectory: handoff.runDirectory,
      qualificationRunId: process.env.NEMEIA_QUALIFICATION_RUN_ID,
      completedAt: new Date().toISOString() };
    await writeQualificationReport(reportPath, result.report);
    if (!result.report.claimable) process.exitCode = 2;
  } finally {
    await runtime.close?.();
  }
}

try { await main(); } catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  const report = createQualificationReport({
    gate: "G2",
    mode: "eve-loopback",
    requestedResult: "blocked",
    fixtureDigest: fixture.fixtureDigest,
    details: {
      reason,
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      handoffPath: process.env.NEMEIA_QUALIFICATION_HANDOFF ?? resolve(root, ".artifacts/qualification/current-handoff.json"),
    },
  });
  await writeQualificationReport(reportPath, report);
  console.error(`Eve qualification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
