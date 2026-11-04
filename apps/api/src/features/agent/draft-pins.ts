import { getDraft } from "@roonga/qcms-db";
import type { FormId } from "@roonga/qcms-core";

import type { Deps } from "../../deps.js";
import { validateDraft } from "../forms/handler.js";

export interface PinnedQuestion {
  readonly questionId: string;
  readonly version: number;
}

/** One reading of a form's saved draft: the revision it was read at, and what it pins unpublished. */
export interface SavedDraftPins {
  readonly revision: number;
  readonly pins: readonly PinnedQuestion[];
}

/**
 * The question versions the form's SAVED draft pins that are not published yet, from the
 * server's own publish compile, with the revision they were read at. Read from the stored
 * draft rather than from anything a turn proposed, so an edit made after an earlier
 * proposal was applied changes this answer.
 */
export async function savedDraftPins(
  deps: Deps,
  formId: FormId,
): Promise<SavedDraftPins | undefined> {
  const row = await getDraft(deps.databases.control, formId);
  if (row === undefined) return undefined;
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
  return { revision: row.revision, pins };
}

/** The revision alone, which is what a proposal built from the saved draft is bound to. */
export async function savedDraftRevision(deps: Deps, formId: FormId): Promise<number | undefined> {
  return (await getDraft(deps.databases.control, formId))?.revision;
}

/** The pins alone, for a turn's facts, which report the set rather than bind a plan to it. */
export async function unpublishedDraftPins(
  deps: Deps,
  formId: FormId,
): Promise<readonly PinnedQuestion[]> {
  return (await savedDraftPins(deps, formId))?.pins ?? [];
}
