import { fileURLToPath } from "node:url";

import { PORT_SEAT, harnessPort } from "../../../portal/e2e/support/port-seat.js";

/**
 * Shared constants for the admin Playwright harness (task 031).
 *
 * The admin suite rides on the **one** root Playwright config (ADR-23) and reuses the
 * portal harness's `globalSetup`, which already boots a Testcontainers Postgres,
 * migrates it to head, and serves the composed API. So there is no second database and
 * no second API here: the admin dev server points at the same two, which is also the
 * real topology (one Postgres, one API, two frontends).
 *
 * Since task 056 the admin dev server needs **no** database URL at all: better-auth lives
 * in the API, so the admin is a pure BFF and the composed API is handed `DATABASE_URL`
 * directly by `globalSetup`. That retired the `QCMS_ADMIN_E2E_FIXTURES` seam, which
 * existed only because the admin held a database handle and could not be told the URL at
 * spawn time (Playwright starts webServers alongside globalSetup, not after it).
 */

/**
 * The port the admin dev server listens on.
 *
 * Derived from the run's seat rather than written down: seat S owns `17S00`-`17S99`
 * and the admin sits at `17S40` (the portal is at `17S00`). The rule, the table and
 * the reasoning are in `docs/PORTS.md`; the arithmetic is in `scripts/ports.mjs`,
 * reached here through the portal harness's `port-seat.ts` for the same reason the
 * fixtures path and the SEC-4 token come from there: one database, one API, two
 * frontends, so one set of constants.
 */
export const ADMIN_PORT = harnessPort("admin", PORT_SEAT);

/**
 * The admin app's own base URL. The admin reads it for the SEC-9 origin check, and the
 * composed API reads it as better-auth's `baseURL` and sole trusted origin, so both
 * sides of the proxied hop agree on which origin the cookies belong to.
 */
export const ADMIN_BASE_URL = `http://localhost:${ADMIN_PORT}`;

/**
 * Synthetic better-auth signing secret for the suite (test-only, never a real
 * credential). Since task 056 it is handed to the **API** (which owns the instance) and
 * to the runner-side account helper, which must agree with it or the cookies one mints
 * are not the cookies the other verifies. Fixed rather than random so a reused dev
 * server and a fresh runner agree on it: a rotated secret would invalidate cookies
 * mid-run. Length is over the 32-char minimum the config validator enforces.
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
