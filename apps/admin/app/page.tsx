import { redirect } from "next/navigation";

import { navigableCapabilities, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { landingPath } from "@/lib/shell/modes";

/**
 * The admin root, which resolves where this caller lands.
 *
 * There is no landing page and no one home area: an Operations-only caller holds no
 * authoring screen, a workspace-only manager holds neither, and a caller with no feature
 * grant gets My access rather than a fabricated one. So the areas are read here and the
 * first permitted one is the destination.
 *
 * Written as a redirect rather than a `proxy.ts` rewrite so it uses the same session
 * authority as every other gate here, and `requireAdminSession` applies the sign-in and
 * two-factor gates before any read is attempted.
 */
export default async function AdminRootPage() {
  const session = await requireAdminSession();
  redirect(landingPath(navigableCapabilities(await shellAccess(session))));
}
