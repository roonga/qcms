import { createTestAdmin as createAdminAccount } from "../../../api/e2e/support/admin-accounts.js";
import { readFixtures } from "../../../portal/e2e/support/fixtures.js";

import { ADMIN_BASE_URL, FIXED_AUTH_SECRET } from "./harness-config.js";

/**
 * Test-account setup for the admin Playwright suite (task 031; re-pointed at the API by
 * task 056).
 *
 * The suite needs an admin account with a password better-auth can verify, before the
 * browser opens. The instance that can create one now lives in `apps/api`, so this module
 * is a thin call into `apps/api/e2e/support/admin-accounts.ts` - which is also what keeps
 * the admin package free of a database client (`pg`, `drizzle-orm` and `@roonga/qcms-db` resolve
 * from the api workspace there, never from this one).
 *
 * ## Where the database URL comes from now
 *
 * From the fixtures file `globalSetup` writes, read at call time. Before this task the
 * admin dev server was handed the fixtures **path** through `QCMS_ADMIN_E2E_FIXTURES` and
 * resolved a connection string per request, because it held better-auth's database handle
 * and could not be told the URL at spawn time (Playwright starts webServers alongside
 * globalSetup, not after it). The dev server needs no database at all now, so that seam is
 * retired: the composed API in `globalSetup` is handed `DATABASE_URL` directly, and this
 * runner-side helper reads the same fixtures file the specs already read.
 *
 * The signing secret is `FIXED_AUTH_SECRET`, the same value the harness gives the composed
 * API, so a cookie minted on either side verifies on the other.
 *
 * Nothing else about the flow is shortcut: enrollment, the TOTP secret, the recovery codes
 * and every verification happen in the browser, through the real screens, and the specs
 * read the secret and the codes off the page exactly as an operator would.
 */

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
  await createAdminAccount({
    databaseUrl: readFixtures().databaseUrl,
    authSecret: FIXED_AUTH_SECRET,
    adminBaseUrl: ADMIN_BASE_URL,
    email,
    password: TEST_PASSWORD,
  });
}
