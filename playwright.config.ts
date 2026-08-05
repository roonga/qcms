import { defineConfig, devices } from "@playwright/test";

import {
  ADMIN_BASE_URL,
  ADMIN_PORT,
  FIXED_AUTH_SECRET,
} from "./apps/admin/e2e/support/harness-config.js";
import {
  API_BASE_URL,
  API_PORT,
  FIXED_INTERNAL_TOKEN,
  FIXTURES_PATH,
  HARNESS_BRAND_LOGO,
  HARNESS_BRAND_NAME,
  HARNESS_CORNERS,
  HARNESS_FONT,
  HARNESS_FONTS,
  HARNESS_THEME,
  OTEL_SERVICE_NAMES,
  OTLP_ENDPOINT,
  OTLP_PORT,
  OTLP_SCHEDULE_DELAY_MS,
  PORTAL_PORT,
} from "./apps/portal/e2e/support/harness-config.js";
import {
  PORT_SEAT,
  PREFLIGHT_DONE_VAR,
  seatPreflight,
} from "./apps/portal/e2e/support/port-seat.js";

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
 *
 * Task 031 adds the admin app to this same config rather than a second one, which is
 * what ADR-23's "one browser-test framework" means in practice and has a concrete
 * payoff: the existing CI browser job runs `pnpm exec playwright test`, so the admin's
 * axe gate is CI-enforced the moment its project exists, with no second job to
 * remember (the failure mode 029 shipped and 030 had to fix). The admin gets its own
 * project - with its own `testDir` and `baseURL`, leaving the portal projects and
 * their snapshot baselines untouched - and its own `webServer` entry. It shares this
 * run's Postgres and composed API, which is also the real topology: one database, one
 * API, two frontends.
 */
/**
 * Startup preflight, at config load, which is before Playwright evaluates any
 * `webServer` entry and therefore before `reuseExistingServer` can adopt anything
 * (issue #255). In order:
 *
 *  - **A worktree must name its seat.** Concurrent lanes run in worktrees, and two
 *    lanes that both fall back to the default seat collide on every port. The primary
 *    checkout and CI keep the silent default.
 *  - **The seat's ports must be legal to hold.** A fixed listener inside the kernel's
 *    ephemeral range loses an occasional race to an auto-assigned socket, which is a
 *    flake nobody could reproduce.
 *  - **Nothing else may already hold them.** This one is a *diagnostic*, not the
 *    safety property: it is a fast, clear error for the common case (someone forgot a
 *    seat), and it names the occupant's pid and `/proc/<pid>/cwd` rather than making
 *    the next person read `/proc` by hand, the way the original collision was found.
 *    It cannot make concurrent binding safe - between the probe and the bind another
 *    run can still take the port. Per-seat isolation is what makes sharing not happen.
 *
 * Before the seat scheme, a second agent lane starting a run while the first lane's
 * dev servers were up did not fail and did not warn: Playwright reused those servers,
 * so the second lane's specs ran against the first lane's worktree and still reported
 * a full green suite.
 *
 * The preflight also returns what this run may ADOPT, which is what drives
 * `reuseExistingServer` below. That flag is the amplifier: without it a collision is a
 * noisy `EADDRINUSE`, with it a collision is a silent green run against another tree,
 * and that asymmetry is why issue #255 is a gate-integrity item rather than an
 * inconvenience. So it is no longer `!CI`. It is on only for a dev server that is
 * already listening and whose working directory is inside this exact worktree, which
 * is the case it was actually there for. When the port is free at config load the flag
 * is off, so a run that loses the bind race to a process arriving a second later fails
 * loudly instead of adopting the winner. That is the direction a race has to fail in,
 * and it is precisely what a probe on its own cannot deliver.
 *
 * It runs exactly once per invocation: Playwright reloads this config in every worker,
 * by which time globalSetup has bound the API and OTLP ports, and those two are never
 * adoptable. See `seatPreflight`.
 */
// Read BEFORE the preflight, which is what sets the sentinel.
const FIRST_LOAD = process.env[PREFLIGHT_DONE_VAR] !== "1";
const ADOPTABLE = seatPreflight();

// Announce the seat ONCE per invocation. A run's own output is then self-describing
// ("this was seat 2, on 17200/17210/17230/17240"), which is what a reviewer needs to
// tell two concurrent seats' evidence apart without going back to the process table.
// Guarded because Playwright reloads this config in every worker, so an unguarded
// write prints once per process and noises up the CI log for no extra information.
if (FIRST_LOAD) {
  process.stdout.write(
    `[playwright] port seat ${String(PORT_SEAT)}: portal ${String(PORTAL_PORT)}, ` +
      `api ${String(API_PORT)}, admin ${String(ADMIN_PORT)}, otlp ${String(OTLP_PORT)}\n`,
  );
}

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
    // Failure forensics (issue #102), CI-ONLY by design: in CI, a screenshot on
    // every failure and a trace from the first retry, uploaded by ci.yml's
    // if-failure artifact step so a CI-only browser failure is debuggable without
    // local reproduction. Local runs capture nothing (a local failure is already
    // reproducible in place); passing runs record nothing anywhere.
    screenshot: process.env.CI ? "only-on-failure" : "off",
    trace: process.env.CI ? "on-first-retry" : "off",
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
    {
      // The admin app (task 031). Its own `testDir`, so the portal projects above are
      // untouched, and its own `baseURL`, because it is a separate deployable on a
      // separate port. Desktop-only: the admin is an internal authoring tool used at a
      // desk (ARCHITECTURE §6), the opposite of the portal's phone-first respondents,
      // so a phone project here would test a shape nobody uses.
      name: "admin-chromium",
      testDir: "./apps/admin/e2e",
      // The full-stack flow lives in `apps/e2e/` and runs through
      // playwright.compose.config.ts, so no `testIgnore` is needed here: it owns
      // its own generated credentials and a Compose topology this suite's global
      // setup deliberately does not use.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: ADMIN_BASE_URL,
      },
    },
  ],
  webServer: [
    {
      // Run the portal DEV server through a wrapper that tees its stdout/stderr to
      // the server-log capture file (exit 5), so the log gate can scan it. Over http
      // localhost the session cookie is not `secure` (isProduction() is false), so
      // the real cookie-backed flow works. The BFF reaches the composed API booted
      // by globalSetup; both sides share the synthetic SEC-4 internal token.
      command: `node ./apps/portal/e2e/support/portal-server.mjs`,
      url: `http://localhost:${PORT}`,
      // Only when a portal dev server from THIS worktree is already listening. See
      // ADOPTABLE above for why a free port means `false` rather than `true`.
      reuseExistingServer: !process.env.CI && ADOPTABLE.has("portal"),
      timeout: 180_000,
      env: {
        PORTAL_PORT: String(PORT),
        // The start BFF redirects respondents to this public portal origin.
        // In the browser harness, the portal is reachable at its seat's localhost URL.
        QCMS_PORTAL_BASE_URL: `http://localhost:${PORT}`,
        QCMS_API_BASE_URL: API_BASE_URL,
        QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
        // Tracing on, pointed at the in-test OTLP receiver globalSetup boots (task
        // 054). This is also the switch that makes the portal's `instrumentation.ts`
        // call `registerOTel` at all - with it unset the portal starts no SDK, which
        // is what every other suite and CI job exercises.
        OTEL_EXPORTER_OTLP_ENDPOINT: OTLP_ENDPOINT,
        // JSON, not the exporter's default protobuf: the receiver is 40 lines of
        // `node:http` and the SEC-13 assertion greps the captured bytes for an answer
        // string, which a protobuf payload would hide behind an encoder.
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_SERVICE_NAME: OTEL_SERVICE_NAMES.portal,
        OTEL_BSP_SCHEDULE_DELAY: OTLP_SCHEDULE_DELAY_MS,
        // Per-deployment theming (ADR-30, task 051), set to a NON-default theme and
        // corner preset on purpose - see HARNESS_THEME.
        QCMS_PORTAL_THEME: HARNESS_THEME,
        QCMS_PORTAL_CORNERS: HARNESS_CORNERS,
        // Per-deployment font config (task 052), likewise non-default: a curated
        // subset that omits `system`, and a default font from inside it. See
        // HARNESS_FONT / HARNESS_FONTS.
        QCMS_PORTAL_FONT: HARNESS_FONT,
        QCMS_PORTAL_FONTS: HARNESS_FONTS,
        // Per-deployment BRAND config (task 053, issue #25), likewise non-default: the
        // header mark and the document title are proven to come from config rather
        // than from a literal. See HARNESS_BRAND_NAME.
        QCMS_PORTAL_BRAND_NAME: HARNESS_BRAND_NAME,
        QCMS_PORTAL_BRAND_LOGO: HARNESS_BRAND_LOGO,
        // `QCMS_PORTAL_DENSITY` is deliberately NOT set, so the suite runs at the
        // shipped Comfortable default: `theming.pw.ts` measures the Comfortable
        // spacing values (44px control height, 36px card padding) on rendered
        // controls, and those assertions only mean anything while the base level is
        // what the server serves. The config path is covered by
        // `lib/server/theme.test.ts`, and `appearance.pw.ts` drives the same
        // server-side resolution through the density cookie, which is the path a
        // respondent actually takes.
      },
    },
    {
      // The admin DEV server (task 031), through its own wrapper. Two things differ
      // from the portal's: the wrapper waits for `globalSetup` to write the fixtures
      // file before starting, and the admin is given the fixtures **path** rather than
      // a database URL. It needs a database (better-auth), the database is a
      // throwaway container on a random port, and Playwright starts webServers
      // alongside globalSetup rather than after it - so the URL cannot be known at
      // spawn time. Reading it per request also means a locally reused dev server
      // picks up the current run's database instead of a dead pool from the last one
      // (see `apps/admin/lib/server/db.ts`).
      command: `node ./apps/admin/e2e/support/admin-server.mjs`,
      // `/healthz` rather than `/`: Playwright treats a 5xx as "not started" and gates
      // globalSetup on webServer readiness, so probing a page that needs the database
      // would wait for the very thing globalSetup is about to create.
      url: `${ADMIN_BASE_URL}/healthz`,
      // Same rule as the portal's: adopt only a verified same-worktree server.
      reuseExistingServer: !process.env.CI && ADOPTABLE.has("admin"),
      timeout: 180_000,
      env: {
        ADMIN_PORT: String(ADMIN_PORT),
        QCMS_ADMIN_E2E_FIXTURES: FIXTURES_PATH,
        QCMS_ADMIN_BASE_URL: ADMIN_BASE_URL,
        QCMS_ADMIN_AUTH_SECRET: FIXED_AUTH_SECRET,
        // The BFF's credentials for the API. No 031 screen proxies yet (the area
        // screens are 032-035), but the admin shares the portal's synthetic token so
        // the first screen that does needs no harness change.
        QCMS_API_BASE_URL: API_BASE_URL,
        QCMS_INTERNAL_TOKEN: FIXED_INTERNAL_TOKEN,
        // Left at the default (`required`) deliberately: enforced-by-default 2FA is
        // the behaviour under test, so the escape hatch must not be set here.
      },
    },
  ],
});
