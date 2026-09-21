import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { verifyOperatorFlow } from "./native-ui-flow.mjs";
import { createNativeNetworkPolicy, installNativeNetworkFence } from "./native-ui-safety.mjs";
import { assertNativeCutover, verifyRetiredEndpoints } from "./native-cutover-policy.mjs";

const cutover = process.argv.includes("--cutover");
assertNativeCutover();
assert.ok(!cutover || !process.argv.includes("--mutate"), "Cutover verification is read-only");

const handoffPath = fileURLToPath(new URL("../../.artifacts/qualification/current-handoff.json", import.meta.url));
assert.equal(statSync(handoffPath).mode & 0o777, 0o600);
const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
assert.equal(handoff.available, true, "Integration fixture must be held and available");
assert.equal(new URL(handoff.uri).hostname, "127.0.0.1");
assert.equal(statSync(handoff.operatorTokenFile).mode & 0o777, 0o600);
const token = readFileSync(handoff.operatorTokenFile, "utf8").trim();
const baseURL = process.env.NEMEIA_UI_URL ?? "http://127.0.0.1:5183";
assert.equal(new URL(baseURL).hostname, "127.0.0.1");
const browser = await chromium.launch();
const errors = [];
const legacyRequests = [];
const blockedRequests = [];
const observationId = "observation-synthetic-standard-001";
const output = fileURLToPath(new URL(cutover ? "../test-results/native-e12" : "../test-results/native-e7", import.meta.url));
const context = await browser.newContext({ baseURL, serviceWorkers: "block", viewport: { width: 1440, height: 900 } });
const networkPolicy = createNativeNetworkPolicy({ baseURL, uri: handoff.uri, databaseName: handoff.databaseName });
await installNativeNetworkFence(context, networkPolicy, blockedRequests);
context.on("page", (target) => target.on("pageerror", () => errors.push("browser_runtime_error")));
context.on("request", (request) => {
  if (/\/api\/(robots|mission\/cockpit)/u.test(new URL(request.url()).pathname)) { legacyRequests.push("legacy_request"); }
});
const page = await context.newPage();

async function connect(target) {
  await target.goto("/");
  await expect(target).toHaveURL(/\/missions$/u);
  await expect(target.getByRole("link", { name: "Framework", exact: true })).toHaveCount(0);
  await target.getByLabel("Operator token").fill(token);
  await target.getByRole("button", { name: "Connect tab", exact: true }).click();
  await expect(target.getByText("authenticated", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(target.getByTestId("operator-mission-board")).toHaveAttribute("data-operator-role", "world_operator");
  await expect(target.getByRole("button", { name: "Create mission", exact: true })).toBeEnabled();
  assert.equal(await target.locator('input[type="password"]').count(), 0, "Token field must clear after connection");
}

async function post(path, data, authenticated = true) {
  return fetch(`${baseURL}/api/world/resources/${path}`, {
    method: "POST", body: JSON.stringify(data), signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

async function resourceChecks() {
  const resourceContext = { kind: "observation", observationId };
  assert.equal((await post("references", { context: resourceContext }, false)).status, 401);
  const references = await post("references", { context: resourceContext });
  assert.equal(references.status, 200, `reference read failed: ${references.status}`);
  const { references: refs } = await references.json();
  const resource = refs.find((ref) => ref.schema === "image/png");
  assert.ok(resource, "Committed observation must retain the fixture PNG");
  const input = { context: resourceContext, resource, offset: 0, length: Number(resource.byteLength) };
  const full = await post("read", input);
  assert.equal(full.status, 200);
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), resource.sha256);
  assert.equal(full.headers.get("content-type"), "image/png");
  assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.equal(full.headers.get("cache-control"), "private, no-store");
  const partial = await post("read", { ...input, length: 8 });
  assert.equal(partial.status, 206);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(0, 8));
  assert.equal((await post("read", { ...input, length: input.length + 1 })).status, 416);
  assert.equal((await post("read", { ...input, resource: { ...resource, sha256: "0".repeat(64) } })).status, 404);
  assert.equal((await post("read", { ...input, context: { kind: "observation", observationId: "not-authorized-context" } })).status, 404);
  assert.equal((await post("read", input, false)).status, 401);
  console.log("PASS native authorized PNG: digest, partial range, missing auth, wrong ref/context and invalid range");
}

async function layoutChecks() {
  const image = page.locator('[data-testid="world-evidence"] img').first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  assert.equal(await image.evaluate((element) => element.complete && element.naturalWidth > 0 && element.src.startsWith("blob:")), true);
  await expect(page.getByText("simulator · no motion", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Emergency Stop", exact: true })).toHaveCount(0);
  mkdirSync(output, { recursive: true });
  const checkViewport = async (viewport) => {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Page must not overflow horizontally");
    await expect(page.getByRole("heading", { name: "Mission board", exact: true })).toBeVisible();
    // Authenticated page only: no password value, trace, HAR, video or auth state.
    await page.screenshot({ path: `${output}/readonly-${viewport.width}.png`, fullPage: true });
    await image.scrollIntoViewIfNeeded();
    assert.equal(await page.getByTestId("world-evidence").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, "Evidence panel must fit its viewport");
    await page.screenshot({ path: `${output}/readonly-evidence-${viewport.width}.png`, fullPage: true });
  };
  await checkViewport({ width: 1440, height: 900 });
  await checkViewport({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Refresh world subscription", exact: true }).click();
  await expect(page.getByText("authenticated", { exact: true })).toBeVisible({ timeout: 20_000 });
  assert.deepEqual(errors, []);
  assert.deepEqual(legacyRequests, []);
  assert.deepEqual(blockedRequests, []);
  console.log("PASS native subscription, retained image decode, desktop/mobile layout and reconnect");
}

async function completedReviewChecks() {
  const description = process.env.NEMEIA_REVIEW_MISSION;
  if (!description) { return; }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button").filter({ hasText: description }).click();
  await expect(page.getByRole("heading", { name: description, exact: true })).toBeVisible();
  const review = page.getByTestId("finding-review");
  await expect(review).toContainText("Accepted proof from World");
  await expect(review).toContainText("reviewed evidence");
  await expect(review).toContainText("Candidate review is closed · mission succeeded.");
  await expect(review).not.toContainText("operator decision required");
  await expect(review).not.toContainText("No Located objective is available");
  await expect(review.getByText(/^Need another angle /u)).toBeVisible();
  await expect(review.getByText(/^Confirm the label /u)).toBeVisible();
  const captureReview = async (viewport) => {
    await page.setViewportSize(viewport);
    await review.scrollIntoViewIfNeeded();
    assert.equal(await review.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
    await page.screenshot({ path: `${output}/retained-review-${viewport.width}.png`, fullPage: true });
  };
  await captureReview({ width: 1440, height: 900 });
  await captureReview({ width: 390, height: 844 });
  console.log("PASS retained native proof and both rejection events; completed-review copy and mobile width (read-only)");
}

try {
  if (cutover) {
    const probes = await verifyRetiredEndpoints(baseURL);
    console.log(`PASS cutover offline import/absence audit; ${probes} empty retired endpoint probes returned 404`);
  }
  await connect(page);
  await resourceChecks();
  await layoutChecks();
  if (cutover) { await completedReviewChecks(); }
  if (process.argv.includes("--mutate")) {
    await verifyOperatorFlow({ page, context, connect, handoff, output, networkPolicy });
    assert.deepEqual(errors, []);
    assert.deepEqual(legacyRequests, []);
    assert.deepEqual(blockedRequests, []);
  }
} catch (error) {
  // Playwright error messages may include fill arguments; credentials never leave this process.
  console.error(String(error).split(token).join("[redacted]"));
  const notice = await page.getByTestId("operator-status-notice").textContent({ timeout: 1_000 }).catch(() => null);
  console.error(JSON.stringify({ notice: notice?.split(token).join("[redacted]").slice(0, 500), errors, blockedRequests, legacyRequests }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
