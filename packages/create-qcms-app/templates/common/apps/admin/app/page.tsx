import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { navigableCapabilities, rememberedContext, shellAccess } from "@/lib/server/shell";
import { requireAdminSession } from "@/lib/server/session";
import { restoredModePath } from "@/lib/shell/context";
import { landingArea, MY_ACCESS_PATH } from "@/lib/shell/modes";

export default async function AdminRootPage() {
  const session = await requireAdminSession();
  const [capabilities, context] = await Promise.all([
    shellAccess(session).then(navigableCapabilities),
    rememberedContext(session, await cookies()),
  ]);
  const area = landingArea(capabilities);
  redirect(area === undefined ? MY_ACCESS_PATH : restoredModePath(area, context));
}
