export type OperatorStateTone = "healthy" | "warning" | "neutral" | "error";

export function operatorStateTone(state: string): OperatorStateTone {
  if (["authenticated", "active", "succeeded", "accepted", "ready", "running"].includes(state)) { return "healthy"; }
  if (["stale", "closing", "connecting", "disconnected", "blocked"].includes(state)) { return "warning"; }
  if (["failed", "error", "forbidden"].includes(state)) { return "error"; }
  return "neutral";
}

export function reviewStatusLabel(missionState: string, pendingCandidates: number, acceptedFindings: number): string {
  if (missionState === "active" && pendingCandidates > 0) { return "operator decision required"; }
  return acceptedFindings > 0 ? "reviewed evidence" : "no pending review";
}
