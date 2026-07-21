import { defineConfig, devices } from "@playwright/test";

import {
  API_BASE_URL,
  FIXED_INTERNAL_TOKEN,
  PORTAL_PORT,
} from "./apps/portal/e2e/support/harness-config.js";

/**
 * Root Playwright configuration (task 029, ADR-23).
 *
 * This is the ONE browser-test config for the whole repo: 030-035 extend it with
 * more projects and specs; no other browser-test framework is ever added. Vitest
 * stays below the browser (unit / slice / integration); Playwright owns e2e.
 *
 * The behavioral suite (anonymous + secure-link entry, branching walkthrough,
 * resume, submit, completion, mobile + throttled, no-JS SSR) runs the portal
 * against a composed API: `globalSetup` boots the real API + Testcontainers
 * Postgres (reusing the 027 seed utilities) and `globalTeardown` stops them.
 */
const PORT = PORTAL_PORT;

export default defineConfig({
  testDir: "./apps/portal/e2e",
  // Playwright specs use a `.pw.ts` extension so Vitest (which globs
  // `*.{test,spec}.ts`) never collects them: browser tests are Playwright's, unit
  // and slice tests are Vitest's (ADR-23). 030-035 add more `*.pw.ts` files here.
  testMatch: "**/*.pw.ts",
  outputDir: "./apps/portal/.playwright/output",
  // Boot the composed API + database once for the whole suite, tear down after.
  globalSetup: "./apps/portal/e2e/global-setup.ts",
  globalTeardown: "./apps/portal/e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Booting Testcontainers Postgres in globalSetup takes ~30-60s on a cold pull.
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      // Respondents are on phones (ADR-26): the default project is mobile.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    // Run the portal DEV server: over http localhost the session cookie is not
    // `secure` (isProduction() is false), so the real cookie-backed flow works.
    // The BFF reaches the composed API booted by globalSetup; both sides share the
    // synthetic SEC-4 internal token from harness-config.
    command: `pnpm --filter qcms-portal dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      QCMS_API_BASE_URL: API_BASE_URL,
      QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    },
  },
});
