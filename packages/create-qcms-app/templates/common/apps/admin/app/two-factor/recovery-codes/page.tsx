import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button } from "@/components/kit";
import { RecoveryCodes } from "@/components/recovery-codes";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { owedRecoveryCodes } from "@/lib/server/enrollment";
import { currentAdminSession, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

export function generateMetadata(): Metadata {
  return pageMetadata(t("recovery.title"));
}

/* Display only newly issued codes from the one-time cookie; clearing it prevents later retrieval or
   display. */
export default async function RecoveryCodesPage() {
  const session = await currentAdminSession();
  if (session === undefined) redirect(SIGN_IN_PATH);

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
