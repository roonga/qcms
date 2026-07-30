/**
 * Shared constants for the portal Playwright harness (task 029).
 *
 * `playwright.config.ts` (the webServer env) and `api-server.ts` (the composed
 * API) both import from here so the SEC-4 internal token is *identical* on both
 * sides of the wire: the separately-spawned portal dev server presents this token
 * to the in-process composed API, which was built to accept exactly it.
 *
 * The token is a synthetic, test-only value (never a real credential): it exists
 * only to let the two processes authenticate to each other. It is >= the config
 * `MIN_SECRET_LENGTH` (32) and contains no whitespace or comma (the key-list
 * parser splits on those).
 */

import { fileURLToPath } from "node:url";

/** The port the composed API listens on (in the globalSetup process). */
export const API_PORT = 4010;

/** The base URL the portal BFF calls (server-only `QCMS_API_BASE_URL`). */
export const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;

/** The port the portal dev server listens on. */
export const PORTAL_PORT = 3100;

/**
 * The in-test OTLP receiver's port and base endpoint (task 054).
 *
 * Deliberately NOT 4318 (the OTLP/HTTP default): a developer running the
 * documented local trace viewer holds that port, and the suite must not silently
 * export into it - or fail to bind because it is taken.
 */
export const OTLP_PORT = 4319;

/** What both traced processes get as `OTEL_EXPORTER_OTLP_ENDPOINT`. */
export const OTLP_ENDPOINT = `http://127.0.0.1:${OTLP_PORT}`;

/** Service names the traced e2e run reports, so a span's origin is unambiguous. */
export const OTEL_SERVICE_NAMES = {
  api: "qcms-api-e2e",
  portal: "qcms-portal-e2e",
} as const;

/**
 * How long the batch span processors wait before exporting
 * (`OTEL_BSP_SCHEDULE_DELAY`). The SDK default is 5s, which the trace spec would
 * spend waiting on every run; 500ms keeps it prompt without exporting per span.
 */
export const OTLP_SCHEDULE_DELAY_MS = "500";

/** Synthetic shared SEC-4 internal token (test-only, not a real secret). */
export const FIXED_INTERNAL_TOKEN = "qcms-e2e-portal-shared-internal-token-000000";

/**
 * Per-deployment theming config the harness runs the portal under (task 051).
 *
 * Deliberately NOT the defaults: the whole browser suite runs on an ALTERNATE
 * theme and an alternate corner preset, so `QCMS_PORTAL_THEME` /
 * `QCMS_PORTAL_CORNERS` are proven end to end (config -> `<html>` -> computed
 * style) rather than only where the shipped defaults would have matched anyway.
 * The default resolution and the typo fallback are covered by
 * `lib/server/theme.test.ts`.
 */
export const HARNESS_THEME = "harbor";
export const HARNESS_CORNERS = "rounded";

/**
 * Per-deployment FONT config the harness runs the portal under (task 052).
 *
 * Same reasoning as the theme above: the whole browser suite runs on a curated
 * subset with a non-default default font, so `QCMS_PORTAL_FONT` /
 * `QCMS_PORTAL_FONTS` are proven end to end (config -> `<html class>` -> the
 * computed `font-family` -> a real same-origin `woff2` request) rather than only
 * where the shipped System default would have matched anyway. It also means every
 * other spec in the suite runs on a self-hosted webfont, so a font that failed to
 * load would show up as collateral damage across the suite, not just here.
 *
 * `HARNESS_FONTS` deliberately omits most of the registry and deliberately omits
 * `system`, which `fontChoices()` must add back: that is the "System can never be
 * curated away" rule, observed through config rather than asserted in a unit test.
 */
export const HARNESS_FONT = "inter";
export const HARNESS_FONTS = "atkinson, inter, merriweather, jetbrainsmono";

/** Absolute path of the fixtures the specs read (written by globalSetup). */
export const FIXTURES_PATH = fileURLToPath(
  new URL("../../.playwright/fixtures.json", import.meta.url),
);

/**
 * Absolute directory the server-side logs are captured into for the run window
 * (task 045, exit criterion 5): the composed API's structured log, the Postgres
 * container's server log, and the portal dev-server's stdout/stderr. The log
 * gate scans these for any error/warn-level line.
 */
export const SERVER_LOG_DIR = fileURLToPath(
  new URL("../../.playwright/server-logs/", import.meta.url),
);

/** The three captured server-log files (API, Postgres, portal server). */
export const SERVER_LOG_FILES = {
  api: `${SERVER_LOG_DIR}api.log`,
  postgres: `${SERVER_LOG_DIR}postgres.log`,
  portal: `${SERVER_LOG_DIR}portal.log`,
} as const;

/**
 * Where the in-test OTLP receiver appends every exported payload, verbatim, one
 * JSON body per line (task 054). Written in the Playwright runner process by
 * `otlp-receiver.ts`; read by `otel-trace.pw.ts` in a worker process, which is why
 * it is a file rather than a module singleton.
 */
export const OTLP_CAPTURE_PATH = fileURLToPath(
  new URL("../../.playwright/otlp/spans.jsonl", import.meta.url),
);

/**
 * Where `fonts.pw.ts` writes the per-font WCAG 1.4.12 measurements it takes
 * (task 052). The same table is attached to the Playwright report; the file exists
 * so a GREEN run leaves the numbers readable, since `docs/theming.md` states them.
 */
export const FONT_FLOORS_PATH = fileURLToPath(
  new URL("../../.playwright/font-floors.txt", import.meta.url),
);
