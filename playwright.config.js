import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 4173);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./apps/road-crew/e2e",
  testMatch: /.*\.spec\.js$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "playwright-report/results.json" }]]
    : "list",
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    permissions: ["geolocation"],
    trace: process.env.CI ? "retain-on-failure" : "off",
    video: process.env.CI ? "retain-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run serve:app`,
    env: { E2E_PORT: String(PORT) },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
