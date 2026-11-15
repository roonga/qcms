import { claimAccount, enableTwoFactor } from "@/lib/server/auth-api";
import { CLAIM_PATH, claimRefusalOf } from "@/lib/server/claim";
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
import { ENROLL_PATH, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The claim POST. No session guard: the emailed token is what identifies the account, and
 * the API refuses one that is unknown, used, expired or bound to a different account. The
 * chosen password provisions the second factor in the same request, exactly as the
 * forced-change handler does, so it never has to be held for a later screen.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return claimRedirect("linkRefused");

  const form = await request.formData();
  const token = formField(form, "token");
  const newPassword = formField(form, "newPassword");
  const confirmPassword = formField(form, "confirmPassword");
  if (token === undefined) return claimRedirect("linkRefused");
  if (newPassword === undefined) return claimRedirect("weak", token);
  if (newPassword !== confirmPassword) return claimRedirect("mismatch", token);

  const claimed = await claimAccount(request.headers, { token, password: newPassword });
  return authRefused(claimed)
    ? refusedClaim(claimed, token)
    : enrolAfterClaim(request, claimed, newPassword);
}

async function refusedClaim(claimed: Response, token: string): Promise<Response> {
  if (authThrottled(claimed)) return claimRedirect("throttled");
  const refusal = await claimRefusalOf(claimed);
  if (refusal === "link") return claimRedirect("linkRefused");
  if (refusal === "compromised") return claimRedirect("compromised", token);
  return refusal === "weak" ? claimRedirect("weak", token) : claimRedirect("error");
}

/** Provision enrolment while the chosen password is still in this request. */
async function enrolAfterClaim(
  request: Request,
  claimed: Response,
  password: string,
): Promise<Response> {
  const cookies = cookiesFrom(claimed);
  const body = (await claimed.json()) as { twoFactorRedirect?: boolean };
  if (body.twoFactorRedirect === true) {
    return redirectAfterPost("/two-factor/challenge", cookies);
  }
  if (twoFactorOptional()) return redirectAfterPost(SHELL_HOME_PATH, cookies);

  const issuedCookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const provisioned = await enableTwoFactor(request.headers, password, issuedCookie);
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

type ClaimMarker = "linkRefused" | "error" | "throttled" | "mismatch" | "compromised" | "weak";

/**
 * Retyping fixes a mismatch and a refused password, so those three keep the token and the
 * form. A throttle, an unexplained refusal and a spent link do not, so the screen drops
 * the token and sends the person back to the link they were sent.
 */
const KEEPS_TOKEN = new Set<ClaimMarker>(["mismatch", "compromised", "weak"]);

function claimRedirect(marker: ClaimMarker, token?: string): Response {
  const query = new URLSearchParams();
  if (token !== undefined && KEEPS_TOKEN.has(marker)) query.set("token", token);
  query.set(marker, "1");
  return redirectAfterPost(`${CLAIM_PATH}?${query.toString()}`);
}
