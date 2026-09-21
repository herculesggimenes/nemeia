import { expect, type TestInfo } from "@playwright/test";
import { test, type QualificationRun } from "./support/qualification-fixture.js";

test("real full-system native operator qualification", async ({ qualification }, testInfo) => {
  test.setTimeout(1_200_000);
  await qualification.start();

  await test.step("Retain the map and evidence across restart", async () => {
    await qualification.waitForPhase("retain-map-and-evidence-across-restart");
    await attachSummary(qualification, testInfo, "G1", "map-and-evidence-after-restart.json");
  });

  await test.step("Pin the agent and verify fresh automatic wake", async () => {
    await qualification.waitForPhase("pin-agent-and-verify-fresh-wake");
    await attachSummary(qualification, testInfo, "G2", "agent-pin-and-fresh-wake.json");
    await attachSummary(qualification, testInfo, "automaticWake", "automatic-wake.json");
  });

  await test.step("Execute once and cancel safely", async () => {
    await qualification.waitForPhase("execute-once-and-cancel-safely");
    await attachSummary(qualification, testInfo, "G3", "execute-once-and-cancel.json");
  });

  await test.step("Create, assign, grant, and review a mission", async () => {
    await qualification.waitForPhase("create-assign-grant-and-review-mission");
    const summary = await attachSummary(qualification, testInfo, "E7", "create-assign-grant-and-review.json");
    expect(Object.values(summary.checks).every(Boolean)).toBe(true);
    await attachApprovedScreenshots(qualification, testInfo);
  });

  const result = await qualification.waitForCompletion();
  expect(result.result).toBe("pass");
});

async function attachSummary(qualification: QualificationRun, testInfo: TestInfo, gate: string, name: string) {
  const summary = await qualification.readSafeSummary(gate);
  expect(summary.result, `${gate} composition report must pass`).toBe("pass");
  expect(summary.claimable, `${gate} composition report must remain claimable`).toBe(true);
  expect(Object.keys(summary.checks).length, `${gate} must expose observed checks`).toBeGreaterThan(0);
  expect(Object.values(summary.checks).every(Boolean), `${gate} observed checks must all pass`).toBe(true);
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`),
    contentType: "application/json",
  });
  return summary;
}

async function attachApprovedScreenshots(qualification: QualificationRun, testInfo: TestInfo) {
  for (const name of ["readonly-1440.png", "readonly-evidence-1440.png", "readonly-390.png", "readonly-evidence-390.png", "review-390.png", "review-1440.png"]) {
    await testInfo.attach(`approved-${name}`, {
      path: await qualification.approvedScreenshotPath(name),
      contentType: "image/png",
    });
  }
}
