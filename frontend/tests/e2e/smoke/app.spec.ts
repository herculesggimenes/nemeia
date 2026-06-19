import { expect, test, type Page } from "@playwright/test";

const criticalErrorPattern = /hydration|uncaught|runtime error|failed to load resource|500 internal/i;

async function collectRuntimeErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && criticalErrorPattern.test(message.text())) {
      errors.push(`console: ${message.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  return errors;
}

async function disableAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `
  });
}

test.describe("Nemeia smoke", () => {
  test("conversation page boots with shell, chat, and artifacts", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await expect(page.getByAltText("Nemeia")).toBeVisible();
    await expect(page.getByRole("link", { name: /conversation/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Front Camera" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Point Cloud" })).toBeVisible();
    await expect(page.locator(".artifactDrawer")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("THREAD VIEW");

    await expect.poll(() => errors).toEqual([]);
  });

  test("settings page boots without the artifact drawer", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/settings");
    await disableAnimations(page);

    await expect(page.getByAltText("Nemeia")).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toHaveAttribute("data-active", "true");
    await expect(page.locator(".settingsBlank")).toBeVisible();
    await expect(page.locator(".artifactDrawer")).toHaveCount(0);

    await expect.poll(() => errors).toEqual([]);
  });

  test("sidebar navigation moves between settings and conversation", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("link", { name: /settings/i }).click();
    await expect(page).toHaveURL("/settings");
    await expect(page.locator(".settingsBlank")).toBeVisible();

    await page.getByRole("link", { name: /conversation/i }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();

    await expect.poll(() => errors).toEqual([]);
  });

  test("operator can send a mock chat message", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("textbox", { name: /ask nemeia/i }).fill("status?");
    await page.getByRole("button", { name: /send message/i }).click();

    await expect(page.locator(".lmnrMessage.user").filter({ hasText: "status?" })).toBeVisible();
    await expect(page.locator(".lmnrMessage.assistant").filter({ hasText: "Mock response queued for" })).toBeVisible();

    await expect.poll(() => errors).toEqual([]);
  });

  test("artifact drawer can resize and file tree keeps scrollable tabs", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("button", { name: /open file/i }).click();
    await expect(page.locator(".extendWorkspace.fileTreeOpen")).toBeVisible();

    const before = await page.locator(".artifactDrawer").boundingBox();
    const handle = await page.locator(".artifactResizeHandle").boundingBox();

    expect(before).not.toBeNull();
    expect(handle).not.toBeNull();

    if (!before || !handle) {
      return;
    }

    await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle.x - 96, handle.y + 120, { steps: 8 });
    await page.mouse.up();

    const after = await page.locator(".artifactDrawer").boundingBox();
    expect(after).not.toBeNull();
    expect(after?.width ?? 0).toBeGreaterThan(before.width + 40);

    await expect(page.locator(".extendTabs")).toHaveCSS("overflow-x", "auto");
    await expect(page.locator(".extendPreviewPath")).toHaveCSS("display", "none");
    await expect.poll(() => errors).toEqual([]);
  });
});
