import { clearRecoveryCodesCookie } from "@/lib/server/enrollment";
import { isSameOriginPost, redirectAfterPost } from "@/lib/server/route-helpers";
import { SHELL_HOME_PATH } from "@/lib/server/session";

/* Discard the only display copy; no endpoint can recover the stored codes for another viewing. */
export function POST(request: Request): Response {
  if (!isSameOriginPost(request)) return redirectAfterPost(SHELL_HOME_PATH);
  return redirectAfterPost(SHELL_HOME_PATH, [clearRecoveryCodesCookie()]);
}
