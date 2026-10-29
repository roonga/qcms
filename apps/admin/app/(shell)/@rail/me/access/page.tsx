import { MyAccessRail } from "@/components/shell/my-access-rail";
import { requireAdminSession } from "@/lib/server/session";

/** My access's rail: a Header and nothing else, since the screen is one panel. */
export default async function MyAccessRailSlot() {
  await requireAdminSession();
  return <MyAccessRail />;
}
