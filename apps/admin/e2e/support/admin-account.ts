import { FIXTURES_PATH } from "../../../portal/e2e/support/harness-config.js";

import { ADMIN_BASE_URL, FIXED_AUTH_SECRET } from "./harness-config.js";

/**
 * Test-account setup for the admin Playwright suite (task 031).
 *
 * The suite needs an admin account with a password better-auth can verify, and it needs
 * it before the browser opens. It creates one by calling `signUpEmail` in the runner
 * process against the same database the dev server uses, which **deliberately bypasses
 * the CLI's zero-admins guard**. That is not a hole being papered over: the guard is a
 * property of `pnpm qcms:create-admin` (nothing else may create the first account), and
 * it is tested where it lives, against a genuinely empty database, in
 * `lib/server/bootstrap.integration.test.ts`. What this suite is for is the browser
 * flow, and forcing it through a once-per-database command would let it test exactly one
 * account, once.
 *
 * Nothing else about the flow is shortcut. Enrollment, the TOTP secret, the recovery
 * codes and every verification happen in the browser, through the real screens - the
 * specs read the secret and the codes off the page exactly as an operator would.
 *
 * The environment is set here, at module scope, because `getAuth()` reads it on first
 * use: the same fixtures-file seam the dev server uses (`lib/server/db.ts`) points this
 * process at the run's throwaway Postgres, and the same fixed signing secret means the
 * cookies this process would mint and the ones the dev server mints are interchangeable.
 */

process.env.QCMS_ADMIN_E2E_FIXTURES = FIXTURES_PATH;
process.env.QCMS_ADMIN_BASE_URL = ADMIN_BASE_URL;
process.env.QCMS_ADMIN_AUTH_SECRET = FIXED_AUTH_SECRET;

// Imported after the environment is populated. The instance is lazy, so a static import
// would work too; keeping the order explicit documents the dependency.
const { getAuth } = await import("../../lib/server/auth.ts");

/**
 * A synthetic password for the suite's accounts, **generated per run** rather than written
 * down. Two reasons, one of which is not tidiness: a literal here is a hard-coded credential
 * the lint gate flags (correctly - that is how a real one eventually gets committed next to
 * it), and a fresh value per run means a leaked log line from one run authorizes nothing in
 * the next. Length is well over the 12-character minimum.
 */
export const TEST_PASSWORD = `e2e-admin-${Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString("base64url")}`;

/** A per-spec-file unique email, so files never contend over one account's 2FA state. */
export function uniqueAdminEmail(label: string): string {
  return `e2e.${label}.${Date.now().toString(36)}@admin.test`;
}

/** Create an admin account with no TOTP factor yet: enrollment is the browser's job. */
export async function createTestAdmin(email: string): Promise<void> {
  await getAuth().api.signUpEmail({
    body: { email, password: TEST_PASSWORD, name: "E2E Admin" },
    asResponse: true,
  });
}

/**
 * There is deliberately **no** pool-closing helper here, and the reason is a trap worth
 * recording: closing the pool in a spec file's `afterAll` breaks the *next* spec file.
 * Playwright runs the files of a project in one worker process, so this module's state -
 * including the better-auth instance memoized against its pool - outlives any single file.
 * A file that closed the pool left the following file with a live auth instance over a dead
 * pool, failing its `beforeAll` with a raw `Failed query: select ... from "user"`.
 *
 * Nothing has to be closed. Playwright exits its workers before running globalTeardown, so
 * the pool is gone by the time the container stops. (The Vitest side is different and does
 * need `closeAdminDb()`: there the container teardown runs in the same process as the pool.)
 */
