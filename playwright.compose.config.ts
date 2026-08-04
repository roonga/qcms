import { defineConfig, devices } from "@playwright/test";

const adminUrl = process.env.QCMS_COMPOSE_E2E_ADMIN_URL ?? "http://localhost:17940";

/**
 * Isolated Docker Compose smoke test. Unlike the main Playwright configuration,
 * it owns its own Compose project and creates its own first administrator.
 */
export default defineConfig({
  testDir: "./apps/e2e",
  testMatch: "full-stack-conditional-form.pw.ts",
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { outputFolder: "playwright-report/full-stack-e2e", open: "never" }],
        ["junit", { outputFile: "test-results/full-stack-e2e/junit.xml" }],
      ]
    : "list",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: adminUrl,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
