import { generateBackupCodes } from "@/lib/server/auth-api";
import { recoveryCodesCookie } from "@/lib/server/enrollment";
import {
  authRefused,
  authThrottled,
  formField,
  isSameOriginPost,
  redirectAfterPost,
  redirectWithGenericFailure,
} from "@/lib/server/route-helpers";
import { requireAdminSessionForRequest } from "@/lib/server/session";

const SETTINGS_PATH = "/settings";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginPost(request)) return redirectWithGenericFailure(SETTINGS_PATH, "codesError");

  const session = await requireAdminSessionForRequest();
  if (session instanceof Response) return session;

  const password = formField(await request.formData(), "password");
  if (password === undefined) return redirectWithGenericFailure(SETTINGS_PATH, "codesError");

  const generated = await generateBackupCodes(request.headers, password);
  if (authRefused(generated)) {
    return redirectWithGenericFailure(
      SETTINGS_PATH,
      authThrottled(generated) ? "codesThrottled" : "codesError",
    );
  }

  const { backupCodes } = (await generated.json()) as { backupCodes: string[] };
  return redirectAfterPost("/two-factor/recovery-codes", [recoveryCodesCookie(backupCodes)]);
}
