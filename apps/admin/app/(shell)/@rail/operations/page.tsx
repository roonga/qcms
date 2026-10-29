import { OperationsRail } from "@/components/shell/operations-rail";
import { requireAdminSession } from "@/lib/server/session";

/** Operations' rail. The forms table's filters join it with the table itself. */
export default async function OperationsRailSlot() {
  await requireAdminSession();
  return <OperationsRail />;
}
