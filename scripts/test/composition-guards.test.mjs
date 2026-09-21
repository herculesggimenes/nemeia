import assert from "node:assert/strict";
import test from "node:test";
import { assertNoPendingExecutions, hasCurrentG2Release } from "../composition-guards.mjs";

test("fixture guard rejects earlier accepted/cancelling work before starting G3", () => {
  for (const tag of ["Accepted", "Running", "CancelRequested", "unknown"]) {
    assert.throws(() => assertNoPendingExecutions({ relevantExecutions: [
      { id: "g2-leftover", unitId: "unit", state: { tag } },
    ] }, "unit"), /lifecycle-safe closure/);
  }
  assert.deepEqual(assertNoPendingExecutions({ relevantExecutions: [
    { id: "g2-closed", unitId: "unit", state: { tag: "Cancelled" } },
  ] }, "unit"), { previousExecutionsTerminal: true, retainedTerminalExecutionIds: ["g2-closed"] });
});

test("fixture sequencing ignores stale and failed G2 completion markers", () => {
  const pass = { schemaVersion: 2, gate: "G2", runDirectory: "current", qualificationRunId: "attempt", result: "pass", claimable: true,
    reportPath: "g2.json", automaticWake: { result: "pass", claimable: true, automaticWakeTested: true, reportPath: "automatic.json" },
    completedAt: "2026-09-20T20:20:00Z" };
  assert.equal(hasCurrentG2Release(pass, "current"), true);
  assert.equal(hasCurrentG2Release(pass, "other"), false);
  assert.equal(hasCurrentG2Release({ ...pass, result: "blocked", claimable: false }, "current"), false);
  assert.equal(hasCurrentG2Release({ ...pass, result: "blocked", claimable: false, releasedBy: "g2-owner", releaseG3: true }, "current"), false);
  assert.equal(hasCurrentG2Release({ ...pass, automaticWake: undefined }, "current"), false);
});
