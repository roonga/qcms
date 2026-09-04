import type { QuestionVersion } from "../questions/types.ts";

import { getQuestion } from "./questions.ts";
import type { AdminSession } from "./session.ts";

/**
 * The one read behind the question detail screen's rail (issue 650).
 *
 * `lib/server/form-rail.ts` is the same job for the form-subtree rail and states the policy
 * this file follows: NOTHING HERE IS FATAL. A rail is navigation beside a page, never the
 * page, so a question that cannot be read gets no rail at all and leaves the screen's own
 * 404 or error alert to speak. The screen has already read the same question for itself, so
 * a rail is never the only thing on a page and never the thing that decides whether one
 * renders.
 *
 * ## One read, not two, and why it costs a second call to the API
 *
 * The rail's group is the question's versions, and `GET /admin/questions/{id}` returns all
 * of them in one answer, so unlike the form rail there is no verdict to fetch and no badge
 * to attribute. What it does cost is a second read of the same question in the same
 * request: a parallel route and the page beside it are separate React trees and neither can
 * hand the other a value. That cost is stated here rather than hidden, and it is still
 * stated: issue #626 removed the equivalent duplicate on the FORM side by memoizing
 * `getForm` per request at its own definition, and left this one standing because its
 * issue covered form-scoped screens. So the answer for a question screen is `cache()` on
 * `getQuestion`, in `questions.ts`, the way `forms.ts` now does it - a separate issue's
 * one-line change rather than something for this loader to work around.
 */

/** What the rail needs about one question, once its read has landed. */
export interface QuestionRailData {
  readonly questionId: string;
  /** Every version the question has ever had, oldest first, as the API returns them. */
  readonly versions: readonly QuestionVersion[];
}

/**
 * The rail's data for one question, or `null` when the question could not be read.
 *
 * A question with no versions at all also gets no rail: the rail's one group would be empty
 * and its summary would name a version that does not exist. The screen answers that state
 * with its own 404 (a question the API returns without versions has nothing to select), so
 * there is nothing for a rail to sit beside.
 */
export async function loadQuestionRail(
  session: AdminSession,
  questionId: string,
): Promise<QuestionRailData | null> {
  const detail = await getQuestion(session, questionId);
  if (!detail.ok) return null;
  if (detail.data.versions.length === 0) return null;
  return { questionId: detail.data.questionId, versions: detail.data.versions };
}
