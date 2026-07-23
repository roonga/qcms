import { defineConfig, devices } from "@playwright/test";

import {
  API_BASE_URL,
  FIXED_INTERNAL_TOKEN,
  PORTAL_PORT,
} from "./apps/portal/e2e/support/harness-config.js";

/**
 * Root Playwright configuration (task 029, ADR-23; viewports + gates from 045).
 *
 * This is the ONE browser-test config for the whole repo: no other browser-test
 * framework is ever added. Vitest stays below the browser (unit / slice /
 * integration); Playwright owns e2e.
 *
 * The behavioral suite runs the portal against a composed API: `globalSetup`
 * boots the real API + Testcontainers Postgres (reusing the 027 seed utilities)
 * and `globalTeardown` stops them. Task 045 adds tablet + desktop projects so the
 * flow + accessibility specs run at three viewports (finding L), captures the
 * portal dev-server log for the server-side log gate (exit 5), and every spec
 * imports the gated `test` from `support/gates.ts` (browser + server error gates).
 */
const PORT = PORTAL_PORT;

// The flow + accessibility specs that must run at every viewport (exit 2). Other
// specs (resume, secure-link, no-JS, ssr, visual) stay on the phone project.
const MULTI_VIEWPORT_SPECS = [
  "**/kitchen-sink-flow.pw.ts",
  "**/a11y-axe.pw.ts",
  "**/a11y-keyboard.pw.ts",
];

export default defineConfig({
  testDir: "./apps/portal/e2e",
  // Playwright specs use a `.pw.ts` extension so Vitest (which globs
  // `*.{test,spec}.ts`) never collects them: browser tests are Playwright's, unit
  // and slice tests are Vitest's (ADR-23).
  testMatch: "**/*.pw.ts",
  outputDir: "./apps/portal/.playwright/output",
  // Boot the composed API + database once for the whole suite, tear down after.
  globalSetup: "./apps/portal/e2e/global-setup.ts",
  globalTeardown: "./apps/portal/e2e/global-teardown.ts",
  fullyParallel: false,
  // One worker: the suite drives a single `next dev` server, which compiles routes
  // on demand and slows sharply under concurrent load (multi-second requests),
  // breaking the keyboard specs' timing. Serializing keeps every request fast and
  // the whole run deterministic; the three viewport projects still all run.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Retry on CI only. The suite drives a real full-stack flow (browser -> portal
  // BFF -> API -> Docker Postgres) over a single on-demand `next dev` server, so a
  // request can occasionally exceed its wait under CI load; a single-shot
  // `waitForResponse` then times out and reds the whole run. Retrying on CI keeps
  // it green against that timing class while Playwright still reports any retried
  // test as "flaky" (visible, not hidden) so genuine flakes get root-caused. Local
  // runs stay strict at 0 so a real regression is never masked in development.
  retries: process.env.CI ? 2 : 0,
  // Booting Testcontainers Postgres in globalSetup takes ~30-60s on a cold pull.
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      // Respondents are on phones (ADR-26): the phone project runs every spec.
      // Kept named "mobile-chromium" so existing visual snapshot baselines match.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      // Tablet (~768x1024): the flow + a11y specs only (exit 2).
      name: "tablet-chromium",
      testMatch: MULTI_VIEWPORT_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      // Desktop (~1280x800): the flow + a11y specs only (exit 2).
      name: "desktop-chromium",
      testMatch: MULTI_VIEWPORT_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // Run the portal DEV server through a wrapper that tees its stdout/stderr to
    // the server-log capture file (exit 5), so the log gate can scan it. Over http
    // localhost the session cookie is not `secure` (isProduction() is false), so
    // the real cookie-backed flow works. The BFF reaches the composed API booted
    // by globalSetup; both sides share the synthetic SEC-4 internal token.
    command: `node ./apps/portal/e2e/support/portal-server.mjs`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORTAL_PORT: String(PORT),
      QCMS_API_BASE_URL: API_BASE_URL,
      QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
    },
  },
});
