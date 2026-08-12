import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { adminApiFetch } from "@/lib/server/api";
import { recoveryDisplayOwed } from "@/lib/server/enrollment";
import { currentAdminSession, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The one-time recovery-code display (task 031; wireframe state
 * `recovery-codes-display`).
 *
 * "One-time" is enforced by the {@link recoveryDisplayOwed} marker cookie, not by
 * hoping nobody reloads: the enrollment verify step opens the display and the
 * "I have saved these" confirm closes it, so a revisit lands on the shell instead of
 * re-printing the codes. The codes themselves are read back at display time rather
 * than carried through the enrollment cookie, so the only place they exist outside the
 * database is this response body.
 *
 * The read is `POST /admin/auth/recovery-codes` (task 056) rather than a local
 * `viewBackupCodes` call, because that better-auth function is declared server-only and
 * the server it now lives on is the API. It is POST, and it names no account: the API
 * takes the user id from the session token this BFF forwards, so the request cannot ask
 * for anyone else's codes even in principle.
 *
 * The a11y notes make the codes **a list**, so a screen reader announces "list, ten
 * items" and can walk them one by one - a `<pre>` block would read as one
 * undifferentiated run of characters. They are rendered in a monospace, tabular
 * figure style because a recovery code is transcribed by hand and `1`/`l` and `0`/`O`
 * have to be distinguishable.
 *
 * There is no "copy all" button, and that is the one wireframe affordance this task
 * does not ship. A clipboard write needs client JavaScript and a status region to
 * confirm it, which is a client interaction pattern the admin has no other use for
 * yet; selecting the visible list works today with keyboard and mouse. Recorded as a
 * discovery rather than improvised.
 */
export default async function RecoveryCodesPage() {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);
  if (!(await recoveryDisplayOwed())) redirect(SHELL_HOME_PATH);

  const response = await adminApiFetch(session, "/auth/recovery-codes", { method: "POST" });
  if (!response.ok) {
    // There is nothing to show and nothing the admin can do here, so send them on
    // rather than rendering an empty list that looks like "you have no codes".
    redirect(SHELL_HOME_PATH);
  }
  const { codes } = (await response.json()) as { codes: string[] };

  return (
    <AuthScreen title={t("recovery.title")} intro={t("recovery.intro")}>
      <ul
        aria-label={t("recovery.listLabel")}
        className="grid grid-cols-2 gap-2 rounded border border-(--color-border) bg-(--color-background-muted) p-3 font-mono text-sm tabular-nums text-(--color-text)"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <form method="post" action="/two-factor/recovery-codes/confirm">
        <Button type="submit" variant="primary" size="md">
          {t("recovery.confirm")}
        </Button>
      </form>
    </AuthScreen>
  );
}
