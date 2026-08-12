import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth-screen";
import { Button, TextField } from "@/components/kit";
import { t } from "@/lib/i18n/en";
import { currentAdminSession, SHELL_HOME_PATH } from "@/lib/server/session";

/**
 * Sign-in (task 031; wireframe `docs/wireframes/admin-shell.md`, the signed-out and
 * sign-in-error states).
 *
 * There is **no registration link, hint, or "create an account" affordance anywhere
 * on this page**, and there is no route that would serve one: SEC-1 requires that
 * no self-registration path exists in any composition, and the first admin is
 * created by `pnpm qcms:create-admin`. The absence is the feature.
 *
 * The form is a native POST to `/sign-in/submit`, so the credential never passes
 * through client JavaScript and the screen works before hydration. Failures come
 * back as an opaque `?error=1` marker that renders one fixed sentence: an unknown
 * email and a wrong password are indistinguishable here and in the API's logs.
 */

/**
 * The one message this screen may show, chosen from the opaque markers a failed POST
 * redirects with. Three distinguishable markers, one for each state the wireframe names
 * (generic failure, throttled, session expired) - and nothing more granular than that,
 * because a fourth marker is how enumeration gets reintroduced (SEC-1).
 */
function signInMessage(
  params: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  if (params.throttled !== undefined) return t("signIn.throttled");
  if (params.expired !== undefined) return t("signIn.expired");
  if (params.error !== undefined) return t("signIn.error");
  return undefined;
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
  const error = signInMessage(params);

  return (
    <AuthScreen title={t("signIn.title")} error={error}>
      <form method="post" action="/sign-in/submit" className="flex flex-col gap-4">
        <TextField
          name="email"
          type="email"
          label={t("signIn.email")}
          autoComplete="username"
          isRequired
        />
        <TextField
          name="password"
          type="password"
          label={t("signIn.password")}
          autoComplete="current-password"
          isRequired
        />
        <Button type="submit" variant="primary" size="md">
          {t("action.signIn")}
        </Button>
      </form>
    </AuthScreen>
  );
}
