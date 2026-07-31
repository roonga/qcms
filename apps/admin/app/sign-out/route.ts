import { getAuth } from "@/lib/server/auth";
import { cookiesFrom, isSameOriginPost, redirectAfterPost } from "@/lib/server/route-helpers";
import { SIGN_IN_PATH } from "@/lib/server/session";

/**
 * Sign out (task 031; SEC-1 "server-side session invalidation on sign-out").
 *
 * POST only. A GET would let a prefetch, a crawler, or an `<img src>` on any page end
 * an admin's session, so the shell's control is a form and this handler answers
 * nothing else.
 *
 * better-auth deletes the session **row**, not just the cookie, which is what makes
 * the API's verification meaningful: a forwarded token for a signed-out session
 * resolves to nothing there too. The cookies it returns (three of them: session,
 * session data, and the remember flag) are carried onto the redirect, which is why
 * `getSetCookie()` is used rather than `get("set-cookie")`.
 *
 * A failure to sign out still lands on sign-in. There is no state in which telling an
 * admin "sign-out failed" and leaving them on an authenticated page is the better
 * answer, and the session row is gone by then in every case that matters.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectAfterPost(SIGN_IN_PATH);
  try {
    const signedOut = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
    return redirectAfterPost(SIGN_IN_PATH, cookiesFrom(signedOut));
  } catch {
    return redirectAfterPost(SIGN_IN_PATH);
  }
}
