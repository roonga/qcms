import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Alert, Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requirePasswordChangeSession } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("forcedPassword.title"));
}

/* Keep credential submission in a native server POST. This page sits outside the shell to avoid its
   forced-change redirect loop. */
export default async function ForcedPasswordChangePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePasswordChangeSession();

  const params = await searchParams;
  const error = authFailureMessage(params);

  return (
    <AuthScreen title={t("forcedPassword.title")} intro={t("forcedPassword.intro")} error={error}>
      {/* Do not nest live-region roles: the kit Alert already provides role=alert and a second wrapper would
   announce twice. */}
      {params.mismatch !== undefined && (
        <Alert variant="error">{t("forcedPassword.mismatch")}</Alert>
      )}
      {params.compromised !== undefined && (
        <Alert variant="error">{t("settings.passwordCompromised")}</Alert>
      )}
      <form method="post" action="/change-password/submit" className="flex flex-col gap-4">
        <TextField
          name="currentPassword"
          type="password"
          label={t("forcedPassword.current")}
          autoComplete="current-password"
          isRequired
        />
        <TextField
          name="newPassword"
          type="password"
          label={t("forcedPassword.new")}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          isRequired
        />
        <TextField
          name="confirmPassword"
          type="password"
          label={t("forcedPassword.confirm")}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.changePassword")}
        </Button>
      </form>
    </AuthScreen>
  );
}
