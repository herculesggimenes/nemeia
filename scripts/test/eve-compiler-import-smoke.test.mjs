import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilerImportChecks, checkConfiguredCompilerImports } from "../eve-compiler-import-smoke.mjs";

const unchanged = { before: { main: "hash" }, after: { main: "hash" },
  busyRows: [{ session_id: "packaging-retained-busy", accepted_count: 1 }],
  connections: 0, requests: 0, upgrades: 0 };

test("compiler smoke requires unchanged retained bytes and busy state", () => {
  assert.equal(Object.values(compilerImportChecks(unchanged)).every(Boolean), true);
  assert.equal(compilerImportChecks({ ...unchanged, after: { main: "changed" } }).retainedLedgerUnchanged, false);
  assert.equal(compilerImportChecks({ ...unchanged, busyRows: [] }).retainedBusyStateUnchanged, false);
});

test("compiler smoke rejects even one configured World or wake attempt", () => {
  for (const key of ["connections", "requests", "upgrades"]) {
    assert.equal(Object.values(compilerImportChecks({ ...unchanged, [key]: 1 })).every(Boolean), false);
  }
});

test("compiler stages do not attribute diagnostic SQLite sidecars to compilation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-compiler-probe-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = await checkConfiguredCompilerImports({ artifactDirectory: directory,
    run: async () => ({ code: 0, signal: null }) });
  assert.equal(report.result, "pass");
  assert.equal(report.stages.length, 2);
  assert.equal(report.stages.every((stage) => stage.checks.retainedLedgerUnchanged), true);
});
