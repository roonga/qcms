import { APIError } from "better-auth/api";

import { getAuth } from "@/lib/server/auth";
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
 * Redeem a recovery code as the second factor (task 031).
 *
 * Recovery codes are single-use: better-auth removes the redeemed code from the
 * account's stored set, so the same code cannot sign in twice. The admin Playwright
 * suite asserts exactly that (a redeemed code stops working), because "single-use" is
 * the whole security property of a recovery code and a passing happy path proves
 * nothing about it.
 *
 * No new codes are issued here and none are shown. Regenerating a depleted set is a
 * deliberate action from Settings (re-enrollment), not a side effect of using one.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/recovery");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/recovery");

  let verified: Response;
  try {
    verified = await getAuth().api.verifyBackupCode({
      body: { code },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    if (error instanceof APIError) return redirectWithGenericFailure("/two-factor/recovery");
    throw error;
  }

  // A spent or wrong code arrives as a 4xx Response rather than a throw (see
  // `authRefused`), which is the path the single-use assertion exercises.
  if (authRefused(verified)) return redirectWithGenericFailure("/two-factor/recovery");

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
