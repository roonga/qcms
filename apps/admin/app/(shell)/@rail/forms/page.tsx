import { FormsListRail } from "@/components/forms/forms-list-rail";
import { readFormListFilters } from "@/lib/forms/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The form library's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * The sibling of `@rail/questions/page.tsx` and the same three decisions: it exported
 * the no-section stub until §7.0 gave every screen a rail, it reads the query rather than
 * performing a read of its own, and it reads it through the one function the page reads it
 * through (`readFormListFilters`), because the rail and the table are two React trees
 * rendered from one URL and a second parse is how they start disagreeing.
 */
export default async function FormsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <FormsListRail filters={readFormListFilters(await searchParams)} />;
}
