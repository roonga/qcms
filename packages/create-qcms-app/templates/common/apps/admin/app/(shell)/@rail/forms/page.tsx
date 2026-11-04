import { FormsListRail } from "@/components/forms/forms-list-rail";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { requireAdminSession } from "@/lib/server/session";

export default async function FormsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <FormsListRail filters={readFormListFilters(await searchParams)} />;
}
