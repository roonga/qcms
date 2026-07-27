import { APIError } from "better-auth/api";

import { auth, twoFactorOptional } from "@/lib/server/auth";
import { pendingEnrollmentCookie } from "@/lib/server/enrollment";
import {
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { ENROLL_PATH, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The sign-in POST (task 031). A BFF route handler: sessions and credentials only,
 * no business logic (R2).
 *
 * ## The three outcomes
 *
 * 1. **2FA challenge pending.** When the account has completed enrollment,
 *    better-auth's twoFactor plugin withholds the session and answers
 *    `{ twoFactorRedirect: true }`, setting only a short-lived two-factor cookie.
 *    That is what makes "a session row exists" a meaningful check in the API: a
 *    password alone never produces one.
 * 2. **Enrollment needed.** A session is issued but the account has no TOTP factor
 *    yet, and the policy is `required`. Enrollment is **provisioned here**, not on
 *    the enrollment screen, because `enableTwoFactor` needs the password and this is
 *    the only moment it exists (see `lib/server/enrollment.ts` for why the resulting
 *    URI travels in a short-lived httpOnly cookie). `enableTwoFactor` stores the
 *    secret without flipping `twoFactorEnabled`, so an abandoned enrollment leaves
 *    the account unprotected-and-known-unprotected rather than half-protected, and
 *    the next sign-in simply re-provisions.
 * 3. **Signed in.** Either the account is enrolled and just verified, or the
 *    development escape hatch (`QCMS_ADMIN_2FA=optional`) is on.
 *
 * ## Failure handling
 *
 * Every failure - unknown email, wrong password, rate limit - redirects back with an
 * opaque marker. The one distinction drawn is `429`, because "try again later" is
 * actionable and reveals nothing about the account (the wireframe's throttled
 * state). Nothing from the library's message reaches the response, and nothing is
 * logged here: a value-free redirect is the whole error surface (SEC-1, SEC-8).
 */
export async function POST(request: Request): Promise<Response> {
  // SEC-9's CSRF belt on top of SameSite=Lax.
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SIGN_IN_PATH);

  const form = await request.formData();
  const email = formField(form, "email");
  const password = formField(form, "password");
  if (email === undefined || password === undefined) {
    return redirectWithGenericFailure(SIGN_IN_PATH);
  }

  let signIn: Response;
  try {
    signIn = await auth.api.signInEmail({
      body: { email, password },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    if (error instanceof APIError && error.status === "TOO_MANY_REQUESTS") {
      return redirectWithGenericFailure(SIGN_IN_PATH, "throttled");
    }
    // Includes UNAUTHORIZED (bad password) and the unknown-email path, which
    // better-auth deliberately reports identically.
    if (error instanceof APIError) return redirectWithGenericFailure(SIGN_IN_PATH);
    throw error;
  }

  const cookies = cookiesFrom(signIn);
  const body = (await signIn.json()) as { twoFactorRedirect?: boolean };

  // Outcome 1: second factor required before any session exists.
  if (body.twoFactorRedirect === true) {
    return redirectAfterPost("/two-factor/challenge", cookies);
  }

  // A session now exists. Decide between outcomes 2 and 3.
  const sessionHeaders = new Headers(request.headers);
  sessionHeaders.set("cookie", cookies.map((c) => c.split(";")[0]).join("; "));
  const session = await auth.api.getSession({ headers: sessionHeaders });
  const enrolled = session?.user.twoFactorEnabled === true;

  if (!enrolled && !twoFactorOptional()) {
    // Outcome 2. `enableTwoFactor` returns the otpauth URI and the recovery codes;
    // only the URI is carried forward, because the codes are read back server-side
    // at display time and never travel through a cookie.
    const provisioned = await auth.api.enableTwoFactor({
      body: { password },
      headers: sessionHeaders,
    });
    return redirectAfterPost(ENROLL_PATH, [
      ...cookies,
      pendingEnrollmentCookie(provisioned.totpURI),
    ]);
  }

  // Outcome 3.
  return redirectAfterPost(SHELL_HOME_PATH, cookies);
}
