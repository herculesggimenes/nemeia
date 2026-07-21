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
  test.describe.configure({ mode: "serial" });

  test("mission cockpit API exposes a Mission API projection", async ({ request }) => {
    await request.post("/api/mission/cockpit/reset");
    const response = await request.get("/api/mission/cockpit");
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.source).toBe("mission-api");
    expect(body.health.status).toBe("ok");
    expect(body.robots.items).toEqual([{ robot_id: "robot_01" }]);
    expect(body.runs.some((run: { state: string }) => run.state === "awaiting_approval")).toBeTruthy();
    expect(body.replay.events.length).toBeGreaterThan(0);
    expect(body.scene.entities.length).toBeGreaterThan(0);
    expect(body.anomalies.items.length).toBeGreaterThan(0);
    expect(body.attention.contract.mission_id).toBe(body.mission.id);

    const pendingRun = body.runs.find((run: { id: string; state: string }) => run.state === "awaiting_approval");
    expect(pendingRun.id).toBeTruthy();

    const decision = await request.post(`/api/mission/cockpit/runs/${pendingRun.id}/decision`, {
      data: { decision: "approve", reason: "smoke approval" }
    });
    expect(decision.ok()).toBeTruthy();
    const decisionBody = await decision.json();
    expect(decisionBody.authorization.run_id).toBe(pendingRun.id);

    const refreshed = await (await request.get("/api/mission/cockpit")).json();
    expect(refreshed.runs.find((run: { id: string }) => run.id === pendingRun.id).state).toBe("executing");
    expect(refreshed.replay.run_id).toBe(pendingRun.id);

    const stop = await request.post("/api/mission/cockpit/robots/robot_01/stop", {
      data: { reason: "smoke stop" }
    });
    expect(stop.ok()).toBeTruthy();
    const stopped = await (await request.get("/api/mission/cockpit")).json();
    expect(stopped.robot_status.kernel.stop_state).toBe(true);
    expect(stopped.runs.find((run: { id: string }) => run.id === pendingRun.id).state).toBe("aborted");

    const recovered = await request.post("/api/mission/cockpit/robots/robot_01/clear-stop");
    expect(recovered.ok()).toBeTruthy();
    const cleared = await (await request.get("/api/mission/cockpit")).json();
    expect(cleared.robot_status.kernel.stop_state).toBe(false);
  });

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
    await expect(page.getByRole("treeitem", { name: "mission cockpit" })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "world entities and interactions" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "atena runtime config" })).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: /robot offline/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /robot front camera/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /robot lidar/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /robot control/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /robot speaker/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /robot stats/i })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "add module" })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "settings" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reconnect robot" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Atena settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Front camera settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "LiDAR settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Control settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Speaker settings" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /ask nemeia/i })).toBeVisible();
    await expect(page.getByText("Front Camera", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Point Cloud", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("world-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "World" })).toBeVisible();
    await expect(page.getByText("Live spatial state")).toBeVisible();
    await expect(page.getByTestId("world-spatial-viewport")).toBeVisible();
    await expect(page.getByText("core.environment", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("core.robot", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Connect\b/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Observe\b/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Move\b/ })).toBeDisabled();
    await expect(page.getByText("Robot Control", { exact: true })).toBeVisible();
    await expect(page.getByTestId("go2-control-pane")).toBeVisible();
    await expect(page.getByTestId("go2-control-pane")).toContainText("Safety");
    await expect(page.getByRole("button", { exact: true, name: "Stand" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Obstacle Avoid On" })).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Obstacle Avoid Off" })).toBeVisible();
    await expect(page.getByTestId("go2-control-runtime-feedback")).toContainText("idle");
    await page.evaluate(() => window.nemeiaRobotRuntimeResetCommands?.());
    await page.getByRole("button", { exact: true, name: "Free Walk" }).click();
    await expect(page.getByTestId("go2-control-runtime-feedback")).toContainText("Robot is not connected");

    await page.getByRole("button", { exact: true, name: "Pose" }).click();
    await page.getByRole("button", { exact: true, name: "Normal Walk" }).click();
    await page.getByRole("button", { exact: true, name: "Run" }).click();
    await page.getByRole("button", { exact: true, name: "Walk Stair" }).click();
    await page.getByRole("button", { exact: true, name: "Static Walk" }).click();
    await page.getByRole("button", { exact: true, name: "Endurance" }).click();
    await page.getByRole("button", { exact: true, name: "Leash" }).click();

    const modeCommands = await page.evaluate(() => window.nemeiaRobotRuntimeCommands ?? []);
    expect(modeCommands.map((command) => command.kind)).toEqual(Array(modeCommands.length).fill("native_action"));
    expect(modeCommands.map((command) => command.label)).toEqual(["Free Walk", "Pose", "Normal Walk", "Run", "Walk Stair", "Static Walk", "Endurance", "Leash"]);
    expect(modeCommands.every((command) => command.kind !== "native_action" || command.role === "mode")).toBeTruthy();
    expect(JSON.stringify(modeCommands)).not.toMatch(/Unitree|Go2|sport_request|apiId/i);

    await expect(page.getByText("Robot audio")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose file" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Microphone settings" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Audio input source" })).toHaveCount(0);
    await expect(page.getByText("Go2")).toHaveCount(0);

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
    await expect(page.getByText("Robot local connection")).toHaveCount(0);

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

  test("documentation explains the framework without loading the operator workbench", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/docs");
    await expect(page).toHaveTitle("Nemeia Documentation");
    await expect(page.getByRole("heading", { name: "Nemeia Documentation" })).toBeVisible();
    await expect(page.getByText("The Sims, as a framework for agents")).toBeVisible();
    await expect(page.getByText("One continuous world loop")).toBeVisible();
    await expect(page.getByText("The complete runtime in seven operations")).toBeVisible();
    await expect(page.getByTestId("nemeia-workbench")).toHaveCount(0);
    await expect.poll(() => errors).toEqual([]);
  });

  test("framework story explains interactive physical worlds visually", async ({ page }) => {
    const errors = await collectRuntimeErrors(page);

    await page.goto("/framework");
    await expect(page).toHaveTitle("Nemeia - The Framework for Interactive Physical Worlds");
    await expect(page.getByRole("heading", { name: "The framework for interactive physical worlds" })).toBeVisible();
    await expect(page.getByText("An entity is a set of components")).toBeVisible();
    await expect(page.getByText("One world model, endlessly composable")).toBeVisible();
    await expect(page.getByText("The core loop is working")).toBeVisible();
    await expect(page.getByTestId("nemeia-workbench")).toHaveCount(0);
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

    await page.getByRole("button", { name: "Robot settings" }).click();
    await expect(page.getByText("Robot Config")).toBeVisible();
    await expect(page.getByText("Robot local connection")).toBeVisible();
    await expect(page.getByText("Go2")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Auto reconnect" })).toBeVisible();
    await expect(page.getByText("Power management")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Front camera stream" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "LiDAR / SLAM stream" })).toBeVisible();
    await expect(page.getByText("Speaker output stream")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Microphone input" })).toHaveCount(0);
    await expect(page.getByRole("switch", { name: "Obstacle avoidance" })).toBeVisible();

    await page.getByRole("treeitem", { name: /robot speaker/i }).click();
    await expect(page.getByText("Speaker").nth(1)).toBeVisible();
    await expect(page.getByText("Speaker disabled")).toBeVisible();

    await page.getByRole("treeitem", { name: /robot lidar/i }).click();
    await expect(page.getByText("Point Cloud", { exact: true })).toBeVisible();

    await page.getByRole("treeitem", { name: /robot stats/i }).click();
    await expect(page.getByTestId("go2-stats-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Robot Stats" })).toBeVisible();
    await expect(page.getByText("Normalized telemetry")).toBeVisible();
    await expect(page.getByText("Go2")).toHaveCount(0);

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
    await expect(page.getByText("Point Cloud")).toHaveCount(0);
    await expect(page.getByTestId("world-panel")).toBeVisible();
    await expect(page.getByText("Robot Control")).toBeVisible();

    await expect.poll(() => errors).toEqual([]);
  });

});
