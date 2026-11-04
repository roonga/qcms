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

/* A redeemed recovery code is single-use; regeneration remains an explicit Settings action. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/recovery");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/recovery");

  const verified = await verifyBackupCode(request.headers, code);

  if (authRefused(verified)) {
    return redirectWithGenericFailure(
      "/two-factor/recovery",
      authThrottled(verified) ? "throttled" : "error",
    );
  }

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
