import { QuestionsListRail } from "@/components/questions/questions-list-rail";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { requireAdminSession } from "@/lib/server/session";

export default async function QuestionsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <QuestionsListRail filters={readQuestionListFilters(await searchParams)} />;
}
