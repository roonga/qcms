import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { readAuthCookie, TWO_FACTOR_COOKIE } from "@/lib/server/auth-api";
import { SIGN_IN_PATH } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("challenge.title"));
}

/* Until the second factor verifies, render no account identity or hint that could become an authentication
   oracle. */
export default async function ChallengePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const pending = await readAuthCookie(TWO_FACTOR_COOKIE);
  if (pending === undefined || pending === "") redirect(SIGN_IN_PATH);

  const error = authFailureMessage(await searchParams);

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
