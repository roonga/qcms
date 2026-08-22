import { Alert, Button, Card, TextField } from "@/components/kit";
import { SettingsPanels } from "@/components/settings-panels";
import { t } from "@/lib/i18n/en";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requireAdminSession } from "@/lib/server/session";
import { SETTINGS_HEADING_ID, settingsSectionFromParams } from "@/lib/settings-sections";

/**
 * Settings (task 031; screen contract "Settings area at launch: account (change password →
 * sessions invalidated), 2FA re-enrollment, nothing else").
 *
 * Exactly those two things, and the "nothing else" is the binding half: no profile,
 * no preferences, no user list, no roles. RBAC is Phase 4 (R7).
 *
 * Regenerating recovery codes joined the 2FA panel in issue #319, and it belongs to
 * the screen contract's "2FA re-enrollment" line rather than widening the area: it is the
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
 * ## Three panels, one on screen (issue 655)
 *
 * `plan/admin-shell-poc/settings-newquestion-poc.html` is the approved design for this
 * screen and it draws three panels with two of them `hidden`, switched by the rail, under a
 * heading that names the showing section rather than the screen. Its reason is that account,
 * change password and two-factor authentication are "three genuinely separate surfaces, and
 * stacking all three in one scroll was hiding that". Before this change all three were
 * stacked in one scroll, which is what issue 655 exists to correct.
 *
 * The switch needs JavaScript and **no fallback is provided**. `docs/admin-constraints.md`
 * settles it: the POCs are the design, and JavaScript is available here. This screen was
 * previously built as though a no-script floor bound the admin, and none does.
 *
 * This page stays a server component: it reads the session and renders the three panel
 * bodies, and `components/settings-panels.tsx` is the only client piece, deciding which one
 * is on screen. Which one that IS on arrival is decided here, from the query, because the two
 * POST routes below land their reader back on this screen with a marker
 * (`?changed=1`, `?error=1`, `?codesError=1`) whose message lives inside one particular
 * panel: a screen that always opened on Account would hide the confirmation that a password
 * change happened.
 *
 * Every panel is named by the one `<h1>` through `aria-labelledby`, so the region a screen
 * reader lands in carries the section's name. That is also why no panel repeats its own name
 * as an `<h2>` any more: the heading above it already says it, which is the POC's own
 * reasoning for promoting Recovery codes from `<h3>` to `<h2>`.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminSession();
  const params = await searchParams;

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
        ),
        "two-factor": (
          <section className="qcms-card" aria-labelledby={SETTINGS_HEADING_ID}>
            <Card padding="md" radius="md" border>
              <div className="flex flex-col gap-3">
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
                  {session.twoFactorEnabled
                    ? t("settings.twoFactorOn")
                    : t("settings.twoFactorOff")}
                </p>
                {/* Only for an enrolled account: better-auth refuses to generate codes
                  without a factor to back them, so offering the form otherwise would be
                  a control that can only fail. */}
                {session.twoFactorEnabled && (
                  <>
                    {/* One level under the page heading, which now names this panel, so this
                      is the panel's first subheading rather than its second (the POC makes
                      the same promotion for the same reason). */}
                    <h2 className="text-sm font-semibold text-(--color-text)">
                      {t("settings.recoveryCodesTitle")}
                    </h2>
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
        ),
      }}
    />
  );
}
