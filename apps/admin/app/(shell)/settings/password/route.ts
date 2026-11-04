import { changePassword } from "@/lib/server/auth-api";
import { passwordRefusalFrom } from "@/lib/server/password-refusal";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithCompromisedPassword,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

const SETTINGS_PATH = "/settings";

/* Changing a password must revoke other sessions server-side; forward fresh cookies so this browser
   remains signed in. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SETTINGS_PATH);

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const form = await request.formData();
  const currentPassword = formField(form, "currentPassword");
  const newPassword = formField(form, "newPassword");
  if (currentPassword === undefined || newPassword === undefined) {
    return redirectWithGenericFailure(SETTINGS_PATH);
  }

  const changed = await changePassword(request.headers, { currentPassword, newPassword });

  if (authRefused(changed)) {
    // Classify status before body: a throttled attempt has no password verdict to inspect.
    if (authThrottled(changed)) return redirectWithGenericFailure(SETTINGS_PATH, "throttled");
    return (await passwordRefusalFrom(changed)) === "compromised"
      ? redirectWithCompromisedPassword(SETTINGS_PATH)
      : redirectWithGenericFailure(SETTINGS_PATH);
  }

  return redirectAfterPost(`${SETTINGS_PATH}?changed=1`, cookiesFrom(changed));
}
