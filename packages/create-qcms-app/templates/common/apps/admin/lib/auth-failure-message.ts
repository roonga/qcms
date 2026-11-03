import { t } from "@/lib/i18n/en";

/** Keep only generic failure, throttle and expiry messages to avoid enumeration. Throttle wins because the credential was never judged. */
export function authFailureMessage(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  if (params.throttled !== undefined) return t("signIn.throttled");
  if (params.expired !== undefined) return t("signIn.expired");
  if (params.error !== undefined) return t("signIn.error");
  return undefined;
}
