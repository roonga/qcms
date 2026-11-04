import { getDraft } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { validateDraft } from "../forms/handler.js";

export interface PinnedQuestion {
  readonly questionId: string;
  readonly version: number;
}

/**
 * The question versions the form's SAVED draft pins that are not published yet, from the
 * server's own publish compile. Read from the stored draft rather than from anything a turn
 * proposed, so an edit made after an earlier proposal was applied changes this answer.
 */
export async function unpublishedDraftPins(
  deps: Deps,
  formId: FormId,
): Promise<readonly PinnedQuestion[]> {
  const row = await getDraft(deps.databases.control, formId);
  if (row === undefined) return [];
  const { issues } = await validateDraft(deps, row.definition);
  const seen = new Set<string>();
  const pins: PinnedQuestion[] = [];
  for (const issue of issues) {
    if (issue.code !== "UNPUBLISHED_QUESTION_PIN") continue;
    const key = `${issue.path.question}@${String(issue.path.version)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pins.push({ questionId: issue.path.question, version: issue.path.version });
  }
  return pins;
}
