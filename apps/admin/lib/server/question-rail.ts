import type { QuestionVersion } from "../questions/types.ts";

import { getQuestion } from "./questions.ts";
import type { AdminSession } from "./session.ts";

/** Rail failures omit navigation without failing the page; the page owns its 404 or error. The question read is shared only within this request. */

export interface QuestionRailData {
  readonly questionId: string;
  /** Use the metadata already returned by getQuestion; no second read is needed. */
  readonly slug: string;
  readonly createdAt: string;

  readonly versions: readonly QuestionVersion[];
}

/** No versions means no rail; the page owns that 404 instead of a rail naming a nonexistent version. */
export async function loadQuestionRail(
  session: AdminSession,
  questionId: string,
): Promise<QuestionRailData | null> {
  const detail = await getQuestion(session, questionId);
  if (!detail.ok) return null;
  if (detail.data.versions.length === 0) return null;
  return {
    questionId: detail.data.questionId,
    slug: detail.data.slug,
    createdAt: detail.data.createdAt,
    versions: detail.data.versions,
  };
}
