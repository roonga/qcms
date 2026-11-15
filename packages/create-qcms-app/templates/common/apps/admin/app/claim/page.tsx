import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Alert, Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";

export function generateMetadata(): Metadata {
  return pageMetadata(t("claim.title"));
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  if (typeof raw === "string") return raw;
  return Array.isArray(raw) ? raw[0] : undefined;
}

function refusedMessage(marker: string | string[] | undefined): string | undefined {
  return marker === undefined ? undefined : t("claim.linkRefused");
}

/**
 * The emailed link lands here. No session is required and none is read: the token is the
 * only thing that identifies the account, and the API refuses a token that belongs to
 * somebody other than the caller's session. The screen sits outside the shell so its own
 * gates cannot redirect an account that holds nothing yet.
 */
export default async function ClaimPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = firstValue(params.token);

  if (token === undefined) {
    return (
      <AuthScreen title={t("claim.title")} intro={t("claim.intro")}>
        <Alert variant="error">{t("claim.linkRefused")}</Alert>
      </AuthScreen>
    );
  }

  const error =
    params.throttled !== undefined ? t("signIn.throttled") : refusedMessage(params.error);

  return (
    <AuthScreen title={t("claim.title")} intro={t("claim.intro")} error={error}>
      {params.mismatch !== undefined && <Alert variant="error">{t("claim.mismatch")}</Alert>}
      {params.compromised !== undefined && (
        <Alert variant="error">{t("settings.passwordCompromised")}</Alert>
      )}
      {params.weak !== undefined && <Alert variant="error">{t("claim.weakPassword")}</Alert>}
      <form method="post" action="/claim/submit" className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />
        <TextField
          name="newPassword"
          type="password"
          label={t("claim.new")}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          isRequired
        />
        <TextField
          name="confirmPassword"
          type="password"
          label={t("claim.confirm")}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("claim.action")}
        </Button>
      </form>
    </AuthScreen>
  );
}
