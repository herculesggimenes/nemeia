import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "../frontend/node_modules/playwright/index.mjs";

// Local-only documentation QA: never connects to a database, model or robot.
const root = new URL("../", import.meta.url);
await mkdir(new URL(".artifacts/", root), { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const route of ["dist/index.html", "dist/spacetimedb/index.html"]) {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1050 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(new URL(route, root).href);
      assert.equal(await page.locator("details[open]").count(), 0);
      assert.equal(await page.locator("button, input, form").count(), 0);
      for (const id of ["unit", "agent", "world-master", "object-world-view", "object-local-map", "durable-world-state", "durability-and-recovery", "contract-world-memory", "flow-resume", "table-map_revision", "contract-world-masters", "object-agent-runtime", "eve-channel", "eve-sandbox", "eve-workspace", "table-unit_assignment", "object-mission-log", "object-mission-spec", "objective-progress", "table-mission_objective_progress", "flow-mission"]) {
        const summary = page.locator(`#${id} > summary`);
        await summary.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(`#${id}`).getAttribute("open"), "");
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(`#${id}`).getAttribute("open"), null);
      }
      for (const id of ["object-spatial-map", "object-navigation", "table-region", "flow-discovery", "flow-prepared", "flow-waiting", "flow-naming"]) {
        await page.locator(`#${id} > summary`).focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator(`#${id}`).getAttribute("open"), "");
        await page.keyboard.press("Enter");
      }
      await page.evaluate(() => {
        document.querySelectorAll("details").forEach(element => { element.open = true; });
      });
      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      assert.ok(dimensions.content <= dimensions.width + 1, `${route} at ${width}: horizontal page overflow`);
      assert.ok(await page.locator(".code-line").count() > 0, "syntax-rendered code");
      assert.deepEqual(errors, []);
      if (route === "dist/index.html" && [390, 1440].includes(width)) {
        await page.evaluate(() => { document.querySelectorAll("details").forEach(element => { element.open = false; }); window.scrollTo(0, 0); });
        await page.screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-agents-${width}.png`, root)) });
        await page.locator("#contract-world-masters > summary").click();
        await page.locator("#contract-world-masters").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-agent-contract-${width}.png`, root)) });
        await page.locator("#eve-runtime").scrollIntoViewIfNeeded();
        await page.screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-eve-${width}.png`, root)) });
        await page.locator("#local-world").scrollIntoViewIfNeeded();
        await page.screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-local-world-${width}.png`, root)) });
        await page.locator("#object-local-map > summary").click();
        await page.locator("#object-local-map").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-local-map-${width}.png`, root)) });
        await page.locator("#object-mission-log > summary").click();
        await page.locator("#object-mission-log").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-mission-log-${width}.png`, root)) });
        await page.locator("#example").scrollIntoViewIfNeeded();
        await page.screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-exploration-${width}.png`, root)) });
        await page.locator("#flow-findings > summary").click();
        await page.locator("#flow-findings").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-findings-${width}.png`, root)) });
        await page.locator("#flow-discovery > summary").click();
        await page.locator("#flow-discovery").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-mapping-${width}.png`, root)) });
        await page.locator("#flow-naming > summary").click();
        await page.locator("#flow-naming").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-naming-${width}.png`, root)) });
        await page.locator("#flow-waiting > summary").click();
        await page.locator("#flow-waiting").screenshot({ path: fileURLToPath(new URL(`.artifacts/nemeia-continuous-world-${width}.png`, root)) });
      }
      console.log(`${route} ${width}px: disclosures, keyboard, syntax rendering, overflow and read-only checks passed`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
