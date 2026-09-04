import { changePassword } from "@/lib/server/auth-api";
import { passwordRefusalFrom } from "@/lib/server/password-refusal";
import {
  authRefused,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithCompromisedPassword,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

const SETTINGS_PATH = "/settings";

/**
 * Change the signed-in admin's password (task 031; SEC-1).
 *
 * `revokeOtherSessions: true` is the SEC-1 requirement, not a nicety: a password
 * change has to invalidate sessions server-side, or a stolen session outlives the
 * credential that created it. better-auth issues a fresh session for *this* browser in
 * the same call, so the cookies it returns are carried onto the redirect - without
 * that, changing your own password would sign you out of the tab you did it in.
 *
 * A rejected change (wrong current password, new password too short) redirects back
 * with the same opaque marker every auth failure uses. Distinguishing them would tell
 * whoever is at the keyboard whether they guessed the current password right.
 *
 * **One refusal is exempt, by ruling rather than by drift** (issue #437, Code Owner
 * 2026-09-03): a new password found in the public breach corpus gets its own marker and
 * its own sentence, because that refusal is a statement about a password the submitter
 * just typed rather than a fact about the account. `lib/server/password-refusal.ts`
 * carries the whole argument, including the oracle the ruling knowingly accepted and the
 * two alternatives it rejected. Everything this handler does is unchanged otherwise: the
 * refusal itself, its status, its timing and its ordering are the API's, and nothing here
 * asks the API a question it was not already going to answer.
 *
 * ## Why this handler applies the shell's session policy itself (issue #177)
 *
 * The `(shell)` layout calls `requireAdminSession()`, but a layout only guards the
 * pages it renders - a route handler in the same segment is reached directly by the
 * browser's POST and never passes through it. Relying on better-auth's cookie
 * validation alone would enforce gate 1 (existence) and gate 2's idle window, but
 * neither the QCMS absolute 12h cap (SEC-1) nor the 2FA-enrollment gate, so a session
 * kept warm past 12h, or one that has not finished enrolling, could change a password
 * while "the enrollment screens and nothing else" is the stated policy.
 *
 * `requireAdminSessionForRequest()` is `requireAdminSession()`'s policy answered as a
 * **303** rather than as a thrown `redirect()`, which Next turns into a 307 that asks
 * the browser to repeat the POST at the sign-in screen. It is called rather than
 * re-derived so a gate added to the shell reaches this handler too.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SETTINGS_PATH);

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const form = await request.formData();
  const currentPassword = formField(form, "currentPassword");
  const newPassword = formField(form, "newPassword");
  if (currentPassword === undefined || newPassword === undefined) {
    return redirectWithGenericFailure(SETTINGS_PATH);
  }

  const changed = await changePassword(request.headers, { currentPassword, newPassword });

  // A wrong current password or a too-short new one arrives as a 4xx Response rather than
  // a throw (see `authRefused`); both report the same generic sentence (SEC-1). A corpus
  // hit is the one refusal that says what it is, and the body is read only on this branch,
  // so a successful change's `Set-Cookie` headers are never consumed to get at it.
  if (authRefused(changed)) {
    return (await passwordRefusalFrom(changed)) === "compromised"
      ? redirectWithCompromisedPassword(SETTINGS_PATH)
      : redirectWithGenericFailure(SETTINGS_PATH);
  }

  return redirectAfterPost(`${SETTINGS_PATH}?changed=1`, cookiesFrom(changed));
}
