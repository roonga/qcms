import { clearRecoveryViewCookie } from "@/lib/server/enrollment";
import { isSameOriginPost, redirectAfterPost } from "@/lib/server/route-helpers";
import { SHELL_HOME_PATH } from "@/lib/server/session";

/**
 * "I have saved these codes" (task 031). Spends the one-time display marker and
 * lands the admin in the shell.
 *
 * It changes no auth state, which is why there is no better-auth call here: the codes
 * were generated and stored at enrollment. All this does is close the display, which
 * is what makes the wireframe's "codes never shown again" true.
 */
export function POST(request: Request): Response {
  if (!isSameOriginPost(request)) return redirectAfterPost(SHELL_HOME_PATH);
  return redirectAfterPost(SHELL_HOME_PATH, [clearRecoveryViewCookie()]);
}
