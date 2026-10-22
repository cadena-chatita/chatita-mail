import { defineConfig, devices } from "@playwright/test";

// Regression suite that needs NO login and NO production data: the API is mocked with fictitious fixtures.
// Run:  npx playwright test -c playwright.local.config.ts
export default defineConfig({
  testDir: "./e2e/local",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5174/mail/", trace: "retain-on-failure", viewport: { width: 1280, height: 720 } },
  webServer: { command: "npx vite --port 5174 --strictPort", url: "http://localhost:5174/mail/", reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } }],
});
