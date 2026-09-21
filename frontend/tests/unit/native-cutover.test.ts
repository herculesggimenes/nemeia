import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertNativeCutover, importsOf, isRetiredModule, retiredProbes } from "../../scripts/native-cutover-policy.mjs";

test("every app route and transitive import is free of legacy startup; only native byte routes remain", () => {
  const result = assertNativeCutover();
  assert.ok(result.modules > 20, "Audit must traverse components and server helpers, not only pages");
  assert.equal(result.handlers.length, 2);
});

test("cutover import audit covers reexports, dynamic imports and require; computed imports fail closed", () => {
  assert.deepEqual(importsOf('import "./a"; export { x } from "./b"; import("./c"); require("./d");'), ["./a", "./b", "./c", "./d"]);
  assert.throws(() => importsOf("import(userPath)"), /Computed runtime import/u);
  for (const path of ["../../lib/robots/standard/robot-runtime", "components/world/world-panel", "@nemeia/world-runtime", "../workbench/mission-cockpit-panel"]) {
    assert.equal(isRetiredModule(path), true);
  }
  assert.equal(isRetiredModule("lib/world-operator/native-client.ts"), false);
});

test("retirement probes are fixed unauthenticated paths, with no host or command payload", () => {
  assert.equal(retiredProbes.length, 8);
  for (const probe of retiredProbes) {
    assert.equal(probe.length, 2);
    assert.ok(probe[1].startsWith("/api/"));
    assert.equal(probe[1].includes("?"), false);
  }
});

test("smoke artifacts cannot clean retained native qualification evidence", () => {
  const config = readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8");
  assert.match(config, /outputDir: "\.\/test-results\/smoke"/u);
  assert.match(config, /trace: "off"/u);
  assert.match(config, /video: "off"/u);
});
