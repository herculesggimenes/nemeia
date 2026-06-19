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
    await expect(page.getByRole("tree", { name: "Connected systems" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /systems go2/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 front camera/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 lidar/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 control/i })).toBeVisible();
    await page.getByRole("treeitem", { name: /systems go2/i }).click();
    await expect(page.getByRole("treeitem", { name: /go2 front camera/i })).toHaveCount(0);
    await page.getByRole("treeitem", { name: /systems go2/i }).click();
    await expect(page.getByRole("treeitem", { name: /go2 front camera/i })).toBeVisible();
    await expect(page.getByTestId("artifact-drawer")).toBeVisible();

    const sidebarBefore = await page.locator('[data-slot="sidebar-container"]').boundingBox();
    const sidebarHandle = await page.getByRole("button", { name: /resize sidebar/i }).boundingBox();

    expect(sidebarBefore).not.toBeNull();
    expect(sidebarHandle).not.toBeNull();

    if (!sidebarBefore || !sidebarHandle) {
      return;
    }

    await page.mouse.move(sidebarHandle.x + sidebarHandle.width / 2, sidebarHandle.y + 100);
    await page.mouse.down();
    await page.mouse.move(sidebarHandle.x + 72, sidebarHandle.y + 100, { steps: 8 });
    await page.mouse.up();

    const sidebarAfter = await page.locator('[data-slot="sidebar-container"]').boundingBox();
    expect(sidebarAfter).not.toBeNull();
    expect(sidebarAfter?.width ?? 0).toBeGreaterThan(sidebarBefore.width + 32);
    await expect(page.locator("body")).not.toContainText("THREAD VIEW");

    await expect.poll(() => errors).toEqual([]);
  });

  test("settings page boots without the artifact drawer", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/settings");
    await disableAnimations(page);

    await expect(page.getByAltText("Nemeia")).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByText("Go2 local connection")).toBeVisible();
    await expect(page.getByLabel("Robot IP")).toHaveValue("192.168.12.1");
    await expect(page.getByRole("button", { exact: true, name: "Connect" })).toBeVisible();
    await expect(page.getByTestId("artifact-drawer")).toHaveCount(0);

    await expect.poll(() => errors).toEqual([]);
  });

  test("sidebar navigation moves between settings and conversation", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("link", { name: /settings/i }).click();
    await expect(page).toHaveURL("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();

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

    await expect(page.getByTestId("thread-message").and(page.locator('[data-kind="user"]')).filter({ hasText: "status?" })).toBeVisible();
    await expect(
      page.getByTestId("thread-message").and(page.locator('[data-kind="assistant"]')).filter({ hasText: "Mock response queued for" })
    ).toBeVisible();

    await expect.poll(() => errors).toEqual([]);
  });

  test("artifact drawer can resize and file tree keeps scrollable tabs", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("button", { name: /open file/i }).click();
    await expect(page.getByTestId("artifact-workspace")).toHaveAttribute("data-file-tree-open", "true");
    await expect(page.getByRole("tree", { name: "Artifact file tree" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "robots" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "go2/front-camera.stream" })).toBeVisible();
    await page.getByRole("treeitem", { name: "robots" }).click();
    await expect(page.getByRole("treeitem", { name: "go2/front-camera.stream" })).toHaveCount(0);
    await page.getByRole("treeitem", { name: "robots" }).click();
    await expect(page.getByRole("treeitem", { name: "go2/front-camera.stream" })).toBeVisible();

    const before = await page.getByTestId("artifact-drawer").boundingBox();
    const handle = await page.getByRole("button", { name: /resize artifact pane/i }).boundingBox();

    expect(before).not.toBeNull();
    expect(handle).not.toBeNull();

    if (!before || !handle) {
      return;
    }

    await page.mouse.move(handle.x + handle.width / 2, handle.y + 120);
    await page.mouse.down();
    await page.mouse.move(handle.x - 96, handle.y + 120, { steps: 8 });
    await page.mouse.up();

    const after = await page.getByTestId("artifact-drawer").boundingBox();
    expect(after).not.toBeNull();
    expect(after?.width ?? 0).toBeGreaterThan(before.width + 40);

    await expect(page.getByTestId("artifact-tabs")).toHaveCSS("overflow-x", "auto");
    await expect(page.getByTestId("artifact-preview-path")).toHaveCSS("display", "none");
    await expect.poll(() => errors).toEqual([]);
  });
});
