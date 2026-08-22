import { Alert, Button, Card, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";
import { settingsSectionHeadingId, SETTINGS_SECTION_IDS } from "@/lib/settings-sections";

/**
 * Settings (task 031; wireframe "Settings area at launch: account (change password →
 * sessions invalidated), 2FA re-enrollment, nothing else").
 *
 * Exactly those two things, and the "nothing else" is the binding half: no profile,
 * no preferences, no user list, no roles. RBAC is Phase 4 (R7).
 *
 * Regenerating recovery codes joined the 2FA card in issue #319, and it belongs to
 * the wireframe's "2FA re-enrollment" line rather than widening the area: it is the
 * only remedy an enrolled admin has for lost codes, now that no route reads the stored
 * set back. Password-gated, because better-auth requires the password and that is
 * exactly the re-authentication the operation wants.
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
 *
 * ## The three cards are the three sections the rail anchors (issue 562)
 *
 * `plan/admin-design-contracts.md` §7a gives this one screen a rail of same-page section
 * anchors, so each card is a `<section>` carrying the id its rail row points at, named by
 * its own `<h2>` through `aria-labelledby`. Nothing about the layout changes: the audit
 * calls Settings "the clearest reject on width in the app", the two password forms stay
 * capped at `max-w-sm`, and the rail is a sibling of `<main>` rather than a child of it, so
 * this column keeps the measure issue 558 assigned it.
 *
 * `tabindex={-1}` is what makes following a rail row move FOCUS into the section rather
 * than only scrolling to it, so the next Tab continues from the section a reader chose and
 * a screen reader announces which region it landed in. It takes no focus ring: the browser
 * only paints one for `:focus-visible`, which programmatic focus on a non-control does not
 * set.
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

      <section
        className="qcms-card qcms-settings-section"
        id={SETTINGS_SECTION_IDS.account}
        aria-labelledby={settingsSectionHeadingId(SETTINGS_SECTION_IDS.account)}
        tabIndex={-1}
      >
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-3">
            <h2
              className="text-base font-semibold text-(--color-text)"
              id={settingsSectionHeadingId(SETTINGS_SECTION_IDS.account)}
            >
              {t("settings.account")}
            </h2>
            <p className="text-sm text-(--color-text-muted)">
              {t("settings.signedInAs", { email: session.email })}
            </p>
          </div>
        </Card>
      </section>

      {/* The account menu's Change password item links straight here (task 032), so
          the anchor is part of that control's contract rather than decoration - and it
          is why this id keeps the name it has always had while the other two were
          written to match it (`lib/settings-sections.ts`). */}
      <section
        className="qcms-card qcms-settings-section"
        id={SETTINGS_SECTION_IDS.changePassword}
        aria-labelledby={settingsSectionHeadingId(SETTINGS_SECTION_IDS.changePassword)}
        tabIndex={-1}
      >
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-4">
            <h2
              className="text-base font-semibold text-(--color-text)"
              id={settingsSectionHeadingId(SETTINGS_SECTION_IDS.changePassword)}
            >
              {t("settings.passwordTitle")}
            </h2>
            <p className="text-sm text-(--color-text-muted)">{t("settings.passwordIntro")}</p>
            {/* No wrapper `role` on either: the vendored `Alert` already renders
              `role="alert"`, and nesting a second live region for one message means it
              is announced twice. */}
            {params.changed !== undefined && (
              <Alert variant="success">{t("settings.passwordChanged")}</Alert>
            )}
            {/* The same generic sentence as every other auth failure: a wrong current
              password must not be distinguishable from a rejected new one (SEC-1). */}
            {params.error !== undefined && <Alert variant="error">{t("signIn.error")}</Alert>}
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

      <section
        className="qcms-card qcms-settings-section"
        id={SETTINGS_SECTION_IDS.twoFactor}
        aria-labelledby={settingsSectionHeadingId(SETTINGS_SECTION_IDS.twoFactor)}
        tabIndex={-1}
      >
        <Card padding="md" radius="md" border>
          <div className="flex flex-col gap-3">
            <h2
              className="text-base font-semibold text-(--color-text)"
              id={settingsSectionHeadingId(SETTINGS_SECTION_IDS.twoFactor)}
            >
              {t("settings.twoFactorTitle")}
            </h2>
            {/* Prose, not an `Alert`: the vendored Alert is a live region (`role="alert"`),
              and this is standing state rather than something that just happened. As an
              Alert it announced itself on every visit to Settings and competed with the
              real password-change message for the screen reader's attention. */}
            <p
              className={
                session.twoFactorEnabled
                  ? "text-sm text-(--color-success-fg)"
                  : "text-sm text-(--color-warning-fg)"
              }
            >
              {session.twoFactorEnabled ? t("settings.twoFactorOn") : t("settings.twoFactorOff")}
            </p>
            {/* Only for an enrolled account: better-auth refuses to generate codes
                without a factor to back them, so offering the form otherwise would be
                a control that can only fail. */}
            {session.twoFactorEnabled && (
              <>
                <h3 className="text-sm font-semibold text-(--color-text)">
                  {t("settings.recoveryCodesTitle")}
                </h3>
                {/* The same generic sentence the password form uses: a wrong password
                    here must not be distinguishable from any other refusal (SEC-1). */}
                {params.codesError !== undefined && (
                  <Alert variant="error">{t("signIn.error")}</Alert>
                )}
                <p className="text-sm text-(--color-text-muted)">
                  {t("settings.recoveryCodesIntro")}
                </p>
                <form
                  method="post"
                  action="/settings/recovery-codes"
                  className="flex max-w-sm flex-col gap-4"
                >
                  {/* The password is what re-authenticates the operation (issue #319):
                      better-auth requires it, so a borrowed session cannot retire an
                      admin's codes. `current-password` rather than a new-password hint,
                      because that is exactly what it is. */}
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
    </div>
  );
}
