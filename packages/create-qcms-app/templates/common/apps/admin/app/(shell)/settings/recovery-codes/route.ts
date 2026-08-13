import { generateBackupCodes } from "@/lib/server/auth-api";
import { recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  formField,
  isSameOriginPost,
  redirectAfterPost,
} from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * Where a refusal lands. Its own marker rather than the shared `?error=1`, so the one
 * fixed sentence appears beside the form that produced it instead of under the
 * password form; the sentence itself is the same generic one (SEC-1).
 */
const SETTINGS_FAILURE_PATH = "/settings?codesError=1";

/**
 * Issue a fresh set of recovery codes for the signed-in admin (issue #319).
 *
 * This is what replaced `POST /admin/auth/recovery-codes`, the route that decrypted
 * and returned the codes already on record. The difference is the whole point:
 *
 * - **Re-authentication comes with the operation.** better-auth's
 *   `generateBackupCodes` requires the account password, so a borrowed session is not
 *   enough. The old read needed only a live session, and better-auth's own guidance
 *   for the read it wrapped asks for a *fresh* one, which `AdminPrincipal` cannot
 *   express (it carries no `session.createdAt`).
 * - **A leaked set stops working.** Regenerating overwrites the stored blob, so any
 *   copy an attacker holds dies with it. Reading the set back left it valid.
 *
 * The generated codes reach the display screen in the same short-lived cookie the
 * enrollment flow uses, and are gone from this app after the "I have saved these"
 * confirm (`lib/server/enrollment.ts`). Nothing about them is logged (SEC-8).
 *
 * A wrong password redirects back with the same opaque marker every auth failure uses;
 * distinguishing it from "no factor enrolled" would answer a question about the account
 * that the person at the keyboard has not proved they may ask (SEC-1).
 *
 * The shell layout's gate does not cover route handlers reached by a direct browser
 * POST, so the session policy is applied here as well - the same reasoning, and the
 * same helper, as the password handler beside it (issue #177).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectAfterPost(SETTINGS_FAILURE_PATH);

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const password = formField(await request.formData(), "password");
  if (password === undefined) return redirectAfterPost(SETTINGS_FAILURE_PATH);

  const generated = await generateBackupCodes(request.headers, password);
  if (authRefused(generated)) return redirectAfterPost(SETTINGS_FAILURE_PATH);

  const { backupCodes } = (await generated.json()) as { backupCodes: string[] };
  return redirectAfterPost("/two-factor/recovery-codes", [recoveryCodesCookie(backupCodes)]);
}
