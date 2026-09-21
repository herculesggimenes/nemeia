import { createQualificationReport } from "./qualification-report.ts";
import { createBackpackFixture } from "./backpack-fixture.ts";

export async function runEveLoopbackQualification({ runtime, fixture = createBackpackFixture() }) {
  if (typeof runtime.runG2SlowStep !== "function") {
    throw new Error("Runtime adapter must expose runG2SlowStep for actual Eve lifecycle qualification");
  }
  const outcome = await runtime.runG2SlowStep({
    fixture,
    model: async ({ waitForWorldChange }) => {
      await waitForWorldChange();
      return { kind: "injected-fake-model", choice: "inspect-current-candidate" };
    }
  });
  return {
    outcome,
    report: createQualificationReport({
      gate: "G2",
      mode: runtime.mode,
      fixtureDigest: fixture.fixtureDigest,
      checks: {
        actualEveLifecycle: outcome.actualEveLifecycle === true,
        injectedModel: outcome.injectedModel === true,
        worldChangedDuringThinking: outcome.worldChangedDuringThinking === true,
        actualGeneratedWorldSubscription: outcome.actualGeneratedWorldSubscription === true,
        usefulWorldContext: outcome.usefulWorldContext === true,
        authenticatedJustBashRead: outcome.authenticatedJustBashRead === true,
        nextStepFresh: outcome.nextStepFresh === true,
        sameStepPinned: outcome.sameStepPinned === true,
        revokedAccessDenied: outcome.revokedAccessDenied === true,
      },
      evidence: [
        "eve-step-start",
        "generated-world-subscription",
        "world-change-during-thinking",
        "authenticated-just-bash-world-read",
        "same-step-pinned-context",
        "next-step-fresh-context",
        "revoked-access-denied",
      ],
      details: { outcome },
    })
  };
}
