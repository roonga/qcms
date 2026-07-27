import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { TWO_FACTOR_COOKIE } from "@/lib/server/auth";
import { SIGN_IN_PATH } from "@/lib/server/session";

/**
 * Recovery-code entry (task 031; wireframe state `2FA-recovery-entry`).
 *
 * A separate route rather than a toggle on the challenge screen, for the same reason
 * the rest of this flow is route-based: it works without JavaScript, it is
 * linkable, and each state is one server-rendered page a test can land on directly.
 * The "use your authenticator app instead" link back makes the pair navigable in both
 * directions, which the wireframe's two states imply.
 *
 * Same pending-challenge precondition as the TOTP screen, and the same silence about
 * the account.
 */
export default async function RecoveryEntryPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pending = (await cookies()).get(TWO_FACTOR_COOKIE)?.value;
  if (pending === undefined || pending === "") redirect(SIGN_IN_PATH);

  const error = (await searchParams).error !== undefined ? t("signIn.error") : undefined;

  return (
    <AuthScreen title={t("recoveryEntry.title")} intro={t("recoveryEntry.intro")} error={error}>
      <form method="post" action="/two-factor/recovery/verify" className="flex flex-col gap-4">
        <TextField
          name="code"
          label={t("recoveryEntry.codeLabel")}
          autoComplete="one-time-code"
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.verify")}
        </Button>
      </form>
      <Link
        href="/two-factor/challenge"
        className="text-sm text-(--color-primary) underline underline-offset-2"
      >
        {t("recoveryEntry.useApp")}
      </Link>
    </AuthScreen>
  );
}
