import { resolve } from "node:path";
import { createBackpackFixture } from "../../conformance/src/backpack-fixture.ts";
import { runEveLoopbackQualification } from "../../conformance/src/eve-harness.ts";
import { createQualificationReport, writeQualificationReport } from "../../conformance/src/qualification-report.ts";
import { createEveQualificationAdapter } from "../test/g2-loopback-adapter.ts";

const root = resolve(new URL("../..", import.meta.url).pathname);
const reportPath = resolve(root, process.env.NEMEIA_QUALIFICATION_REPORT_DIR ?? ".artifacts/qualification", "g2-eve.json");

async function main() {
  const fixture = createBackpackFixture();
  const runtime = await createEveQualificationAdapter();
  try {
    if (process.argv.includes("--default-api-owner-only")) {
      const result = await runtime.runDefaultApiOwnerProbe();
      console.log(JSON.stringify(result));
      return;
    }
    const result = await runEveLoopbackQualification({ runtime, fixture });
    await writeQualificationReport(reportPath, result.report);
    if (!result.report.claimable) process.exitCode = 2;
  } finally {
    await runtime.close?.();
  }
}

try {
  await main();
} catch (error) {
  const fixture = createBackpackFixture();
  const report = createQualificationReport({
    gate: "G2",
    mode: "eve-loopback",
    requestedResult: "blocked",
    fixtureDigest: fixture.fixtureDigest,
    details: { reason: error instanceof Error ? error.message : String(error) },
  });
  await writeQualificationReport(reportPath, report);
  console.error(`Eve qualification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
