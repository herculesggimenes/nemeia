// Checked design examples, not a new tracing protocol or an initialized SDK.

// region attributes
export interface DiagnosticAttributes {
  "nemeia.world_ref": string; // approved opaque/pseudonymous correlation value; no human-readable location
  "nemeia.observation_ref"?: string; // link perception to committed evidence without copying sensor data
  "nemeia.context_ref"?: string; // identify the compiled context, with approved content captured in the trace
  "nemeia.step_ref"?: string; // correlate the inbox batch, context preparation and model call
  "nemeia.mission_ref"?: string; // durable mission context across clients, steps and physical attempts
  "nemeia.agent_ref"?: string; // logical decision-maker; independent of worker process and Unit
  "nemeia.unit_ref"?: string; // controllable entity selected for the execution
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
  ignoreInput: false, // capture the approved compiled context and model request, including authorized sensitive content
  ignoreOutput: false, // capture approved model/tool results, not just timings
} as const; // options for Laminar.initialize(...) and observe(...), not an active connection
export const metadataSpanOptions = {
  ...decisionSpanOptions, ignoreInput: true, ignoreOutput: true, // restricted mode when content capture is not authorized
} as const;
// Apply content options ONLY to reviewed functions with scoped, sanitized inputs and outputs.
// observe() also records exceptions; these options alone are NOT a complete privacy boundary.
// Remove credentials and unrelated private data across content, errors, URLs and child spans.
// Configure an approved destination, access restrictions, retention and content-size limits first.
// Credentials are configured only on trusted workers/collectors, never on this static page.
// endregion

// region correlation
export const correlationExample = {
  "nemeia.world_ref": "world-demo",
  "nemeia.observation_ref": "observation-1",
  "nemeia.context_ref": "decision-context-1",
  "nemeia.step_ref": "step-1",
  "nemeia.mission_ref": "mission-1",
  "nemeia.agent_ref": "navigator",
  "nemeia.unit_ref": "go2-01",
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
