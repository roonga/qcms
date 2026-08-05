import { defineConfig, devices } from "@playwright/test";

import { FULL_STACK_ADMIN_URL } from "./apps/e2e/support/full-stack-config.js";

/**
 * Isolated full-stack smoke test over the Docker Compose topology. Unlike the main
 * Playwright configuration, it owns its own Compose project and creates its own
 * first administrator.
 *
 * The stack's addresses come from `apps/e2e/support/full-stack-config.ts`, which
 * reads the two environment names `scripts/compose-e2e.mjs` exports and otherwise
 * derives this seat's harness ports (R8, `docs/PORTS.md`).
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
    baseURL: FULL_STACK_ADMIN_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
