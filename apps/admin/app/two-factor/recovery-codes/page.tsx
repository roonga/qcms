import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/kit";
import { RecoveryCodes } from "@/components/recovery-codes";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { owedRecoveryCodes } from "@/lib/server/enrollment";
import { currentAdminSession, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("recovery.title"));
}

/**
 * The one-time recovery-code display (task 031; screen contract state
 * `recovery-codes-display`).
 *
 * "One-time" is enforced by the {@link owedRecoveryCodes} cookie, not by hoping nobody
 * reloads: whichever step issued the codes puts them there and the "I have saved these"
 * confirm clears it, so a revisit lands on the shell instead of re-printing them.
 *
 * Two steps issue codes and both land here: enrollment (the sign-in POST captures what
 * `two-factor/enable` returned) and Settings' regenerate form. Nothing reads the codes
 * on record - issue #319 removed `POST /admin/auth/recovery-codes`, which did exactly
 * that and is what made the "shown once" promise untrue. So this response body prints
 * a set that was handed over moments ago and can never be recovered afterwards, which
 * is the property the screen has always claimed to have.
 *
 * The list, the copy control and its status line are `components/recovery-codes.tsx`, a
 * client island: a clipboard write needs client JavaScript, which `docs/admin-constraints.md`
 * makes available. The **flow** stays where that document constrains it to be - the confirm
 * below is a plain form post to a named route handler, so no auth endpoint moves into the
 * client (ADR-35 / SEC-1).
 *
 * An earlier version of this comment recorded that the screen deliberately shipped without a
 * copy-all, because a clipboard write needed client JavaScript and a status region the admin
 * had no other use for. Both halves of that have since changed underneath it, which is issue
 * 683: JavaScript is available, and the two POCs that draw the button are the approved design
 * rather than a proposal.
 */
export default async function RecoveryCodesPage() {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);

  // Nothing owed means nothing to show and nothing the admin can do here, so send them
  // on rather than rendering an empty list that looks like "you have no codes".
  const codes = await owedRecoveryCodes();
  if (codes === undefined) redirect(SHELL_HOME_PATH);

  return (
    <AuthScreen title={t("recovery.title")} intro={t("recovery.intro")}>
      <RecoveryCodes codes={codes} />
      <form method="post" action="/two-factor/recovery-codes/confirm">
        <Button type="submit" variant="primary" size="md">
          {t("recovery.confirm")}
        </Button>
      </form>
    </AuthScreen>
  );
}
