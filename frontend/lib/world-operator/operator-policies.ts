import type { OperatorMission, OperatorObjective } from "../../types/operator";

export function isEvidenceFresh(
  acquiredAt: string | null,
  maxAgeMs: number,
  now = Date.now(),
  clockErrorBoundMs = 0
): boolean {
  if (!acquiredAt) { return false; }
  const timestamp = Date.parse(acquiredAt);
  if (!Number.isFinite(timestamp)) { return false; }
  const age = now - timestamp;
  // The clock bound extends the maximum age only; a future acquisition is
  // never fresh. The operator surface uses the conservative zero-bound default.
  return age >= 0 && age <= maxAgeMs + Math.max(0, clockErrorBoundMs);
}

export function objectiveDependenciesReady(
  objective: OperatorObjective,
  acceptedObjectiveIds: ReadonlySet<string>,
  objectives: readonly OperatorObjective[] = []
): boolean {
  return objective.dependsOn.every((dependencyId) => {
    const dependency = objectives.find((candidate) => candidate.id === dependencyId);
    return dependency?.optional === true || acceptedObjectiveIds.has(dependencyId);
  });
}

export function missionReadyObjectives(mission: OperatorMission): OperatorObjective[] {
  const accepted = new Set(mission.objectives.filter((objective) => objective.state === "accepted").map((objective) => objective.id));
  return mission.objectives.filter((objective) => objective.state === "ready" && objectiveDependenciesReady(objective, accepted, mission.objectives));
}
