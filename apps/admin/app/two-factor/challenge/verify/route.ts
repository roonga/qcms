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

/* Distinguish throttling from an invalid code: the shared limiter can refuse an operator who entered
   nothing wrong. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure("/two-factor/challenge");

  const code = formField(await request.formData(), "code");
  if (code === undefined) return redirectWithGenericFailure("/two-factor/challenge");

  const verified = await verifyTotp(request.headers, code);

  if (authRefused(verified)) {
    return redirectWithGenericFailure(
      "/two-factor/challenge",
      authThrottled(verified) ? "throttled" : "error",
    );
  }

  return redirectAfterPost(SHELL_HOME_PATH, cookiesFrom(verified));
}
