import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";

/** Mutates only new UI missions and the coordinated simulator Unit grant. */
export async function verifyOperatorFlow({ page, context, connect, handoff, output, networkPolicy }) {
  const suffix = randomUUID().slice(0, 8);
  const first = `E7 review ${suffix}`;
  const second = `E7 concurrent ${suffix}`;
  console.log(`RUN native E7 ${suffix}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  const reviewMissionId = await createMission(page, first);
  await page.getByLabel("Agent identity", { exact: true }).fill(handoff.agentId);
  await page.getByRole("button", { name: "Assign participant", exact: true }).click();
  await expect(page.locator("main header").filter({ has: page.getByRole("heading", { name: first, exact: true }) })).toContainText("revision 2");
  await page.getByLabel("Unit identity", { exact: true }).fill(handoff.unitId);
  await page.getByLabel("Allowed action names", { exact: true }).fill("navigate@1");
  const expiry = new Date(Date.now() + 60 * 60 * 1000);
  const localExpiry = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await page.getByLabel("Grant expiry", { exact: true }).fill(localExpiry);
  const oldGrant = await page.getByTestId("unit-grant-state").innerText();
  await page.getByRole("button", { name: "Grant authority", exact: true }).click();
  await expect(page.getByTestId("unit-grant-state")).not.toHaveText(oldGrant);
  await expect(page.getByTestId("unit-grant-state")).toContainText(handoff.agentId);
  await expect(page.getByTestId("unit-grant-state")).toContainText("navigate@1");

  const selectedEvidence = await selectFixtureEvidence(page);
  const checkbox = page.getByRole("checkbox", { name: `Cite ${selectedEvidence.observationId}`, exact: true });
  await checkbox.check();
  const other = await context.newPage();
  await connect(other);
  const concurrentMissionId = await createMission(other, second);
  await other.getByLabel("Agent identity", { exact: true }).fill(handoff.agentId);
  await other.getByRole("button", { name: "Assign participant", exact: true }).click();
  await expect(other.locator("header").filter({ has: other.getByRole("heading", { name: second, exact: true }) })).toContainText("revision 2");
  await expect(page.getByRole("button", { name: new RegExp(second) })).toBeVisible();
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "Refresh world subscription", exact: true }).click();
  await expect(page.getByText("authenticated", { exact: true })).toBeVisible();
  await expect(checkbox).toBeChecked();
  await page.getByRole("button", { name: "Add candidate evidence", exact: true }).click();
  await rejectCandidate(page, `Need another angle ${suffix}`);
  await expect(page.getByTestId("mission-objectives")).toContainText("0 accepted");
  await proposeFixture(page, selectedEvidence);
  await rejectCandidate(page, `Confirm the label ${suffix}`);
  await expect(page.getByText(`Need another angle ${suffix}`, { exact: true })).toBeVisible();
  await selectMission(page, second);
  await expect(page.getByText(`Need another angle ${suffix}`, { exact: true })).toHaveCount(0);
  await selectMission(page, first);
  await expect(page.getByText(`Need another angle ${suffix}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Confirm the label ${suffix}`, { exact: true })).toBeVisible();
  console.log("PASS create, same-Agent multi-mission assignment, grant, stable evidence selection and persistent rejection history");

  await page.setViewportSize({ width: 390, height: 844 });
  await proposeFixture(page, selectedEvidence);
  await page.getByRole("button", { name: "Accept evidence", exact: true }).click();
  await expect(page.getByText("Accepted proof from World", { exact: true })).toBeVisible();
  await expect(page.getByTestId("mission-objectives")).toContainText("1 accepted");
  const reviewer = await page.getByTestId("operator-mission-board").getAttribute("data-operator-identity");
  assert.match(reviewer, /^[0-9a-f]{64}$/u);
  await expect(page.getByTestId("finding-review")).toContainText(`reviewed by ${reviewer}`);
  await expect(page.getByTestId("finding-review")).toContainText(selectedEvidence.observationId);
  await page.getByRole("button", { name: "Reconcile durable state", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(first) })).toContainText("succeeded");
  await expect(page.getByTestId("finding-review")).not.toContainText("operator decision required");
  await expect(page.getByTestId("finding-review")).toContainText("Candidate review is closed · mission succeeded.");
  assert.equal(await page.getByTestId("finding-review").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, "Accepted review proof must fit mobile width");
  await page.screenshot({ path: `${output}/review-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${output}/review-1440.png`, fullPage: true });
  const conflict = await verifyStaleConflict({ context, connect, handoff, observer: other, description: `E7 conflict ${suffix}`, networkPolicy });
  await other.close();
  await verifyDisconnect({ context, connect, description: first, networkPolicy });
  console.log("PASS native accept with connected identity, durable proof, mobile review, revision conflict and disconnect/reconnect");
  console.log(JSON.stringify({ missions: [{ id: reviewMissionId, description: first, state: "succeeded" }, { id: concurrentMissionId, description: second, revision: "2" }], selectedEvidence, reviewer, conflict }));
}

async function createMission(page, description) {
  await page.getByRole("button", { name: "Create mission", exact: true }).click();
  await page.getByLabel("Mission description", { exact: true }).fill(description);
  await page.getByLabel("First objective", { exact: true }).fill("Review the retained synthetic object evidence");
  await page.getByRole("button", { name: "Save to world", exact: true }).click();
  await selectMission(page, description);
  return (await page.locator("header").filter({ has: page.getByRole("heading", { name: description, exact: true }) }).locator("p").first().innerText()).split(" · ")[0];
}

async function selectMission(page, description) {
  await page.getByRole("button", { name: new RegExp(description) }).click();
  await expect(page.getByRole("heading", { name: description, exact: true })).toBeVisible();
}

async function selectFixtureEvidence(page) {
  const select = page.getByLabel("Observed object", { exact: true });
  const value = await select.locator("option").evaluateAll((options) => options.find((option) => option.textContent.includes("synthetic-fixture"))?.value);
  assert.ok(value, "Authorized synthetic object must be selectable");
  await select.selectOption(value);
  const checkbox = page.getByRole("checkbox", { name: /^Cite /u }).first();
  await expect(checkbox).toBeVisible();
  const label = await checkbox.getAttribute("aria-label");
  assert.ok(label?.startsWith("Cite "));
  return { entityId: value, observationId: label.slice(5) };
}

async function proposeFixture(page, selectedEvidence) {
  await page.getByLabel("Observed object", { exact: true }).selectOption(selectedEvidence.entityId);
  await page.getByRole("checkbox", { name: `Cite ${selectedEvidence.observationId}`, exact: true }).check();
  await page.getByRole("button", { name: "Add candidate evidence", exact: true }).click();
}

async function rejectCandidate(page, reason) {
  await page.getByRole("textbox", { name: /^Feedback for candidate:/u }).fill(reason);
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
}

async function verifyStaleConflict({ context, connect, handoff, observer, description, networkPolicy }) {
  const stalePage = await context.newPage();
  let hold = false;
  const deferred = [];
  await stalePage.routeWebSocket((url) => networkPolicy.allowSocket(url) && url.pathname.endsWith("/subscribe"), (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (hold) { deferred.push(() => server.send(message)); }
      else { server.send(message); }
    });
  });
  await connect(stalePage);
  const missionId = await createMission(stalePage, description);
  await selectMission(observer, description);
  await stalePage.getByLabel("Agent identity", { exact: true }).fill(handoff.agentId);
  await observer.getByLabel("Agent identity", { exact: true }).fill(handoff.agentId);
  hold = true;
  await stalePage.getByRole("button", { name: "Assign participant", exact: true }).click();
  await expect.poll(() => deferred.length).toBeGreaterThan(0);
  await observer.getByRole("button", { name: "Assign participant", exact: true }).click();
  await expect(observer.locator("header").filter({ has: observer.getByRole("heading", { name: description, exact: true }) })).toContainText("revision 2");
  hold = false;
  for (const send of deferred) { send(); }
  const notice = stalePage.getByTestId("operator-status-notice");
  await expect(notice).toContainText("World operation failed");
  const rejection = await notice.innerText();
  // The current module throws a plain Error for revision conflicts. Native
  // SpacetimeDB can expose that as an opaque fatal-error response; never invent
  // a domain code. Prove the stale request failed and the committed revision
  // did not advance, while preserving the actual error in the report.
  assert.match(rejection, /roster_revision_conflict|The instance encountered a fatal error\./u);
  await expect(stalePage.locator("header").filter({ has: stalePage.getByRole("heading", { name: description, exact: true }) })).toContainText("revision 2");
  await expect(stalePage.getByText("authenticated", { exact: true })).toBeVisible();
  await stalePage.getByRole("button", { name: "Refresh world subscription", exact: true }).click();
  await expect(stalePage.getByText("authenticated", { exact: true })).toBeVisible();
  await expect(stalePage.locator("header").filter({ has: stalePage.getByRole("heading", { name: description, exact: true }) })).toContainText("revision 2");
  await stalePage.close();
  return { missionId, description, confirmedRevision: "2", rejectedRevision: "1", rejection };
}

async function verifyDisconnect({ context, connect, description, networkPolicy }) {
  const disconnected = await context.newPage();
  let closeSocket;
  await disconnected.routeWebSocket((url) => networkPolicy.allowSocket(url) && url.pathname.endsWith("/subscribe"), (socket) => {
    const server = socket.connectToServer();
    closeSocket = async () => { await socket.close(); await server.close(); };
  });
  await connect(disconnected);
  await selectMission(disconnected, description);
  await closeSocket();
  await expect(disconnected.getByTestId("operator-status-notice")).toContainText("World subscription disconnected");
  await expect(disconnected.getByRole("button", { name: "Create mission", exact: true })).toBeDisabled();
  await expect(disconnected.getByTestId("world-evidence")).toContainText("stale");
  await expect(disconnected.getByTestId("mission-executions")).toContainText("Browser stop is unavailable");
  await disconnected.getByRole("button", { name: "Refresh world subscription", exact: true }).click();
  await expect(disconnected.getByText("authenticated", { exact: true })).toBeVisible();
  await expect(disconnected.getByText("Accepted proof from World", { exact: true })).toBeVisible();
  await disconnected.close();
}
