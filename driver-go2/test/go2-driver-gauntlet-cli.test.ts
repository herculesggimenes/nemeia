import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { run } from "../src/bin/go2-driver-gauntlet.ts";

test("go2-driver-gauntlet manifest emits the Go2 DriverManifest", () => {
  const result = run(["manifest"]);
  const manifest = JSON.parse(result.stdout);

  assert.equal(result.exitCode, 0);
  assert.equal(manifest.driver, "go2");
  assert.equal(manifest.safe_state.kind, "vendor:damp");
});

test("go2-driver-gauntlet report signs measured D1-D7 outcomes", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-go2-gauntlet-"));
  try {
    const outcomesPath = join(dir, "outcomes.json");
    const privateKeyPath = join(dir, "key.pem");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(outcomesPath, JSON.stringify(passingOutcomes()), "utf8");
    writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), "utf8");

    const result = run([
      "report",
      "--outcomes",
      outcomesPath,
      "--private-key",
      privateKeyPath,
      "--generated-at",
      "2026-07-07T17:00:00.000Z"
    ]);
    const report = JSON.parse(result.stdout);

    assert.equal(result.exitCode, 0);
    assert.equal(report.result, "pass");
    assert.equal(report.package, "driver:go2@0.2.1");
    assert.match(report.signature, /^ed25519:/);
    assert.equal(verifyCanonicalJson(report, publicKey), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("go2-driver-gauntlet report refuses missing outcomes path", () => {
  const result = run(["report"]);
  const error = JSON.parse(result.stderr);

  assert.equal(result.exitCode, 1);
  assert.equal(error.error_code, "OUTCOMES_REQUIRED");
});

function passingOutcomes() {
  return {
    D1: { result: "pass", evidence_refs: ["artifact:d1"], measurements: { max_entry_ms: 180 } },
    D2: { result: "pass", evidence_refs: ["artifact:d2"] },
    D3: { result: "pass", evidence_refs: ["artifact:d3"], measurements: { total_loss_within_ms: 260 } },
    D4: { result: "pass", evidence_refs: ["artifact:d4"], measurements: { max_entry_ms: 210 } },
    D5: { result: "pass", evidence_refs: ["artifact:d5"] },
    D6: { result: "pass", evidence_refs: ["artifact:d6"] },
    D7: { result: "pass", evidence_refs: ["artifact:d7"] }
  };
}
