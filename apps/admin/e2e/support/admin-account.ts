import {
  createTestAdmin as createAdminAccount,
  openDbHandle,
} from "../../../api/e2e/support/admin-accounts.js";
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

/**
 * Create an admin account with no TOTP factor yet: enrollment is the browser's job.
 *
 * `name` is the account's display name and defaults to `E2E Admin`. Pass one when the
 * spec cares what the topbar's monogram paints - which is only the label-in-name gate, so
 * far (issue #1010); see `TestAdminInput.name` for why that default cannot measure it.
 *
 * `mustChangePassword` opts into SEC-1's provisional bootstrap state (task 061),
 * which is what `qcms:create-admin` produces and what `forced-password-change.pw.ts`
 * is about. Every other spec leaves it off and gets an account that signs straight in,
 * because a password change is not what those specs test; the API-side helper's
 * docblock carries the reasoning.
 *
 * Both arrive in one options object rather than as positional arguments, which is what
 * the two of them landing in the same week settled: a second optional string beside a
 * first would have been two call shapes to remember and one transposition away from a
 * silent wrong answer.
 */
export async function createTestAdmin(
  email: string,
  options: { readonly name?: string; readonly mustChangePassword?: boolean } = {},
): Promise<void> {
  await createAdminAccount({
    databaseUrl: readFixtures().databaseUrl,
    authSecret: FIXED_AUTH_SECRET,
    adminBaseUrl: ADMIN_BASE_URL,
    email,
    password: TEST_PASSWORD,
    ...(options.name !== undefined && { name: options.name }),
    mustChangePassword: options.mustChangePassword === true,
  });
}

/**
 * Set SEC-1's provisional flag on an account that already exists (task 061).
 *
 * The one state `createTestAdmin` cannot produce, and the only spec that wants it is the
 * one proving the gate list is load-bearing on its own: an **enrolled** account still
 * holding the bootstrap credential. It cannot be built forwards, because enrolment needs a
 * session and a provisional account is sent to the change screen before one is provisioned
 * - which is the control working. So the account is enrolled first and marked afterwards.
 *
 * A raw statement rather than a query builder, for the reason `openDbHandle` exists: the
 * database client belongs to the API workspace, and this is harness code reaching for one
 * row. It is the exact inverse of `clearMustChangePassword`, which is the product's own
 * write, so the harness cannot reach a state the product cannot.
 */
export async function markProvisional(email: string): Promise<void> {
  const handle = openDbHandle(readFixtures().databaseUrl);
  try {
    const updated = await handle.query(
      `update "user" set "mustChangePassword" = true where email = $1`,
      [email],
    );
    // A silent no-op here would make the spec below pass for the wrong reason: an account
    // that was never marked reaches every route, and "every route redirected" would be
    // vacuous in the other direction.
    if (updated.rows.length === 0 && (updated as { rowCount?: number }).rowCount === 0) {
      throw new Error(`markProvisional matched no account for ${email}`);
    }
  } finally {
    await handle.close();
  }
}
