import { SiteRail } from "@/components/shell/site-rail";
import { listWorkspaces } from "@/lib/server/membership";
import { requireAdminSession } from "@/lib/server/session";

export default async function SharedLibraryRailSlot() {
  const session = await requireAdminSession();
  const workspaces = await listWorkspaces(session);
  const offersLibrary = workspaces.ok && workspaces.data.length > 1;
  return <SiteRail current="shared-library" offersLibrary={offersLibrary} />;
}
