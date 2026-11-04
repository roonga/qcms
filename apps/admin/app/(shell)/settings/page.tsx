import type { Metadata } from "next";

import { Alert, Button, Card, TextField } from "@/components/kit";
import { SettingsPanels } from "@/components/settings-panels";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";
import { SETTINGS_HEADING_ID, settingsSectionFromParams } from "@/lib/settings-sections";

export function generateMetadata(): Metadata {
  return pageMetadata(t("nav.settings"));
}

export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const passwordFailure = authFailureMessage({ throttled: params.throttled, error: params.error });
  const codesFailure = authFailureMessage({
    throttled: params.codesThrottled,
    error: params.codesError,
  });

  return (
    <SettingsPanels
      initial={settingsSectionFromParams(params)}
      panels={{
        account: (
          <section className="qcms-card" aria-labelledby={SETTINGS_HEADING_ID}>
            <Card padding="md" radius="md" border>
              <div className="flex flex-col gap-3">
                <p className="text-sm text-(--color-text-muted)">
                  {t("settings.signedInAs", { email: session.email })}
                </p>
              </div>
            </Card>
          </section>
        ),
        "change-password": (
          <section className="qcms-card" aria-labelledby={SETTINGS_HEADING_ID}>
            <Card padding="md" radius="md" border>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-(--color-text-muted)">{t("settings.passwordIntro")}</p>
                {params.changed !== undefined && (
                  <Alert variant="success">{t("settings.passwordChanged")}</Alert>
                )}
                {/* Credential refusals share copy to avoid account or password oracles; throttling asks the operator to
   wait. */}
                {passwordFailure !== undefined && <Alert variant="error">{passwordFailure}</Alert>}
                {params.compromised !== undefined && (
                  <Alert variant="error">{t("settings.passwordCompromised")}</Alert>
                )}
                <form
                  method="post"
                  action="/settings/password"
                  className="flex max-w-sm flex-col gap-4"
                >
                  <TextField
                    name="currentPassword"
                    type="password"
                    label={t("settings.currentPassword")}
                    autoComplete="current-password"
                    isRequired
                  />
                  <TextField
                    name="newPassword"
                    type="password"
                    label={t("settings.newPassword")}
                    autoComplete="new-password"
                    minLength={MIN_PASSWORD_LENGTH}
                    isRequired
                  />
                  <Button type="submit" variant="primary" size="md">
                    {t("action.savePassword")}
                  </Button>
                </form>
              </div>
            </Card>
          </section>
        ),
        "two-factor": (
          <section className="qcms-card" aria-labelledby={SETTINGS_HEADING_ID}>
            <Card padding="md" radius="md" border>
              <div className="flex flex-col gap-3">
                <p
                  className={
                    session.twoFactorEnabled
                      ? "text-sm text-(--color-success-fg)"
                      : "text-sm text-(--color-warning-fg)"
                  }
                >
                  {session.twoFactorEnabled
                    ? t("settings.twoFactorOn")
                    : t("settings.twoFactorOff")}
                </p>
                {session.twoFactorEnabled && (
                  <>
                    <h2 className="text-sm font-semibold text-(--color-text)">
                      {t("settings.recoveryCodesTitle")}
                    </h2>
                    {codesFailure !== undefined && <Alert variant="error">{codesFailure}</Alert>}
                    <p className="text-sm text-(--color-text-muted)">
                      {t("settings.recoveryCodesIntro")}
                    </p>
                    <form
                      method="post"
                      action="/settings/recovery-codes"
                      className="flex max-w-sm flex-col gap-4"
                    >
                      <TextField
                        name="password"
                        type="password"
                        label={t("settings.recoveryCodesPassword")}
                        autoComplete="current-password"
                        isRequired
                      />
                      <Button type="submit" variant="secondary" size="md">
                        {t("settings.recoveryCodesAction")}
                      </Button>
                    </form>
                  </>
                )}
              </div>
            </Card>
          </section>
        ),
      }}
    />
  );
}
