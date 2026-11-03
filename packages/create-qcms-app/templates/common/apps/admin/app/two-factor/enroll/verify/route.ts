import { verifyTotp } from "@/lib/server/auth-api";
import { clearEnrollmentCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { ENROLL_PATH, SIGN_IN_PATH, requireEnrollingSessionForRequest } from "@/lib/server/session";

/* Keep enrollment cookies on refusal so a typo does not discard the secret already added to the
   authenticator. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(ENROLL_PATH);

  // Guard this endpoint too: a provisional account must change its bootstrap password before binding a
  // second factor.
  const session = await requireEnrollingSessionForRequest();
  if (session instanceof Response) return session;

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure(ENROLL_PATH);

  const verified = await verifyTotp(request.headers, code);

  if (authRefused(verified)) {
    return redirectWithGenericFailure(ENROLL_PATH, authThrottled(verified) ? "throttled" : "error");
  }

  const cookies = cookiesFrom(verified);
  if (cookies.length === 0) return redirectAfterPost(`${SIGN_IN_PATH}?expired=1`);

  // Keep the newly issued recovery codes until their display consumes them; only the TOTP URI is finished
  // here.
  return redirectAfterPost("/two-factor/recovery-codes", [...cookies, clearEnrollmentCookie()]);
}
