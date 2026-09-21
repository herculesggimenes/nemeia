import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("local software CI is read-only, separately provisioned, and uses real npm commands", async () => {
  const text = await readFile(new URL("../../.github/workflows/software.yml", import.meta.url), "utf8");
  const workflow = parse(text);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const steps = workflow.jobs.software.steps;
  assert.equal(steps.find((step) => step.uses?.startsWith("actions/setup-node@"))?.with["node-version"], "24.19.0");
  assert.equal(steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with["persist-credentials"], false);
  const commands = steps.filter((step) => step.run);
  assert.ok(commands.every((step) => step["timeout-minutes"] > 0));
  assert.ok(commands.some((step) => step.run === "npm run setup:software"));
  assert.ok(commands.some((step) => step.run === "npm run check"));
  assert.equal(commands.filter((step) => step.run === "npm run check").length, 1);
  assert.equal(commands.some((step) => step.run === "npm run qualify:software"), false);
  const e2eStep = commands.find((step) => step.run === "npm run check");
  assert.equal(e2eStep?.name, "Full-system Playwright E2E flow");
  assert.equal(e2eStep?.["timeout-minutes"], 35);
  assert.doesNotMatch(text, /secrets\.|upload-artifact|npm check|check:legacy/);
});
