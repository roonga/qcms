import { fileURLToPath } from "node:url";

/**
 * Shared constants for the admin Playwright harness (task 031).
 *
 * The admin suite rides on the **one** root Playwright config (ADR-23) and reuses the
 * portal harness's `globalSetup`, which already boots a Testcontainers Postgres,
 * migrates it to head, and serves the composed API. So there is no second database and
 * no second API here: the admin dev server points at the same two, which is also the
 * real topology (one Postgres, one API, two frontends).
 *
 * The admin dev server needs the database URL that setup chose, and it cannot be handed
 * it at spawn time (Playwright starts webServers alongside globalSetup, not after it).
 * So it is passed the **path** to the fixtures file setup writes, and reads the URL from
 * there per request - see `lib/server/db.ts` for why that seam exists and why it also
 * makes a reused dev server safe across runs.
 */

/** The port the admin dev server listens on (the portal uses 3100). */
export const ADMIN_PORT = 3200;

/** The admin app's own base URL, which better-auth scopes its cookies to. */
export const ADMIN_BASE_URL = `http://localhost:${ADMIN_PORT}`;

/**
 * Synthetic better-auth signing secret for the suite (test-only, never a real
 * credential). Fixed rather than random so a reused dev server and a fresh runner agree
 * on it: a rotated secret would invalidate cookies mid-run. Length is over the 32-char
 * minimum `authSecret()` enforces.
 */
export const FIXED_AUTH_SECRET = "qcms-e2e-admin-better-auth-secret-0000000000";

/**
 * Absolute path of the admin dev server's captured stdout/stderr.
 *
 * Captured for debugging a failing run, and deliberately NOT wired into the shared
 * server-log gate: that gate reads a fixed three-file set in the portal harness
 * (`SERVER_LOG_FILES`), and widening it is a change to `gates.ts`, which task 031 does
 * not own. Recorded as a follow-up.
 */
export const ADMIN_SERVER_LOG = fileURLToPath(
  new URL("../../.playwright/server-logs/admin.log", import.meta.url),
);
