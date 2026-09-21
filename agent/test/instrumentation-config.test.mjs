import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// Load the production declarations in isolated, credential-free processes so
// each case exercises import-time environment selection without module caches.
const probe = `
  import assert from "node:assert/strict";
  import { isInstrumentationDisabled, isInstrumentationProvider } from "eve/instrumentation";
  import { isOtelDeclaration, isOtelIntegration } from "eve/instrumentation/otel";
  import otel from "./instrumentation/otel.ts";
  import local from "./instrumentation/local.ts";
  import remote from "./instrumentation/agent-runs.ts";
  import lifecycle from "./instrumentation/world-runtime.ts";
  const contentPolicy = { emit: true, recordInputs: false, recordOutputs: false };
  assert.equal(isInstrumentationDisabled(remote), true);
  assert.equal(isInstrumentationProvider(lifecycle), true);
  assert.deepEqual(lifecycle.tracePolicy(), contentPolicy);
  assert.equal(typeof lifecycle.events["step.attempt.started"], "function");
  const disabled = process.env.EXPECT_OTEL_DISABLED === "true";
  assert.equal(isInstrumentationDisabled(otel), disabled);
  assert.equal(isInstrumentationDisabled(local), disabled || process.env.EVE_TRACES === "off");
  const declarations = [otel, local, remote, lifecycle].filter(isOtelDeclaration);
  assert.equal(declarations.length, disabled ? 0 : 1);
  if (!disabled) {
    for (const environment of ["development", "preview", "production"]) {
      for (const audience of ["public", "private", "unknown"]) {
        assert.deepEqual(otel.options.tracePolicy({ environment, audience }), contentPolicy);
      }
    }
    assert.equal(isOtelIntegration(local), process.env.EVE_TRACES !== "off");
  }
  // Canary input/output content never enters the metadata lifecycle sink.
  await lifecycle.events["step.attempt.started"]({
    type: "step.attempt.started",
    scope: { sessionId: "session-test", turnId: "turn-test", stepIndex: 0, attemptId: "attempt-test", attemptIndex: 0 },
    input: "Bearer synthetic-canary-never-export",
    output: "https://example.invalid/?sig=synthetic-canary",
  });
  await lifecycle.flush();
`;

for (const [name, overrides] of [
  ["default development retains one metadata-only OTel policy and local destination", { EVE_DEV: "1" }],
  ["preview explicitly disables the built-in remote destination", { VERCEL_ENV: "preview" }],
  ["production explicitly disables the built-in remote destination", { VERCEL_ENV: "production" }],
  ["local-noop disables all OTel declarations while preserving lifecycle instrumentation", { NEMEIA_INSTRUMENTATION_MODE: "local-noop", EXPECT_OTEL_DISABLED: "true" }],
  ["SDK-disabled mode selects public disabled slots independently of local-noop", { OTEL_SDK_DISABLED: "true", EXPECT_OTEL_DISABLED: "true" }],
  ["packaging environment cannot re-enable an OTel provider through a default destination", { OTEL_SDK_DISABLED: "true", EVE_TRACES: "off", NEMEIA_INSTRUMENTATION_MODE: "local-noop", EXPECT_OTEL_DISABLED: "true" }],
  ["disabling local storage keeps the single metadata-only policy", { EVE_TRACES: "off" }],
]) {
  test(name, () => {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe], {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH, NODE_ENV: "production", EVE_TELEMETRY_DISABLED: "1", ...overrides },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(output, "", "instrumentation does not print payloads or canary content");
  });
}
