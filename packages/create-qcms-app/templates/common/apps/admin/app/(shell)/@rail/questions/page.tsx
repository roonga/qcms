import { QuestionsListRail } from "@/components/questions/questions-list-rail";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library's rail.
 *
 * Reads the query and nothing else: the count is how many filters are SET, so the screen
 * stays at one request. Both trees read the address through one function so they cannot
 * disagree about it.
 */
export default async function QuestionsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <QuestionsListRail filters={readQuestionListFilters(await searchParams)} />;
}
