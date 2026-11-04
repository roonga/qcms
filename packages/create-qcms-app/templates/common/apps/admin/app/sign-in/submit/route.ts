import { enableTwoFactor, proxiedSession, signInEmail } from "@/lib/server/auth-api";
import { twoFactorOptional } from "@/lib/server/config";
import { pendingEnrollmentCookie, recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
  cookiesFrom,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import {
  CHANGE_PASSWORD_PATH,
  ENROLL_PATH,
  SHELL_HOME_PATH,
  SIGN_IN_PATH,
} from "@/lib/server/session";

/* Provision enrollment only while the password is available; auth failures stay opaque except for
   actionable throttling. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SIGN_IN_PATH);

  const form = await request.formData();
  const email = formField(form, "email");
  const password = formField(form, "password");
  if (email === undefined || password === undefined) {
    return redirectWithGenericFailure(SIGN_IN_PATH);
  }

  const signIn = await signInEmail(request.headers, { email, password });

  if (authRefused(signIn)) {
    return redirectWithGenericFailure(SIGN_IN_PATH, authThrottled(signIn) ? "throttled" : "error");
  }

  const cookies = cookiesFrom(signIn);
  const body = (await signIn.json()) as { twoFactorRedirect?: boolean };

  if (body.twoFactorRedirect === true) {
    return redirectAfterPost("/two-factor/challenge", cookies);
  }

  // Read the session with newly issued response cookies; the browser has not received them yet.
  const issuedCookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const sessionHeaders = new Headers(request.headers);
  sessionHeaders.set("cookie", issuedCookie);
  const session = await proxiedSession(sessionHeaders);

  // Change the bootstrap password before provisioning any second-factor secret or recovery codes.
  if (session?.user.mustChangePassword === true) {
    return redirectAfterPost(CHANGE_PASSWORD_PATH, cookies);
  }

  const enrolled = session?.user.twoFactorEnabled === true;

  if (!enrolled && !twoFactorOptional()) {
    // Carry freshly issued enrollment material in short-lived cookies; stored recovery codes cannot be read
    // back.
    const provisioned = await enableTwoFactor(request.headers, password, issuedCookie);
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

  return redirectAfterPost(SHELL_HOME_PATH, cookies);
}
