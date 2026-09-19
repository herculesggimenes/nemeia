// Checked design examples, not a new tracing protocol or an initialized SDK.

// region attributes
export interface DiagnosticAttributes {
  "nemeia.world_ref": string; // approved opaque/pseudonymous correlation value; no human-readable location
  "nemeia.observation_ref"?: string; // link perception to committed evidence without copying sensor data
  "nemeia.context_ref"?: string; // identify the exact decision context held in the authorized audit store
  "nemeia.execution_ref"?: string; // correlate attempts; never use a trace ID as an idempotency key
  "nemeia.model_version"?: string; // qualified checkpoint/provider version from trusted configuration
  "nemeia.question_version"?: string; // tested decision definition, not its prompt text
  "nemeia.input_age_ms"?: number; // acquisition-to-consumption age, not just inference duration
  "nemeia.candidate_count"?: number; // bounded numeric summary, not a serialized world
  "nemeia.outcome"?: "ok" | "abstain" | "rejected" | "failed" | "unknown"; // controlled vocabulary
} // optional allowlisted span attributes; OTel owns trace IDs, spans, timing, links and export
// endregion

// region defaults
export const laminarInitialization = {
  instrumentModules: {}, // Laminar TS option: disable automatic library instrumentation initially
  disableBatch: false, // export asynchronously; no flush on a robot command or reducer path
} as const;
export const decisionSpanOptions = {
  name: "decision.typesafe", // stable operation name; do not interpolate task text or user identifiers
  spanType: "DEFAULT", // non-LLM decision work; use LLM spans only for actual LLM calls
  ignoreInput: true, // do not capture DecisionContext, prompts or function arguments
  ignoreOutput: true, // do not capture raw provider responses
} as const; // options for Laminar.initialize(...) and observe(...), not an active connection
// observe() still records exceptions; these options alone are NOT a complete privacy boundary.
// Sanitize exception events, status text, URLs and attributes before export, including child spans.
// Credentials are configured only on trusted workers/collectors, never on this static page.
// endregion

// region correlation
export const correlationExample = {
  "nemeia.world_ref": "world-demo",
  "nemeia.observation_ref": "observation-1",
  "nemeia.context_ref": "decision-context-1",
  "nemeia.execution_ref": "execution-1",
  "nemeia.model_version": "jev-1.13.0",
  "nemeia.question_version": "target-match@1",
  "nemeia.candidate_count": 1,
  "nemeia.outcome": "ok",
} satisfies DiagnosticAttributes; // illustrative aliases for the end-to-end example, not real telemetry
// A new retry span may reference execution-1; it must not allocate a new physical attempt.
// W3C traceparent/tracestate propagate only across trusted service boundaries via OTel.
// Subscription callbacks do not automatically inherit the writer's trace context.
// Start a consumer span; correlate by these refs, or add an OTel link when context is available.
// Never infer that a received row means the physical action ran or completed.
// endregion
