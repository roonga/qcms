import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { authFailureMessage } from "@/lib/auth-failure-message";
import { t } from "@/lib/i18n/en";
import { pageMetadata } from "@/lib/page-title";
import { currentAdminSession, SHELL_HOME_PATH } from "@/lib/server/session";

/**
 * Sign-in (task 031, including signed-out and sign-in-error states).
 *
 * There is **no registration link, hint, or "create an account" affordance anywhere
 * on this page**, and there is no route that would serve one: SEC-1 requires that
 * no self-registration path exists in any composition, and the first admin is
 * created by `pnpm qcms:create-admin`. The absence is the feature.
 *
 * The form is a native POST to `/sign-in/submit`, and the reason is where the credential
 * goes: it never passes through client JavaScript (ADR-35 / SEC-1). That is not a no-JS
 * claim - the admin requires JavaScript and hides this form without it (Code Owner,
 * 2026-09-27, `plan/admin-design-contracts.md`) - and it is untouched by that ruling,
 * because moving the post into a `fetch` would put a credential in the client bundle's
 * reach and republish the endpoint set. Failures come
 * back as an opaque `?error=1` marker that renders one fixed sentence: an unknown
 * email and a wrong password are indistinguishable here and in the API's logs.
 *
 * Which sentence a marker renders is `lib/auth-failure-message.ts`, shared with the 2FA
 * screens since issue #805 so that the throttled state cannot be answered by one screen
 * and collapsed into "wrong code" by the next.
 */

/** The browser-tab title for this route (issue #536). */
export function generateMetadata(): Metadata {
  return pageMetadata(t("action.signIn"));
}

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Already signed in: nothing on this page applies. Sending them on also stops a
  // stale form in a back-button cache from re-posting a credential.
  if ((await currentAdminSession()) !== undefined) redirect(SHELL_HOME_PATH);

  const params = await searchParams;
  const error = authFailureMessage(params);
  // Only the local dev Compose overlay enables credential links. NODE_ENV cannot
  // distinguish it from a deployment because dev:up runs production images too.
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
