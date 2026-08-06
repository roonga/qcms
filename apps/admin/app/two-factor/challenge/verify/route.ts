import { verifyTotp } from "@/lib/server/auth-api";
import {
  authRefused,
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
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/challenge");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/challenge");

  const verified = await verifyTotp(request.headers, code);

  // A wrong code arrives as a 4xx Response rather than a throw (see `authRefused`).
  if (authRefused(verified)) return redirectWithGenericFailure("/two-factor/challenge");

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
