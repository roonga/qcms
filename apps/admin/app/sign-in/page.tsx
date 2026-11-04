import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { currentAdminSession, SHELL_HOME_PATH } from "@/lib/server/session";

/* Use a native POST so credentials do not pass through client JavaScript. */

export function generateMetadata(): Metadata {
  return pageMetadata(t("action.signIn"));
}

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Redirect authenticated visitors away so Back cannot leave a cached credential form available for
  // reposting.
  if ((await currentAdminSession()) !== undefined) redirect(SHELL_HOME_PATH);

  const params = await searchParams;
  const error = authFailureMessage(params);
  // NODE_ENV cannot identify local development: the dev Compose overlay runs production images too.
  const password =
    process.env.QCMS_DEV_LOGIN_PREFILL === "true" && typeof params.password === "string"
      ? params.password
      : "";

  return (
    <AuthScreen title={t("signIn.title")} error={error}>
      <form method="post" action="/sign-in/submit" className="flex flex-col gap-4">
        <TextField
          name="email"
          type="email"
          label={t("signIn.email")}
          autoComplete="username"
          defaultValue={typeof params.email === "string" ? params.email : ""}
          isRequired
        />
        <TextField
          name="password"
          type="password"
          label={t("signIn.password")}
          autoComplete="current-password"
          defaultValue={password}
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.signIn")}
        </Button>
      </form>
    </AuthScreen>
  );
}
