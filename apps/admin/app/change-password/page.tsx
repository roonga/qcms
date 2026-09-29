import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Alert, Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { MIN_PASSWORD_LENGTH } from "@/lib/server/config";
import { requirePasswordChangeSession } from "@/lib/server/session";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("forcedPassword.title"));
}

/**
 * The forced password change on first sign-in after bootstrap (task 061; SEC-1).
 *
 * `qcms:create-admin` sets a password that comes from a shell command, a provisioning
 * script, a CI variable or an operator's terminal history - all places a standing
 * credential should not live, and usually not chosen by the person who ends up using
 * the account. It is a transfer mechanism, and this screen is where the transfer ends.
 * `lib/server/session.ts` holds the gate that sends every route here while
 * `user.mustChangePassword` is set, and the reasoning for why this comes before 2FA
 * enrollment.
 *
 * ## Why it is a native form POST to a named server route
 *
 * The same reason sign-in is, and it is not a no-JavaScript claim: the admin requires
 * JavaScript and hides these forms without it (Code Owner, 2026-09-27). This screen
 * handles a credential, and ADR-35 / SEC-1 keep a credential out of the client
 * bundle's reach - moving the post into a `fetch` would put one there and republish
 * the endpoint set. So it posts to `/change-password/submit`, which forwards the one
 * operation over the SEC-4 internal channel and re-emits better-auth's cookies on its
 * own 303.
 *
 * ## Why this screen sits outside `app/(shell)/`
 *
 * The shell's layout gate would redirect it to itself: an account that must change its
 * password is precisely the one the gate refuses. It is an auth screen and it lives
 * with the other auth screens, guarded by `requirePasswordChangeSession()` rather than
 * by the layout - the same arrangement sign-in and the two-factor screens use, for the
 * same reason.
 *
 * ## The validation is the ordinary path's, not a second policy
 *
 * The handler calls the same `/change-password` endpoint Settings does, so the length
 * floor, the breach-corpus check (issue #178) and better-auth's own current-password
 * verification all apply here without being restated. The one thing this screen adds is
 * the confirmation field, which is checked before the call because a typo in a new
 * password nobody has typed twice is not something the API can see.
 *
 * ## What the three messages are, and why there are three
 *
 * The generic sentence (SEC-1: a wrong current password must be indistinguishable from
 * a rejected new one), the throttled sentence, and two exceptions that say nothing
 * about the account: a mismatch between the two new fields, and the breach-corpus
 * refusal ruled on for issue #437. Both exceptions are statements about values the
 * submitter just typed and already holds.
 */
export default async function ForcedPasswordChangePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePasswordChangeSession();

  const params = await searchParams;
  // Shared with sign-in and the two-factor screens so a 429 from the SEC-1 limiter
  // cannot be reported here as a wrong password (issue #805).
  const error = authFailureMessage(params);

  return (
    <AuthScreen
      title={t("forcedPassword.title")}
      intro={t("forcedPassword.intro")}
      error={error}
    >
      {/* No wrapper `role` on either: the vendored `Alert` already renders `role="alert"`,
          and nesting a second live region for one message means it is announced twice.
          `AuthScreen` focuses the generic alert above; these two are below the intro and
          in the reading order of the form they belong to. */}
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
