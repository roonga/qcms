import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Alert, Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";

export function generateMetadata(): Metadata {
  return pageMetadata(t("claim.title"));
}

type QueryValue = string | string[] | undefined;

type Query = Readonly<Record<string, QueryValue>>;

function firstValue(raw: QueryValue): string | undefined {
  if (typeof raw === "string") return raw;
  return Array.isArray(raw) ? raw[0] : undefined;
}

/** Only the markers that say something a person can act on; everything else is the link. */
function withoutTokenMessage(params: Query): string {
  if (params.throttled !== undefined) return t("signIn.throttled");
  return params.error !== undefined ? t("signIn.error") : t("claim.linkRefused");
}

/**
 * The emailed link lands here. No session is required and none is read: the token is what
 * identifies the account, and the API refuses a token that belongs to somebody other than
 * the caller's session. The screen sits outside the shell so its own gates cannot redirect
 * an account that holds nothing yet.
 */
export default async function ClaimPage({
  searchParams,
}: {
  readonly searchParams: Promise<Query>;
}) {
  const params = await searchParams;
  const token = firstValue(params.token);

  if (token === undefined) {
    return (
      <AuthScreen title={t("claim.title")} intro={t("claim.useLinkAgain")}>
        <Alert variant="error">{withoutTokenMessage(params)}</Alert>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t("claim.title")} intro={t("claim.intro")}>
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
