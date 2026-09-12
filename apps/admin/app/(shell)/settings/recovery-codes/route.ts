import { generateBackupCodes } from "@/lib/server/auth-api";
import { recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

/**
 * Where a refusal lands. Its own markers rather than the shared `error`/`throttled` pair,
 * so the message appears beside the form that produced it instead of under the password
 * form, and so the panel carrying that form is the one the screen opens on
 * (`lib/settings-sections.ts`). The sentences themselves are the shared ones (SEC-1):
 * `codesError` renders the generic failure and `codesThrottled` renders the throttle,
 * both through `lib/auth-failure-message.ts`.
 */
const SETTINGS_PATH = "/settings";

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
 * **The `429` is separated out, for the reason issue #805 separated it on the two-factor
 * verify handlers** (issue #845, the ruling of 2026-09-12). This call is
 * `/two-factor/generate-backup-codes`, so it draws on the same `/two-factor/*` bucket
 * those handlers do - three attempts per ten seconds, keyed on a constant on the default
 * Compose shape (issue #482), which is why an operator can meet it without having got
 * anything wrong. It matters here because the form is the remedy for lost codes: an admin
 * told "that password did not match" while the truth was "not right now" has been told
 * their password is wrong at the moment they are already unsure of it, and the retry that
 * message asks for is what holds the window open. The sentence is sign-in's, so no new
 * copy joins the Settings screen.
 *
 * The shell layout's gate does not cover route handlers reached by a direct browser
 * POST, so the session policy is applied here as well - the same reasoning, and the
 * same helper, as the password handler beside it (issue #177).
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SETTINGS_PATH, "codesError");

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const password = formField(await request.formData(), "password");
  if (password === undefined) return redirectWithGenericFailure(SETTINGS_PATH, "codesError");

  const generated = await generateBackupCodes(request.headers, password);
  // A wrong password arrives as a 4xx Response rather than a throw (see `authRefused`),
  // and so does the throttle's refusal - the status is the only thing separating them.
  if (authRefused(generated)) {
    return redirectWithGenericFailure(
      SETTINGS_PATH,
      authThrottled(generated) ? "codesThrottled" : "codesError",
    );
  }

  const { backupCodes } = (await generated.json()) as { backupCodes: string[] };
  return redirectAfterPost("/two-factor/recovery-codes", [recoveryCodesCookie(backupCodes)]);
}
