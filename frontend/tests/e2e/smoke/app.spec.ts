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
  test("conversation workbench boots with docked modules, artifacts, and controls", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await expect(page.getByAltText("Nemeia")).toBeVisible();
    await expect(page.getByRole("link", { name: "Conversation" })).toHaveCount(0);
    await expect(page.getByRole("button", { exact: true, name: "Modules" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { exact: true, name: "Control" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset workbench layout" })).toHaveCount(0);
    await expect(page.getByTestId("nemeia-workbench")).toBeVisible();
    await expect(page.getByTestId("modules-panel")).toBeVisible();
    await expect(page.getByRole("tree", { name: "Modules" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Collapse modules" })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "atena agent" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "atena chat" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "atena runtime config" })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: /go2 offline/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 front camera/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 lidar/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 control/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /go2 speaker/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "add module" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reconnect Go2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Atena settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Front camera settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "LiDAR settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Control settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Speaker settings" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();
    await expect(page.getByText("Front Camera", { exact: true })).toBeVisible();
    await expect(page.getByText("Point Cloud", { exact: true })).toBeVisible();
    await expect(page.getByText("Go2 Control", { exact: true })).toBeVisible();
    await expect(page.getByTestId("go2-control-pane")).toBeVisible();
    await expect(page.getByTestId("go2-control-pane")).toContainText("Safety");
    await expect(page.getByRole("button", { exact: true, name: "Stand" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Obstacle Avoid On" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Obstacle Avoid Off" })).toBeVisible();
    await expect(page.getByText("Robot audio")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Microphone settings" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Audio input source" })).toHaveCount(0);

    await expect.poll(() => errors).toEqual([]);
  });

  test("settings route opens settings as a workbench panel", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/settings");
    await disableAnimations(page);

    await expect(page.getByAltText("Nemeia")).toBeVisible();
    await expect(page.getByTestId("nemeia-workbench")).toBeVisible();
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runtime Config" })).toBeVisible();
    await expect(page.getByTestId("artifact-drawer")).toHaveCount(0);
    await expect(page.getByText("Go2 local connection")).toHaveCount(0);

    await expect.poll(() => errors).toEqual([]);
  });

  test("routes open matching workbench panels", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/settings");
    await disableAnimations(page);

    await expect(page).toHaveURL("/settings");
    await expect(page.getByTestId("settings-page")).toBeVisible();

    await page.goto("/");
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

  test("module tree opens dockable module panels and reset restores the workbench", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/");
    await disableAnimations(page);

    await page.getByRole("button", { name: "Go2 settings" }).click();
    await expect(page.getByText("Go2 Config")).toBeVisible();
    await expect(page.getByText("Go2 local connection")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Auto reconnect" })).toBeVisible();
    await expect(page.getByText("Power management")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Front camera stream" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "LiDAR / SLAM stream" })).toBeVisible();
    await expect(page.getByText("Speaker output stream")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Microphone input" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Obstacle avoidance" })).toBeVisible();

    await page.getByRole("treeitem", { name: /go2 speaker/i }).click();
    await expect(page.getByText("Speaker").nth(1)).toBeVisible();
    await expect(page.getByText("Waiting for Go2 connection")).toBeVisible();

    await page.getByRole("treeitem", { name: "atena chat" }).click();
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();

    await page.getByRole("button", { name: "Atena settings" }).click();
    await expect(page.getByRole("heading", { name: "Runtime Config" })).toBeVisible();

    await page.getByRole("treeitem", { name: "add module" }).click();
    await expect(page.getByRole("heading", { name: "Add module" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Microphone" })).toHaveCount(0);
    await expect(page.getByText("Robot arm with camera")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("modules-panel")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();
    await expect(page.getByText("Point Cloud")).toBeVisible();
    await expect(page.getByText("Go2 Control")).toBeVisible();

    await expect.poll(() => errors).toEqual([]);
  });

});
