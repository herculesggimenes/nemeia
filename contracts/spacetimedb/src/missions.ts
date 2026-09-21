import { t, type Infer } from "spacetimedb/server";
import { PackagePin } from "./values.ts";

export const ObjectiveCriterion = t.enum("ObjectiveCriterion", {
  observed: t.object("ObservedCriterion", {
    entityId: t.string(),
    facet: t.enum("ObservedFacet", ["geometry", "semantic"]),
    maxAgeMs: t.u32(),
  }),
  approached: t.object("ApproachedCriterion", {
    targetId: t.string(),
    standoffM: t.f64(),
  }),
  located: t.object("LocatedCriterion", {
    description: t.string(),
  }),
});
export type ObjectiveCriterion = Infer<typeof ObjectiveCriterion>;

export const ObjectiveSpec = t.object("ObjectiveSpec", {
  id: t.string(),
  description: t.string(),
  dependsOn: t.array(t.string()),
  optional: t.bool(),
  criterion: ObjectiveCriterion,
});
export type ObjectiveSpec = Infer<typeof ObjectiveSpec>;

export const MissionSpec = t.object("MissionSpec", {
  description: t.string(),
  template: t.option(PackagePin),
  objectives: t.array(ObjectiveSpec),
  deadlineAt: t.option(t.timestamp()),
});
export type MissionSpec = Infer<typeof MissionSpec>;

export const MissionState = t.enum("MissionState", [
  "active",
  "closing",
  "succeeded",
  "failed",
  "cancelled",
]);
export const MissionOutcome = t.enum("MissionOutcome", [
  "succeeded",
  "failed",
  "cancelled",
]);

export const MissionEvidence = t.enum("MissionEvidence", {
  observation: t.object("MissionObservation", {
    observationId: t.string(),
  }),
  execution: t.object("MissionExecution", {
    executionId: t.string(),
  }),
  finding: t.object("MissionFinding", {
    observationIds: t.array(t.string()),
    entityId: t.string(),
    reviewedBy: t.string(),
  }),
});
export type MissionEvidence = Infer<typeof MissionEvidence>;
