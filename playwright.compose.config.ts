import { defineConfig, devices } from "@playwright/test";

import { COMPOSE_ADMIN_URL } from "./apps/admin/e2e/support/compose-config.js";

/**
 * Isolated Docker Compose smoke test. Unlike the main Playwright configuration,
 * it owns its own Compose project and creates its own first administrator.
 *
 * The stack's addresses come from `support/compose-config.ts`, which reads the two
 * environment names `scripts/compose-e2e.mjs` exports and otherwise derives this
 * seat's harness ports (R8, `docs/PORTS.md`).
 */
export default defineConfig({
  testDir: "./apps/admin/e2e",
  testMatch: "compose-conditional-form.pw.ts",
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { outputFolder: "playwright-report/compose-e2e", open: "never" }],
        ["junit", { outputFile: "test-results/compose-e2e/junit.xml" }],
      ]
    : "list",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: COMPOSE_ADMIN_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
