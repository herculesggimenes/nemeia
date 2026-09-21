import { expect, test } from "@playwright/test";
import { assertNativeCutover, verifyRetiredEndpoints } from "../../../scripts/native-cutover-policy.mjs";
import { createNativeNetworkPolicy, installNativeNetworkFence } from "../../../scripts/native-ui-safety.mjs";

// This suite never reads a credential or writes World state.
test.beforeAll(() => { assertNativeCutover(); });

test("native default is credential-gated on desktop and mobile, without legacy chrome", async ({ page, context, baseURL }) => {
  const violations: string[] = [];
  const errors: string[] = [];
  await installNativeNetworkFence(context, createNativeNetworkPolicy({
    baseURL, uri: "http://127.0.0.1:1", databaseName: "no-authenticated-world",
  }), violations);
  page.on("pageerror", () => errors.push("runtime_error"));
  await page.goto("/");
  await expect(page).toHaveURL(/\/missions$/u);
  await expect(page.getByRole("heading", { name: "Mission board", exact: true })).toBeVisible();
  await expect(page.getByLabel("Operator token")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Connect tab", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create mission", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Emergency Stop", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Framework", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("nemeia-workbench")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Mission board", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

for (const path of ["/settings", "/docs", "/framework"]) {
  test(`${path} remains read-only and does not initialize robot transport`, async ({ page, context, baseURL }) => {
    const violations: string[] = [];
    await installNativeNetworkFence(context, createNativeNetworkPolicy({
      baseURL, uri: "http://127.0.0.1:1", databaseName: "no-authenticated-world",
    }), violations);
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByTestId("nemeia-workbench")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Emergency Stop", exact: true })).toHaveCount(0);
    expect(violations).toEqual([]);
  });
}

test("retired routes return 404 only after offline absence/import gate", async ({ baseURL }) => {
  test.setTimeout(120_000);
  expect(await verifyRetiredEndpoints(baseURL)).toBe(8);
});
