import { defineConfig, devices } from "@playwright/test";

process.env.PWDEBUG = "0";
delete process.env.DEBUG;
delete process.env.DEBUG_FILE;

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  workers: 1,
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  timeout: 1_200_000,
  expect: { timeout: 30_000 },
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    serviceWorkers: "block",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [{ name: "native-e2e", use: { ...devices["Desktop Chrome"] } }],
});
