import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.NEMEIA_UI_URL ?? "http://127.0.0.1:5173";
if (new URL(baseURL).hostname !== "127.0.0.1") { throw new Error("Native smoke requires loopback"); }

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  // Playwright cleans this directory. Never share it with retained E7/E12 evidence.
  outputDir: "./test-results/smoke",
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    actionTimeout: 3_000,
    baseURL,
    serviceWorkers: "block",
    screenshot: "off",
    trace: "off",
    video: "off"
  },
  webServer: process.env.NEMEIA_UI_URL ? undefined : {
    command: "npm run dev",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: baseURL
  },
  projects: [
    {
      name: "chromium-smoke",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 900, width: 1440 }
      }
    }
  ]
});
