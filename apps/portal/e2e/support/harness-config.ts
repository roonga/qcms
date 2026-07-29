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
