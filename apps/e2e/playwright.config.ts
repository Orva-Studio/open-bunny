import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env["BASE_URL"] ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 1 } : {}),
  reporter: "html",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Spin up the app before running tests in CI
  // webServer: {
  //   command: "docker-compose up -d",
  //   url: BASE_URL,
  //   reuseExistingServer: !process.env["CI"],
  // },
});
