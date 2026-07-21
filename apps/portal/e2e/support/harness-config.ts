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

/** Synthetic shared SEC-4 internal token (test-only, not a real secret). */
export const FIXED_INTERNAL_TOKEN = "qcms-e2e-portal-shared-internal-token-000000";

/** Absolute path of the fixtures the specs read (written by globalSetup). */
export const FIXTURES_PATH = fileURLToPath(
  new URL("../../.playwright/fixtures.json", import.meta.url),
);
