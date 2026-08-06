import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { readAuthCookie, TWO_FACTOR_COOKIE } from "@/lib/server/auth-api";
import { SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The 2FA challenge (task 031; wireframe state `2FA-challenge`).
 *
 * Reached only with a pending challenge, which is the short-lived two-factor cookie
 * better-auth sets in place of a session when a password verifies for an enrolled
 * account. No cookie means no challenge is open - a direct visit, or a lapsed one -
 * so the page sends the visitor back to sign in rather than presenting a code field
 * that could never succeed.
 *
 * There is deliberately no session here and nothing about the account on screen: not
 * the email, not a masked hint, not "welcome back". The password has been accepted
 * but authentication is not complete, and anything identifying rendered at this point
 * would be a free oracle for whoever holds the password (SEC-1).
 */
export default async function ChallengePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pending = await readAuthCookie(TWO_FACTOR_COOKIE);
  if (pending === undefined || pending === "") redirect(SIGN_IN_PATH);

  const error = (await searchParams).error !== undefined ? t("signIn.error") : undefined;

  return (
    <AuthScreen title={t("challenge.title")} intro={t("challenge.intro")} error={error}>
      <form method="post" action="/two-factor/challenge/verify" className="flex flex-col gap-4">
        <TextField
          name="code"
          label={t("challenge.codeLabel")}
          inputMode="numeric"
          autoComplete="one-time-code"
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.verify")}
        </Button>
      </form>
      <Link
        href="/two-factor/recovery"
        className="text-sm text-(--color-primary) underline underline-offset-2"
      >
        {t("challenge.useRecovery")}
      </Link>
    </AuthScreen>
  );
}
