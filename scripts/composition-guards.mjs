// Orchestration guards, not domain authorization. Rows come from the actual
// authorized generated subscription; only module reducers change their state.
export function assertNoPendingExecutions(snapshot, unitId) {
  if (!Array.isArray(snapshot.relevantExecutions)) throw new Error("execution preflight requires the generated subscription");
  const pending = snapshot.relevantExecutions.filter((row) => row.unitId === unitId &&
    !["Succeeded", "Cancelled", "Failed"].includes(row.state?.tag));
  if (pending.length) {
    throw new Error(`G3 preflight: prior executions require lifecycle-safe closure before the controller starts: ${pending.map((row) => `${row.id}:${row.state?.tag ?? "unknown"}`).join(", ")}`);
  }
  return { previousExecutionsTerminal: true, retainedTerminalExecutionIds: snapshot.relevantExecutions
    .filter((row) => row.unitId === unitId).map((row) => row.id) };
}

export function hasCurrentG2Release(marker, runDirectory) {
  return marker?.runDirectory === runDirectory && marker?.gate === "G2" &&
    marker.schemaVersion === 2 && typeof marker.qualificationRunId === "string" &&
    typeof marker.completedAt === "string" && marker.result === "pass" && marker.claimable === true &&
    marker.automaticWake?.result === "pass" && marker.automaticWake?.claimable === true &&
    marker.automaticWake?.automaticWakeTested === true &&
    typeof marker.reportPath === "string" && typeof marker.automaticWake.reportPath === "string";
}
