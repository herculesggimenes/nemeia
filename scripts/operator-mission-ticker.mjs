import { Timestamp } from "spacetimedb";

// A host timer for the existing operator-only reducer, not an agent scheduler.
// It inspects authorized missions directly, including those with no executions.
export function startOperatorMissionTicker(operator, { intervalMs = 250 } = {}) {
  let stopped = false;
  let timer;
  let pending = Promise.resolve();
  const calls = new Map();
  const errors = [];
  const tick = async () => {
    try {
      const snapshot = await operator.readSnapshot();
      for (const mission of snapshot.assignedMissions) {
        if (stopped) break;
        if (!["Active", "Closing"].includes(mission.state.tag)) continue;
        await operator.callReducer("reconcileMission", { missionId: mission.id });
        calls.set(mission.id, (calls.get(mission.id) ?? 0) + 1);
      }
    } catch (error) {
      errors.push(error.message);
      if (errors.length > 16) errors.shift();
    } finally {
      if (!stopped) timer = setTimeout(() => { pending = tick(); }, intervalMs);
    }
  };
  timer = setTimeout(() => { pending = tick(); }, intervalMs);
  return {
    calls,
    errors,
    close: async () => { stopped = true; clearTimeout(timer); await pending; },
  };
}

export async function qualifyOperatorMissionExpiry(operator, { unitId = "entity-go2-001" } = {}) {
  const missionId = `operator-expiry-no-execution-${process.pid}-${Date.now()}`;
  const ticker = startOperatorMissionTicker(operator, { intervalMs: 25 });
  try {
    await operator.callReducer("createMission", {
      missionId,
      spec: {
        description: "operator timer expiry without sensor writes or execution rows",
        template: undefined,
        objectives: [{ id: "expire-without-action", description: "expire without an action", dependsOn: [], optional: false,
          criterion: { tag: "Observed", value: { entityId: unitId, facet: { tag: "Semantic" }, maxAgeMs: 120_000 } } }],
        deadlineAt: Timestamp.fromDate(new Date(Date.now() + 100)),
      },
    });
    let terminal;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const snapshot = await operator.readSnapshot();
      terminal = snapshot.assignedMissions.find((row) => row.id === missionId);
      if (terminal && ["Failed", "Succeeded", "Cancelled"].includes(terminal.state.tag)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    const snapshot = await operator.readSnapshot();
    const noExecutionRows = !snapshot.relevantExecutions.some((row) => row.missionId === missionId);
    return {
      missionId, reconcileCalls: ticker.calls.get(missionId) ?? 0,
      terminalState: terminal?.state.tag, noExecutionRows,
      expiredWithoutExecution: terminal?.state.tag === "Failed" && noExecutionRows,
      diagnostics: [...ticker.errors],
    };
  } finally { await ticker.close(); }
}
