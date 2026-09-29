import { changePassword } from "@/lib/server/auth-api";
import { passwordRefusalFrom } from "@/lib/server/password-refusal";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithCompromisedPassword,
  redirectWithGenericFailure,
  redirectWithPasswordMismatch,
} from "@/lib/server/route-helpers";
import {
  CHANGE_PASSWORD_PATH,
  ENROLL_PATH,
  SHELL_HOME_PATH,
  requirePasswordChangeSessionForRequest,
} from "@/lib/server/session";
import { twoFactorOptional } from "@/lib/server/config";

/**
 * Complete the forced password change (task 061; SEC-1).
 *
 * This is the one operation an admin still holding the provisional bootstrap
 * credential is allowed to perform, and it is the only thing that clears the flag.
 * The clearing itself is **not** here: the API installs an `account.update.after`
 * database hook on better-auth, which fires when the library writes the new password
 * hash and nothing else reaches. So a refusal on any path below leaves the flag set
 * without this handler having to remember to, and a change made from Settings by an
 * admin who somehow still carries the flag clears it through the same hook.
 * `apps/api/src/features/auth/instance.ts` carries that reasoning and its citations.
 *
 * ## Why it does not use `requireAdminSessionForRequest()`
 *
 * That guard is the shell's, and it redirects a flagged session to this very path -
 * so this handler would refuse itself, in a loop, for exactly the accounts it exists
 * to serve. `requirePasswordChangeSessionForRequest()` is the same policy with gate 3
 * inverted: a session is required, the flag must still be set, and an admin who has
 * already changed their password is sent on rather than allowed to use this as a
 * second, unguarded change-password surface. `shell-route-guards.test.ts` does not
 * scan this file because it is outside `app/(shell)/`, which is where every auth-flow
 * handler has to live; `lib/server/session.ts` lists that seam and its three
 * exceptions in one place.
 *
 * ## Why the confirmation is checked here and not by the API
 *
 * The API has one new password and no opinion about whether the person typing it
 * meant it. A confirmation field is a property of this form, so its mismatch is
 * refused before the call rather than turned into a change nobody intended - and it
 * gets its own sentence, because it says nothing about the account (see the catalog
 * entry, and `lib/server/password-refusal.ts` for the same argument made about the
 * breach-corpus refusal).
 *
 * ## What lands where
 *
 * `revokeOtherSessions: true` comes with `changePassword` and is SEC-1's requirement
 * rather than a nicety: a password change invalidates sessions server-side, or a
 * stolen session outlives the credential that created it. better-auth issues a fresh
 * session for this browser in the same call, so those cookies are carried onto the
 * redirect. The redirect goes to enrollment or to the shell by the same rule the gate
 * applies, so a bootstrap admin walks password change then 2FA in one pass.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(CHANGE_PASSWORD_PATH);

  const session = await requirePasswordChangeSessionForRequest();
  if (session instanceof Response) return session;

  const form = await request.formData();
  const currentPassword = formField(form, "currentPassword");
  const newPassword = formField(form, "newPassword");
  const confirmPassword = formField(form, "confirmPassword");
  if (currentPassword === undefined || newPassword === undefined) {
    return redirectWithGenericFailure(CHANGE_PASSWORD_PATH);
  }
  if (newPassword !== confirmPassword) return redirectWithPasswordMismatch(CHANGE_PASSWORD_PATH);

  const changed = await changePassword(request.headers, { currentPassword, newPassword });

  if (authRefused(changed)) {
    // Status before body, the order `authFailureMessage` reads its markers in: a
    // throttled request never got as far as being judged, so there is no refusal code
    // in it to classify.
    if (authThrottled(changed)) {
      return redirectWithGenericFailure(CHANGE_PASSWORD_PATH, "throttled");
    }
    return (await passwordRefusalFrom(changed)) === "compromised"
      ? redirectWithCompromisedPassword(CHANGE_PASSWORD_PATH)
      : redirectWithGenericFailure(CHANGE_PASSWORD_PATH);
  }

  // The flag is clear by the time this redirect is followed: the hook that clears it
  // is awaited inside the endpoint (see `instance.ts`), so the `get-session` the next
  // request makes reads the cleared row.
  const next =
    !session.twoFactorEnabled && !twoFactorOptional() ? ENROLL_PATH : SHELL_HOME_PATH;
  return redirectAfterPost(next, cookiesFrom(changed));
}
