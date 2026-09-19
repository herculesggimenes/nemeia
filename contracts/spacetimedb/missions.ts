import { t, type Infer } from "spacetimedb";
import { PackagePin } from "./values.ts";

// region mission-criteria
export const ObjectiveCriterion = t.enum("ObjectiveCriterion", {
  observed: t.object("ObservedCriterion", {
    entityId: t.string(), // bound existing entity; a label is not an identity
    facet: t.enum("ObservedFacet", ["geometry", "semantic"]), // requires this measured/derived facet, not proof its label is true
    maxAgeMs: t.u32(), // positive maximum acquisition age when credit is granted
  }),
  approached: t.object("ApproachedCriterion", {
    actorId: t.string(), targetId: t.string(), // exact installed approach@1 participants
    standoffM: t.f64(), // exact requested goal; success uses the binding's measured tolerance
  }),
}); // first slice: two installed validators; no arbitrary expression language or model-written success code
export const ObjectiveSpec = t.object("ObjectiveSpec", {
  id: t.string(), // unique within the immutable mission specification
  description: t.string(), // explanation only; the criterion determines credit
  dependsOn: t.array(t.string()), // all named objectives must be credited first; no cycles
  optional: t.bool(), // excluded from mission completion; cannot gate a required objective
  criterion: ObjectiveCriterion, // a milestone supported by retained domain evidence
});
export type ObjectiveSpec = Infer<typeof ObjectiveSpec>;
// endregion

// region mission-spec
export const MissionSpec = t.object("MissionSpec", {
  goal: t.string(), // authorized human intent; not sufficient by itself to prove completion
  template: t.option(PackagePin), // optional immutable authoring provenance; inline spec remains authoritative
  actorIds: t.array(t.string()), // allowed actors, not a reservation or a delegation of credentials
  objectives: t.array(ObjectiveSpec), // 1–32 bound milestones; at least one required; validated dependency graph
  maxLinearMps: t.f64(), // positive mission cap; admission pins the tighter installed/mission limit
  maxRunMs: t.u32(), // positive per-execution cap, not the whole mission's duration
  deadlineAt: t.option(t.timestamp()), // optional absolute world-clock deadline; never authorizes motion
}); // immutable after creation; retry or changed intent creates a new mission ID, not a new Run abstraction
export type MissionSpec = Infer<typeof MissionSpec>;
export const MissionState = t.enum("MissionState", [
  "active", "closing", "succeeded", "failed", "cancelled",
]); // closing blocks new actions while outstanding physical attempts are safely reconciled
export const MissionOutcome = t.enum("MissionOutcome", ["succeeded", "failed", "cancelled"]);
// endregion

// region mission-evidence
export const MissionEvidence = t.enum("MissionEvidence", {
  observation: t.object("MissionObservation", { observationId: t.string() }), // reducer loads authorized retained observation and supplied facet
  execution: t.object("MissionExecution", { executionId: t.string() }), // reducer loads matching successful execution and measured result
}); // references, never caller-supplied counters or a boolean claiming success
export type MissionEvidence = Infer<typeof MissionEvidence>;
// endregion

// region mission-graph
export const inspectionSpec: MissionSpec = {
  goal: "Approach the known backpack, then acquire fresh geometry",
  template: undefined, actorIds: ["go2-01"],
  maxLinearMps: 0.25, maxRunMs: 15_000, deadlineAt: undefined,
  objectives: [
    { id: "geometry", description: "Acquire target geometry", dependsOn: [], optional: false,
      criterion: { tag: "observed", value: { entityId: "backpack-A", facet: { tag: "geometry" }, maxAgeMs: 500 } } },
    { id: "semantics", description: "Acquire target hypotheses", dependsOn: [], optional: false,
      criterion: { tag: "observed", value: { entityId: "backpack-A", facet: { tag: "semantic" }, maxAgeMs: 2_000 } } },
    { id: "approach", description: "Reach the measured standoff", dependsOn: ["geometry", "semantics"], optional: false,
      criterion: { tag: "approached", value: { actorId: "go2-01", targetId: "backpack-A", standoffM: 0.8 } } },
    { id: "resample", description: "Acquire geometry after arrival", dependsOn: ["approach"], optional: false,
      criterion: { tag: "observed", value: { entityId: "backpack-A", facet: { tag: "geometry" }, maxAgeMs: 500 } } },
  ],
}; // geometry and semantics can progress in parallel; resample needs new evidence after approach credit
// These are outcome dependencies, not navigation commands or a model's internal plan.
// endregion
