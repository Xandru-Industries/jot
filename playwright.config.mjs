import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/global-setup.mjs",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:43210",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm run start:test",
    url: "http://127.0.0.1:43210/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
