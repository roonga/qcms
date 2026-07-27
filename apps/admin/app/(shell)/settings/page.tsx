import { Alert, Button, Card, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";

/**
 * Settings (task 031; wireframe "Settings area at launch: account (change password →
 * sessions invalidated), 2FA re-enrollment, nothing else").
 *
 * Exactly those two things, and the "nothing else" is the binding half: no profile,
 * no preferences, no user list, no roles. RBAC is Phase 4 (R7).
 *
 * Changing the password revokes every **other** session, which is the SEC-1
 * requirement ("server-side session invalidation on sign-out and password change")
 * and also the useful behaviour: the admin who just changed it stays signed in here
 * while any session elsewhere dies. The copy says so before the form rather than
 * after the effect.
 *
 * 2FA re-enrollment is a sign-out, and the honesty of that is the point: provisioning
 * a new TOTP secret needs the password (better-auth requires it, correctly), and this
 * page has no password to offer. Rather than add a second password prompt that
 * duplicates the sign-in screen, re-enrollment routes through the flow that already
 * asks - sign out, sign in, and enrollment is provisioned on the way through when the
 * account has no live factor. An account that already has one must first disable it,
 * which is a deliberate action this launch surface does not expose.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-(--color-text)">{t("settings.title")}</h1>

      <Card padding="md" radius="md" border>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-(--color-text)">{t("settings.account")}</h2>
          <p className="text-sm text-(--color-text-muted)">
            {t("settings.signedInAs", { email: session.email })}
          </p>
        </div>
      </Card>

      <Card padding="md" radius="md" border>
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-(--color-text)">
            {t("settings.passwordTitle")}
          </h2>
          <p className="text-sm text-(--color-text-muted)">{t("settings.passwordIntro")}</p>
          {params.changed !== undefined && (
            <div role="status">
              <Alert variant="success">{t("settings.passwordChanged")}</Alert>
            </div>
          )}
          {params.error !== undefined && (
            <div role="alert">
              {/* The same generic sentence as every other auth failure: a wrong
                  current password must not be distinguishable from a rejected new
                  one (SEC-1). */}
              <Alert variant="error">{t("signIn.error")}</Alert>
            </div>
          )}
          <form method="post" action="/settings/password" className="flex max-w-sm flex-col gap-4">
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

      <Card padding="md" radius="md" border>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-(--color-text)">
            {t("settings.twoFactorTitle")}
          </h2>
          <Alert variant={session.twoFactorEnabled ? "success" : "warning"}>
            {session.twoFactorEnabled ? t("settings.twoFactorOn") : t("settings.twoFactorOff")}
          </Alert>
        </div>
      </Card>
    </div>
  );
}
