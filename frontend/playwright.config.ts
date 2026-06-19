import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  testDir: "./tests/e2e",
  timeout: 10_000,
  use: {
    actionTimeout: 3_000,
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off"
  },
  webServer: {
    command: "npm run dev",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://localhost:5173"
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
