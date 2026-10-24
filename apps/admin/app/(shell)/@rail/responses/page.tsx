import { ResponsesIndexRail } from "@/components/ops/responses-index-rail";
import { readResponsesIndexFilters } from "@/lib/ops/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The responses index's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * It exported `NoRailSection` until §7.0 gave every screen a rail. It reads the query and
 * performs no read of its own: the Sections are one fixed route and the Filters part shows
 * what the address asked for, so there is nothing to load - which is what keeps this screen
 * at one request (`lib/server/request-reads.test.ts` counts them).
 */
export default async function ResponsesIndexRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <ResponsesIndexRail filters={readResponsesIndexFilters(await searchParams)} />;
}
