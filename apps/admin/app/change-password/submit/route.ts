import { changePassword, enableTwoFactor } from "@/lib/server/auth-api";
import { pendingEnrollmentCookie, recoveryCodesCookie } from "@/lib/server/enrollment";
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
  redirectWithPasswordMismatch,
} from "@/lib/server/route-helpers";
import {
  CHANGE_PASSWORD_PATH,
  ENROLL_PATH,
  SHELL_HOME_PATH,
  requirePasswordChangeSessionForRequest,
} from "@/lib/server/session";
import { twoFactorOptional } from "@/lib/server/config";

/* The API clears mustChangePassword only after a successful change; this handler requires a provisional
   session independently. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(CHANGE_PASSWORD_PATH);

  const session = await requirePasswordChangeSessionForRequest();
  if (session instanceof Response) return session;

  const form = await request.formData();
  const currentPassword = formField(form, "currentPassword");
  const newPassword = formField(form, "newPassword");
  const confirmPassword = formField(form, "confirmPassword");
  if (currentPassword === undefined || newPassword === undefined) {
    return redirectWithGenericFailure(CHANGE_PASSWORD_PATH);
  }
  if (newPassword !== confirmPassword) return redirectWithPasswordMismatch(CHANGE_PASSWORD_PATH);

  const changed = await changePassword(request.headers, { currentPassword, newPassword });

  if (authRefused(changed)) {
    // Classify status before body: a throttled attempt has no password verdict to inspect.
    if (authThrottled(changed)) {
      return redirectWithGenericFailure(CHANGE_PASSWORD_PATH, "throttled");
    }
    return (await passwordRefusalFrom(changed)) === "compromised"
      ? redirectWithCompromisedPassword(CHANGE_PASSWORD_PATH)
      : redirectWithGenericFailure(CHANGE_PASSWORD_PATH);
  }

  const cookies = cookiesFrom(changed);
  if (session.twoFactorEnabled || twoFactorOptional()) {
    return redirectAfterPost(SHELL_HOME_PATH, cookies);
  }

  // Provision enrollment only after changing the bootstrap password, while the new password is still
  // available for two-factor/enable.
  const issuedCookie = cookies.map((value) => value.split(";")[0]).join("; ");
  const provisioned = await enableTwoFactor(request.headers, newPassword, issuedCookie);
  if (authRefused(provisioned)) {
    throw new Error(`Failed to provision 2FA enrollment (${String(provisioned.status)})`);
  }
  const { totpURI, backupCodes } = (await provisioned.json()) as {
    totpURI: string;
    backupCodes: string[];
  };
  return redirectAfterPost(ENROLL_PATH, [
    ...cookies,
    pendingEnrollmentCookie(totpURI),
    recoveryCodesCookie(backupCodes),
  ]);
}
