import { QuestionsListRail } from "@/components/questions/questions-list-rail";
import { readQuestionListFilters } from "@/lib/questions/list-filters";
import { requireAdminSession } from "@/lib/server/session";

/**
 * The question library's rail (§7.0, Code Owner 2026-10-24; issue #1117).
 *
 * This file exported `NoRailSection` until §7.0: the screen had no rail, on
 * `plan/admin-ux-audit.md` §5.4's reasoning that one here would repeat the page's own body.
 * The ruling keeps that objection and answers it - the rail carries no row per question, it
 * carries the screen's FILTERS and its creating action, which the content column used to
 * spend a card on above the table an author came to read.
 *
 * ## Why it reads the query and performs no read of its own
 *
 * The rail and the list are two React trees rendered from one URL and neither can hand the
 * other a value, so both ask `readQuestionListFilters` about the same `searchParams`. A
 * disagreement would be a screen saying two things: a Status select reading "Any status"
 * beside a list the server has narrowed to drafts.
 *
 * It calls `listQuestions` for nothing. The count beside the Filters title is how many
 * filters are SET, not how many rows came back, so the rail needs the address and nothing
 * else - which is also what keeps the screen at one request either way
 * (`lib/server/request-reads.test.ts` counts them).
 *
 * `requireAdminSession()` is called even though the `(shell)` layout already did, for the
 * reason every slot page in this directory calls it: a slot is a route segment of its own,
 * and this should not be the one place in the shell that renders authenticated chrome
 * without asking.
 */
export default async function QuestionsListRailSlot({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  return <QuestionsListRail filters={readQuestionListFilters(await searchParams)} />;
}
