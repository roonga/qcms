import { verifyTotp } from "@/lib/server/auth-api";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { SHELL_HOME_PATH } from "@/lib/server/session";

/**
 * Verify the TOTP second factor and complete sign-in (task 031).
 *
 * The pending challenge travels on the two-factor cookie the sign-in POST set, so
 * this handler needs no state of its own: it forwards the request's cookies to
 * better-auth, which exchanges a correct code for a real session (and clears the
 * challenge cookie in the same response).
 *
 * A wrong code redirects back with the same opaque marker as every other auth
 * failure. It stays wrong-code-shaped nowhere: the challenge screen renders the one
 * generic sentence, so a wrong TOTP code and a wrong password are the same event to
 * anyone watching.
 *
 * ## `429` is the one refusal that is not a wrong code (issue #805)
 *
 * The sign-in POST has always drawn this distinction and this handler did not, so every
 * refusal here reported "those details did not match" - including the refusal that says
 * nothing about the code at all. `/two-factor/*` has its own three-per-ten-seconds
 * bucket, and issue #482 records that on the default Compose shape (no proxy, so no
 * resolvable client address) that bucket is keyed on a constant and therefore shared by
 * every operator. So the case is reachable without an attacker: one colleague's retries
 * close the window, and the operator who meets it is told their code was wrong, believes
 * it, and re-enters - which spends the next attempt and holds the window open. Telling
 * them to wait is actionable and reveals nothing about the account, which is the same
 * reasoning `app/sign-in/submit/route.ts` records.
 *
 * The marker and the copy are sign-in's, not new ones. A separate "too many codes"
 * sentence would be a fourth distinguishable message on a surface whose whole discipline
 * is that it has three (SEC-1), and it would say nothing the shared one does not.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/challenge");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/challenge");

  const verified = await verifyTotp(request.headers, code);

  // A wrong code arrives as a 4xx Response rather than a throw (see `authRefused`), and
  // so does the throttle's refusal - the status is the only thing separating them.
  if (authRefused(verified)) {
    return redirectWithGenericFailure(
      "/two-factor/challenge",
      authThrottled(verified) ? "throttled" : "error",
    );
  }

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
