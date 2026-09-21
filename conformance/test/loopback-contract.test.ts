import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createBackpackFixture } from "../src/backpack-fixture.ts";
import { runLoopbackBackpackQualification } from "../src/backpack-harness.ts";

const adapterPath = process.env.NEMEIA_LOOPBACK_ADAPTER;

test("loopback-spacetimedb backpack qualification uses the real adapter when configured", { skip: !adapterPath }, async () => {
  const module = await import(pathToFileURL(adapterPath).href);
  assert.equal(typeof module.createLoopbackAdapter, "function");
  const world = await module.createLoopbackAdapter({
    modulePath: process.env.NEMEIA_WORLD_CLIENT_MODULE,
    uri: process.env.NEMEIA_SPACETIMEDB_URI,
    scopedIdentityFile: process.env.NEMEIA_SCOPED_IDENTITY_FILE,
    scopedIdentityFingerprint: process.env.NEMEIA_SCOPED_IDENTITY_FINGERPRINT
  });
  try {
    const result = await runLoopbackBackpackQualification({ world, fixture: createBackpackFixture() });
    assert.equal(result.report.mode, "loopback-spacetimedb");
    assert.equal(result.report.result, "pass");
    assert.equal(result.report.claimable, true);
  } finally {
    await world.close();
  }
});
