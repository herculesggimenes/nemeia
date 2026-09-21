import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createBackpackFixture } from "../src/backpack-fixture.ts";

const adapterPath = process.env.NEMEIA_LOOPBACK_ADAPTER;

test("loopback-spacetimedb boundary negatives call the actual module and resource ports", { skip: !adapterPath }, async () => {
  const module = await import(pathToFileURL(adapterPath).href);
  assert.equal(typeof module.runNegativeBoundaryTests, "function", "adapter must expose actual module/gateway boundary tests");
  const result = await module.runNegativeBoundaryTests({
    modulePath: process.env.NEMEIA_WORLD_CLIENT_MODULE,
    uri: process.env.NEMEIA_SPACETIMEDB_URI,
    scopedIdentityFile: process.env.NEMEIA_SCOPED_IDENTITY_FILE,
    scopedIdentityFingerprint: process.env.NEMEIA_SCOPED_IDENTITY_FINGERPRINT,
    fixture: createBackpackFixture()
  });
  assert.equal(result.firstCallerAdmin, "denied");
  assert.equal(result.directResourceReferenceWrite, "denied");
  assert.equal(result.unqualifiedPhysicalEnablement, "denied");
});
