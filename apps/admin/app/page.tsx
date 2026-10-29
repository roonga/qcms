import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { navigableCapabilities, rememberedContext, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { restoredModePath } from "@/lib/shell/context";
import { landingArea, MY_ACCESS_PATH } from "@/lib/shell/modes";

/**
 * The admin root, which resolves where this caller lands.
 *
 * There is no landing page and no one home area: an Operations-only caller holds no
 * authoring screen, a workspace-only manager holds neither, and a caller with no feature
 * grant gets My access rather than a fabricated one. So the areas are read here and the
 * first permitted one is the destination, restoring whatever that mode remembered.
 *
 * It is also the only place a remembered context can be restored. The shell's layout does
 * not re-render on a soft navigation, so a navigation entry's href cannot carry per-request
 * state; this is a page, so it resolves on every arrival.
 *
 * Written as a redirect rather than a `proxy.ts` rewrite so it uses the same session
 * authority as every other gate here, and `requireAdminSession` applies the sign-in and
 * two-factor gates before any read is attempted.
 */
export default async function AdminRootPage() {
  const session = await requireAdminSession();
  const [capabilities, context] = await Promise.all([
    shellAccess(session).then(navigableCapabilities),
    rememberedContext(session, await cookies()),
  ]);
  const area = landingArea(capabilities);
  redirect(area === undefined ? MY_ACCESS_PATH : restoredModePath(area, context));
}
