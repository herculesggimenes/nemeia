import assert from "node:assert/strict";
import test from "node:test";
import { assertClaimable, createQualificationReport } from "../src/qualification-report.ts";

test("reports fail when any check is false and cannot claim from mock mode", () => {
  const report = createQualificationReport({
    gate: "G1",
    mode: "mock-contract",
    fixtureDigest: "fixture",
    requestedResult: "pass",
    checks: {
      actualModule: true,
      processRestart: true,
      retainedDataAfterRestart: true,
      sameScopedIdentityAfterRestart: true,
      retainedResource: false
    }
  });
  assert.equal(report.result, "blocked");
  assert.equal(report.claimable, false);
  assert.throws(() => assertClaimable(report), /not claimable/);
  assert.ok(report.failures.some(failure => failure.includes("retainedResource")));
});
