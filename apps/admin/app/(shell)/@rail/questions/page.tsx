import { QuestionsListRail } from "@/components/questions/questions-list-rail";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library's rail. Reads the query and nothing else, through the same function
 * the page reads it with, so the two trees cannot disagree about the address.
 */
export default async function QuestionsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <QuestionsListRail filters={readQuestionListFilters(await searchParams)} />;
}
