import { APIError } from "better-auth/api";

import { getAuth } from "@/lib/server/auth";
import {
  authRefused,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
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

  let changed: Response;
  try {
    changed = await getAuth().api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    if (error instanceof APIError) return redirectWithGenericFailure(SETTINGS_PATH);
    throw error;
  }

  // A wrong current password or a too-short new one arrives as a 4xx Response rather than
  // a throw (see `authRefused`); both report the same generic sentence (SEC-1).
  if (authRefused(changed)) return redirectWithGenericFailure(SETTINGS_PATH);

  return redirectAfterPost(`${SETTINGS_PATH}?changed=1`, cookiesFrom(changed));
}
