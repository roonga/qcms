import { clearRecoveryCodesCookie } from "@/lib/server/enrollment";
import { isSameOriginPost, redirectAfterPost } from "@/lib/server/route-helpers";
import { SHELL_HOME_PATH } from "@/lib/server/session";

/**
 * "I have saved these codes" (task 031). Spends the one-time display and lands the
 * admin in the shell.
 *
 * It changes no auth state, which is why there is no better-auth call here: the codes
 * were generated and stored by the step that sent the admin to the display. All this
 * does is discard the only copy this app was holding, which since issue #319 is what
 * makes the wireframe's "codes never shown again" literally true - there is no route
 * left that can read them back.
 */
export function POST(request: Request): Response {
  if (!isSameOriginPost(request)) return redirectAfterPost(SHELL_HOME_PATH);
  return redirectAfterPost(SHELL_HOME_PATH, [clearRecoveryCodesCookie()]);
}
