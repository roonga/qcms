import { signOut } from "@/lib/server/auth-api";
import { cookiesFrom, isSameOriginPost, redirectAfterPost } from "@/lib/server/route-helpers";
import { SIGN_IN_PATH } from "@/lib/server/session";

/* Sign-out is POST-only to prevent prefetch or embedded GETs ending sessions; forward every Set-Cookie
   header separately. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectAfterPost(SIGN_IN_PATH);
  try {
    const signedOut = await signOut(request.headers);
    return redirectAfterPost(SIGN_IN_PATH, cookiesFrom(signedOut));
  } catch {
    return redirectAfterPost(SIGN_IN_PATH);
  }
}
