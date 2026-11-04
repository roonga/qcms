import { MyAccessRail } from "@/components/shell/my-access-rail";
import { requireAdminSession } from "@/lib/server/session";

export default async function MyAccessRailSlot() {
  await requireAdminSession();
  return <MyAccessRail />;
}
