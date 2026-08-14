import { verifyTotp } from "@/lib/server/auth-api";
import { clearEnrollmentCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { ENROLL_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * Confirm 2FA enrollment with a real TOTP code (task 031).
 *
 * This is the step that flips `user.twoFactorEnabled`, so it is the step that makes
 * the account usable against the API at all (an unenrolled session is rejected there
 * under the default policy). Only after it succeeds does the one-time
 * recovery-code display open, which is the wireframe's order: verify the factor
 * works, *then* hand over the codes that bypass it.
 *
 * A wrong code redirects back to the enrollment screen with the same opaque marker
 * every other auth failure uses. The enrollment cookie is deliberately left in place
 * on failure, so a mistyped digit does not throw away the secret the admin has
 * already added to their authenticator.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(ENROLL_PATH);

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure(ENROLL_PATH);

  const verified = await verifyTotp(request.headers, code);

  // A wrong code arrives as a 4xx Response rather than a throw (see `authRefused`).
  if (authRefused(verified)) return redirectWithGenericFailure(ENROLL_PATH);

  // Defensive: a successful verify always issues a session. No cookies would mean the
  // sign-in session lapsed mid-enrollment, and re-provisioning needs the password.
  const cookies = cookiesFrom(verified);
  if (cookies.length === 0) return redirectAfterPost(`${SIGN_IN_PATH}?expired=1`);

  // The recovery-codes cookie is deliberately *not* touched here: the sign-in POST
  // that provisioned this enrollment already put the issued codes in it, and the
  // display screen spends it (issue #319). Only the TOTP URI is finished with.
  return redirectAfterPost("/two-factor/recovery-codes", [...cookies, clearEnrollmentCookie()]);
}
