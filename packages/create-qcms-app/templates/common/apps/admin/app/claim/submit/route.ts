import { claimAccount, enableTwoFactor } from "@/lib/server/auth-api";
import { twoFactorOptional } from "@/lib/server/config";
import { pendingEnrollmentCookie, recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
} from "@/lib/server/route-helpers";
import { CLAIM_PATH, claimRefusalOf } from "@/lib/server/claim";
import { ENROLL_PATH, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The claim POST. No session guard: the emailed token is what identifies the account, and
 * the API refuses one that is unknown, used, expired or bound to a different account. The
 * chosen password provisions the second factor in the same request, exactly as the
 * forced-change handler does, so it never has to be held for a later screen.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return claimRedirect(undefined, "error");

  const form = await request.formData();
  const token = formField(form, "token");
  const newPassword = formField(form, "newPassword");
  const confirmPassword = formField(form, "confirmPassword");
  if (token === undefined) return claimRedirect(undefined, "error");
  if (newPassword === undefined) return claimRedirect(token, "weak");
  if (newPassword !== confirmPassword) return claimRedirect(token, "mismatch");

  const claimed = await claimAccount(request.headers, { token, password: newPassword });

  if (authRefused(claimed)) {
    if (authThrottled(claimed)) return claimRedirect(token, "throttled");
    const refusal = await claimRefusalOf(claimed);
    // A refused link is spent, so the retry screen drops the token rather than offering a
    // form that cannot succeed.
    if (refusal === "link") return claimRedirect(undefined, "error");
    return claimRedirect(token, refusal === "compromised" ? "compromised" : "weak");
  }

  const cookies = cookiesFrom(claimed);
  const body = (await claimed.json()) as { twoFactorRedirect?: boolean };
  if (body.twoFactorRedirect === true) {
    return redirectAfterPost("/two-factor/challenge", cookies);
  }
  if (twoFactorOptional()) return redirectAfterPost(SHELL_HOME_PATH, cookies);

  // Provision enrolment while the chosen password is still in this request, as the
  // sign-in and forced-change handlers do.
  const issuedCookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const provisioned = await enableTwoFactor(request.headers, newPassword, issuedCookie);
  if (authRefused(provisioned)) return redirectAfterPost(SIGN_IN_PATH, cookies);
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

type ClaimMarker = "error" | "throttled" | "mismatch" | "compromised" | "weak";

/** One builder, because the claim path already carries a query and a second `?` would be dropped. */
function claimRedirect(token: string | undefined, marker: ClaimMarker): Response {
  const query = new URLSearchParams();
  if (token !== undefined) query.set("token", token);
  query.set(marker, "1");
  return redirectAfterPost(`${CLAIM_PATH}?${query.toString()}`);
}
