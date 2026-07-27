import { APIError } from "better-auth/api";

import { auth } from "@/lib/server/auth";
import {
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";

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
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SETTINGS_PATH);

  const form = await request.formData();
  const currentPassword = formField(form, "currentPassword");
  const newPassword = formField(form, "newPassword");
  if (currentPassword === undefined || newPassword === undefined) {
    return redirectWithGenericFailure(SETTINGS_PATH);
  }

  let changed: Response;
  try {
    changed = await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    if (error instanceof APIError) return redirectWithGenericFailure(SETTINGS_PATH);
    throw error;
  }

  return redirectAfterPost(`${SETTINGS_PATH}?changed=1`, cookiesFrom(changed));
}
