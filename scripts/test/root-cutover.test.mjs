import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const conformance = JSON.parse(readFileSync(new URL("../../conformance/package.json", import.meta.url), "utf8"));

test("root defaults select software checks, packaging and native loopback composition", () => {
  assert.equal(root.scripts.check, "npm run check:software && npm run check:eve:packaging && npm run check:frontend:native-guard");
  assert.equal(root.scripts.dev, "npm run dev:ui:loopback");
  assert.equal(root.scripts["qualify:loopback"], "npm run qualify:local-simulation");
});

test("prototype workspace bins and old conformance drill are not default software paths", () => {
  assert.deepEqual(root.workspaces, ["contracts/spacetimedb", "world-client", "world-resources", "perception", "agent", "agent/eve-eval-fixture", "local-controller", "conformance", "frontend"]);
  assert.doesNotMatch(conformance.scripts.check, /gate1-sim-drill/);
  assert.doesNotMatch(conformance.scripts["check:mock"], /gate1-sim-drill/);
  assert.match(conformance.scripts["check:legacy"], /gate1-sim-drill/);
});
