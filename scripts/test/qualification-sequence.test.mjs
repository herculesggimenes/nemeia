import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPassedReport, qualifiedG2Release } from "../qualification-sequence.mjs";

const report = (gate) => ({ gate, result: "pass", claimable: true, checks: { fixtureOnly: true },
  details: { runDirectory: "current", qualificationRunId: "attempt" } });

test("fixture-only sequencing rejects false checks, empty proof, and wrong attempt", () => {
  for (const variant of [{ claimable: false }, { result: "blocked" }, { checks: {} }, { checks: { a: true, b: false } }, { failures: ["failure"] }]) {
    assert.throws(() => assertPassedReport({ ...report("G2"), ...variant }, { gate: "G2" }));
  }
  assert.throws(() => assertPassedReport(report("G2"), { gate: "G2", qualificationRunId: "stale" }), /another attempt/);
});

test("fixture-only marker requires both independent reports before releasing G3", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-gate-sequence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const standardPath = join(directory, "g2.json");
  const automaticPath = join(directory, "automatic.json");
  const options = { runDirectory: "current", qualificationRunId: "attempt", standardPath, automaticPath };
  await writeFile(standardPath, JSON.stringify(report("G2")));
  await assert.rejects(qualifiedG2Release(options), { code: "ENOENT" });
  await writeFile(automaticPath, JSON.stringify({ ...report("G2-automatic-wake"), automaticWakeTested: false }));
  await assert.rejects(qualifiedG2Release(options), /actual action-free proof/);
  await writeFile(automaticPath, JSON.stringify({ ...report("G2-automatic-wake"), automaticWakeTested: true, executionMutationCount: 1 }));
  await assert.rejects(qualifiedG2Release(options), /zero execution mutations/);
  await writeFile(automaticPath, JSON.stringify({ ...report("G2-automatic-wake"), automaticWakeTested: true, executionMutationCount: 0 }));
  const release = await qualifiedG2Release(options);
  assert.equal(release.schemaVersion, 2);
  assert.match(release.automaticWake.reportSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(qualifiedG2Release({ ...options, runDirectory: "other" }), /another fixture/);
});
