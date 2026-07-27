import { APIError } from "better-auth/api";

import { getAuth } from "@/lib/server/auth";
import { clearEnrollmentCookie, recoveryViewCookie } from "@/lib/server/enrollment";
import {
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

  let verified: Response;
  try {
    verified = await getAuth().api.verifyTOTP({
      body: { code },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    if (error instanceof APIError) return redirectWithGenericFailure(ENROLL_PATH);
    throw error;
  }

  // No session came back: the sign-in session lapsed while enrolling. Nothing to
  // continue with, and re-provisioning needs the password.
  const cookies = cookiesFrom(verified);
  if (cookies.length === 0) return redirectAfterPost(`${SIGN_IN_PATH}?expired=1`);

  return redirectAfterPost("/two-factor/recovery-codes", [
    ...cookies,
    clearEnrollmentCookie(),
    recoveryViewCookie(),
  ]);
}
