import { ResponsesIndexRail } from "@/components/ops/responses-index-rail";
import { readResponsesIndexFilters } from "@/lib/ops/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/** The responses index's rail. Reads the query and performs no read of its own. */
export default async function ResponsesIndexRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <ResponsesIndexRail filters={readResponsesIndexFilters(await searchParams)} />;
}
