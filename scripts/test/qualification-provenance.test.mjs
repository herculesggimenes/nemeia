import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureQualificationProvenance, writeQualificationReport } from "../qualification-provenance.mjs";

test("fresh inventory records actual installed versions and hashes without credentials", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-provenance-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = await captureQualificationProvenance(directory);
  const bytes = await readFile(result.path);
  const inventory = JSON.parse(bytes);
  assert.equal(inventory.versions.node, process.versions.node);
  assert.equal(inventory.versions.eve, JSON.parse(await readFile(new URL("../../node_modules/eve/package.json", import.meta.url))).version);
  assert.match(inventory.schemaSourceSha256, /^[a-f0-9]{64}$/);
  assert.match(inventory.rootLockSha256, /^[a-f0-9]{64}$/);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), result.sha256);
  assert.equal((await stat(result.path)).mode & 0o777, 0o600);
  assert.doesNotMatch(bytes.toString(), /Bearer |NEMEIA_WORLD_TOKEN|spacetimedb_token/);
});

test("a new report links immutable inventory and cannot overwrite old proof", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-proof-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, "diagnostic.json");
  await writeQualificationReport(target, { gate: "test-only", result: "diagnostic", versions: {}, details: {} });
  const before = await readFile(target, "utf8");
  assert.ok(JSON.parse(before).details.qualificationProvenance.path);
  await assert.rejects(writeQualificationReport(target, { gate: "test-only", result: "replacement" }), { code: "EEXIST" });
  assert.equal(await readFile(target, "utf8"), before);
});
