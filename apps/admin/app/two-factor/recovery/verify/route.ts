import { verifyBackupCode } from "@/lib/server/auth-api";
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
 *
 * The `429` distinction is the challenge handler's, for the same reason and off the same
 * shared `/two-factor/*` bucket (issue #805; #482 for the bucket's shape). It matters
 * slightly more here than there: a recovery code is a scarce written-down thing, and an
 * operator told "that code did not match" when the truth was "not right now" has reason
 * to believe they have burned one and to reach for the next.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/recovery");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/recovery");

  const verified = await verifyBackupCode(request.headers, code);

  // A spent or wrong code arrives as a 4xx Response rather than a throw (see
  // `authRefused`), which is the path the single-use assertion exercises. A throttled
  // request arrives the same way and is not a statement about the code.
  if (authRefused(verified)) {
    return redirectWithGenericFailure(
      "/two-factor/recovery",
      authThrottled(verified) ? "throttled" : "error",
    );
  }

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
