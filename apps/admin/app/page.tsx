import { redirect } from "next/navigation";

import { currentAdminSession, SHELL_HOME_PATH, SIGN_IN_PATH } from "@/lib/server/session";

/**
 * The admin root (task 031). There is no landing page: an authoring tool has no
 * marketing surface, and a dashboard is not on the launch cut-line, so `/` resolves to
 * the first real area or to sign-in.
 *
 * Written as a redirect rather than a `proxy.ts` rewrite so it uses the same session
 * authority as every other gate here (see `lib/server/session.ts` for why the proxy is
 * not that authority).
 */
export default async function AdminRootPage() {
  const session = await currentAdminSession();
  redirect(session === undefined ? SIGN_IN_PATH : SHELL_HOME_PATH);
}
