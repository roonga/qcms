import { enableTwoFactor, proxiedSession, signInEmail } from "@/lib/server/auth-api";
import { twoFactorOptional } from "@/lib/server/config";
import { pendingEnrollmentCookie, recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
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
 * actionable and reveals nothing about the account (the screen contract's throttled
 * state). Nothing from the library's message reaches the response, and nothing is
 * logged here: a value-free redirect is the whole error surface (SEC-1, SEC-8).
 *
 * Since task 056 each better-auth call is one request to the API's auth mount rather
 * than an in-process library call, and the three outcomes are decided from exactly the
 * same statuses and bodies. The `catch (APIError)` blocks are gone with the library:
 * over HTTP a refusal is always a status, which the checks below already read because
 * `asResponse: true` made refusals arrive that way in process too.
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

  const signIn = await signInEmail(request.headers, { email, password });

  // A refusal arrives as a 4xx `Response`, never a throw (see `authRefused`). Checking
  // the status is what keeps a wrong password reported as a wrong password. `429` is
  // the one refusal with its own message, and better-auth reports an unknown email
  // and a wrong password identically, which is what SEC-1 asks for.
  if (authRefused(signIn)) {
    return redirectWithGenericFailure(SIGN_IN_PATH, authThrottled(signIn) ? "throttled" : "error");
  }

  const cookies = cookiesFrom(signIn);
  const body = (await signIn.json()) as { twoFactorRedirect?: boolean };

  // Outcome 1: second factor required before any session exists.
  if (body.twoFactorRedirect === true) {
    return redirectAfterPost("/two-factor/challenge", cookies);
  }

  // A session now exists, but only in the cookies just issued - the browser has not
  // seen them yet, so the session read has to be made with them rather than with the
  // request's own cookie header.
  const issuedCookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const sessionHeaders = new Headers(request.headers);
  sessionHeaders.set("cookie", issuedCookie);
  const session = await proxiedSession(sessionHeaders);
  const enrolled = session?.user.twoFactorEnabled === true;

  if (!enrolled && !twoFactorOptional()) {
    // Outcome 2. `two-factor/enable` returns the otpauth URI and the recovery codes,
    // and this is the only moment either exists outside the database (issue #319
    // removed the route that read the codes back). Both are carried forward in the
    // short-lived enrollment cookies; `lib/server/enrollment.ts` records why.
    const provisioned = await enableTwoFactor(request.headers, password, issuedCookie);
    // A refusal here is not a credential problem the visitor can act on (the password
    // was just accepted), so it stays an error rather than becoming a fourth outcome -
    // the same shape it had while the call was in process and could throw.
    if (authRefused(provisioned)) {
      throw new Error(`Failed to provision 2FA enrollment (${String(provisioned.status)})`);
    }
    const { totpURI, backupCodes } = (await provisioned.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    return redirectAfterPost(ENROLL_PATH, [
      ...cookies,
      pendingEnrollmentCookie(totpURI),
      recoveryCodesCookie(backupCodes),
    ]);
  }

  // Outcome 3.
  return redirectAfterPost(SHELL_HOME_PATH, cookies);
}
