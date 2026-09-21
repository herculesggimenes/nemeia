/** Admin-only fixture setup. Consumers receive the distinct operator client,
 * never the publisher identity. This does not authorize physical adapters. */
export async function bootstrapSimulationOperator({ admin, operator, unitId, agentId, seedGrant = false }) {
  await admin.callReducer("configureMember", {
    identity: await operator.getIdentity(), role: { tag: "WorldOperator" },
    unitId: undefined, producerSession: undefined, package: undefined,
  });
  const end = Date.now() + 5000;
  while ((await operator.readSnapshot()).readiness[0]?.role !== "world_operator") {
    if (Date.now() > end) throw new Error("scoped World Operator view did not become ready");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  const snapshot = await admin.readSnapshot();
  const binding = snapshot.relevantActionBindings.find((row) => row.unitId === unitId && row.actionName === "navigate@1");
  if (binding && binding.policy.mode.tag !== "Simulation") throw new Error("software fixture requires a Simulation binding");
  if (!binding) await admin.callReducer("setActionBinding", {
    unitId, actionName: "navigate@1", version: 1n,
    policy: {
      executor: { name: "nemeia-no-motion", version: "1", sha256: "a".repeat(64) },
      mode: { tag: "Simulation" }, maxEvidenceAgeMs: 120_000,
      maxLinearMps: 0.2, maxRunMs: 10_000, toleranceM: 0.1,
    },
  });
  if (seedGrant) {
    const assignment = (await operator.readSnapshot()).relevantUnitAssignments.find((row) => row.unitId === unitId);
    await operator.callReducer("assignUnit", {
      unitId, agentId, expectedRevision: assignment?.revision ?? 0n,
      actionNames: ["navigate@1"], expiresAt: undefined,
    });
  }
}
