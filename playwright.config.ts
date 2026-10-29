import { defineConfig, devices } from "@playwright/test";

import { ADMIN_BASE_URL, ADMIN_PORT } from "./apps/admin/e2e/support/harness-config.js";
import { preflightBrowserLibraries } from "./apps/portal/e2e/support/browser-libs.js";
import {
  API_BASE_URL,
  API_PORT,
  FIXED_INTERNAL_TOKEN,
  HARNESS_BRAND_LOGO,
  HARNESS_BRAND_NAME,
  HARNESS_CORNERS,
  HARNESS_FONT,
  HARNESS_FONTS,
  HARNESS_THEME,
  OTEL_SERVICE_NAMES,
  OTLP_ENDPOINT,
  OTLP_EXPORT_TIMEOUT_MS,
  OTLP_PORT,
  OTLP_SCHEDULE_DELAY_MS,
  PORTAL_PORT,
} from "./apps/portal/e2e/support/harness-config.js";
import {
  PORT_SEAT,
  PREFLIGHT_DONE_VAR,
  seatPreflight,
} from "./apps/portal/e2e/support/port-seat.js";

// Read BEFORE the preflight, which is what sets the sentinel.
const FIRST_LOAD = process.env[PREFLIGHT_DONE_VAR] !== "1";
// A free port yields `false`, so a lost bind race fails loudly rather than adopting another
// worktree's server.
const ADOPTABLE = seatPreflight();

// A downloaded browser whose OS libraries are missing fails every test minutes later
// with "Target page, context or browser has been closed". Silent when it cannot tell.
if (FIRST_LOAD) preflightBrowserLibraries();

if (FIRST_LOAD) {
  process.stdout.write(
    `[playwright] port seat ${String(PORT_SEAT)}: portal ${String(PORTAL_PORT)}, ` +
      `api ${String(API_PORT)}, admin ${String(ADMIN_PORT)}, otlp ${String(OTLP_PORT)}\n`,
  );
}

const PORT = PORTAL_PORT;

const MULTI_VIEWPORT_SPECS = [
  "**/kitchen-sink-flow.pw.ts",
  "**/a11y-axe.pw.ts",
  "**/a11y-keyboard.pw.ts",
  // Ruled one input per row at EVERY width, so this spec needs all three projects.
  "**/repeat-stacked.pw.ts",
];

export default defineConfig({
  testDir: "./apps/portal/e2e",
  // `.pw.ts` so Vitest, which globs `*.{test,spec}.ts`, never collects these (ADR-23).
  testMatch: "**/*.pw.ts",
  outputDir: "./apps/portal/.playwright/output",
  globalSetup: "./apps/portal/e2e/global-setup.ts",
  globalTeardown: "./apps/portal/e2e/global-teardown.ts",
  fullyParallel: false,
  // A single `next dev` compiles routes on demand and slows sharply under concurrent
  // load, which breaks the keyboard specs' timing.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A request can exceed its wait under CI load; Playwright still reports a retried test
  // as flaky. Local runs stay at 0 so a real regression is never masked.
  retries: process.env.CI ? 2 : 0,
  // Booting Testcontainers Postgres in globalSetup takes ~30-60s on a cold pull.
  timeout: 60_000,
  // The second reporter annotates an unexpected failure with host and neighbour-seat
  // load, so a neighbouring lane's contention is not read as this branch's regression.
  reporter: [["list"], ["./apps/portal/e2e/support/contention-reporter.ts"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uploaded by ci.yml's if-failure artifact step; a local failure reproduces in place.
    screenshot: process.env.CI ? "only-on-failure" : "off",
    trace: process.env.CI ? "on-first-retry" : "off",
    // Under the test timeout, so a hung action is named rather than reported only as the
    // test running out of time. Generous enough for a route `next dev` has not compiled.
    actionTimeout: 30_000,
  },
  projects: [
    {
      // Named "mobile-chromium" to match the committed visual snapshot baselines.
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "tablet-chromium",
      testMatch: MULTI_VIEWPORT_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } },
    },
    {
      name: "desktop-chromium",
      testMatch: MULTI_VIEWPORT_SPECS,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Desktop only: the admin is a desk tool, so a phone project would test a shape
      // nobody uses.
      name: "admin-chromium",
      testDir: "./apps/admin/e2e",
      // `apps/e2e/` runs through playwright.compose.config.ts, so no `testIgnore` here.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: ADMIN_BASE_URL,
      },
    },
  ],
  webServer: [
    {
      // A wrapper, not `next dev` directly, so the server log is teed to the capture file
      // the log gate scans. Over plain http the session cookie is not `secure`, which the
      // loopback origin below keeps permitted rather than a boot refusal.
      command: `node ./apps/portal/e2e/support/portal-server.mjs`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI && ADOPTABLE.has("portal"),
      timeout: 180_000,
      env: {
        PORTAL_PORT: String(PORT),
        QCMS_PORTAL_BASE_URL: `http://localhost:${PORT}`,
        QCMS_API_BASE_URL: API_BASE_URL,
        QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
        // Matches the composed API's `QCMS_MOUNT: "all"`, so the portal serves `test`'s
        // respondent surface at `/test` (ADR-40, Q21).
        QCMS_PORTAL_ENVIRONMENTS: "test",
        // Also the switch that makes the portal's `instrumentation.ts` register OTel.
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
        // JSON, not the default protobuf: the receiver greps the captured bytes for an
        // answer string, which an encoder would hide (SEC-13).
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_SERVICE_NAME: OTEL_SERVICE_NAMES.portal,
        // Both pipelines: without the BLRP pair, log records run on the SDK default.
        OTEL_BSP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
        OTEL_BSP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
        OTEL_BLRP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
        OTEL_BLRP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
        // Non-default on purpose: a run at the shipped default cannot tell a value read
        // from config apart from a literal that happens to match it.
        QCMS_PORTAL_THEME: HARNESS_THEME,
        QCMS_PORTAL_CORNERS: HARNESS_CORNERS,
        QCMS_PORTAL_FONT: HARNESS_FONT,
        QCMS_PORTAL_FONTS: HARNESS_FONTS,
        QCMS_PORTAL_BRAND_NAME: HARNESS_BRAND_NAME,
        QCMS_PORTAL_BRAND_LOGO: HARNESS_BRAND_LOGO,
        // `QCMS_PORTAL_DENSITY` is deliberately unset: `theming.pw.ts` measures the
        // Comfortable defaults on rendered controls, so setting it here breaks that spec.
      },
    },
    {
      // Handed no database URL and no auth secret: better-auth lives in the API (ADR-35).
      command: `node ./apps/admin/e2e/support/admin-server.mjs`,
      // `/healthz`, not `/`: Playwright reads a 5xx as "not started" and gates globalSetup
      // on readiness, so probing a page that needs the API would wait on globalSetup.
      url: `${ADMIN_BASE_URL}/healthz`,
      reuseExistingServer: !process.env.CI && ADOPTABLE.has("admin"),
      timeout: 180_000,
      env: {
        ADMIN_PORT: String(ADMIN_PORT),
        // The SEC-9 origin check compares every state-changing POST against this value.
        QCMS_ADMIN_BASE_URL: ADMIN_BASE_URL,
        QCMS_API_BASE_URL: API_BASE_URL,
        QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_SERVICE_NAME: OTEL_SERVICE_NAMES.admin,
        OTEL_BSP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
        OTEL_BSP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
        OTEL_BLRP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
        OTEL_BLRP_EXPORT_TIMEOUT: OTLP_EXPORT_TIMEOUT_MS,
        QCMS_PORTAL_THEME: HARNESS_THEME,
        // Pinned although `required` is already the default: `next dev` fills an undefined
        // variable from `apps/admin/.env.local`, where a developer may have weakened it.
        QCMS_ADMIN_2FA: "required",
        QCMS_FLAG_AGENT_AUTHORING: "fake",
      },
    },
  ],
});
