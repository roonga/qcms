import { FormsListRail } from "@/components/forms/forms-list-rail";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/** The form library's rail. Reads the query through the same function the page reads. */
export default async function FormsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <FormsListRail filters={readFormListFilters(await searchParams)} />;
}
