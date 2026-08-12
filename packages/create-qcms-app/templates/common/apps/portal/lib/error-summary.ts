import type { A2UIErrors, A2UIStepDocument } from "@qcms/ui";

import { t } from "./i18n/en";
import { authorMessageFor } from "./validation-message";
import { messagesOf, questionLabels, questionPositions } from "./visible";

/**
 * The error-summary entries for a blocked Continue/Submit, for both portal
 * paths: the hydrated flow's missing-required summary (issue #21) and the no-JS
 * re-render's refused-answer summary (task 044).
 *
 * Every entry used to render the same sentence, so all summary links had the same
 * accessible name and a screen-reader user could not tell which field each one
 * pointed at (WCAG 3.3.1, Error Identification). Each entry now names its own
 * question, taking the label from the compiled step document the portal already
 * holds (the compiler resolves `label` onto every control node at publish time,
 * ADR-18) - no API change, and no rule evaluation here (R2).
 *
 * An author who supplied a message (task 048, ADR-32) replaces only the SENTENCE
 * BODY; the entry stays anchored to its own question. That is the whole point of
 * the composition: two questions carrying identical custom wording still produce
 * two distinct accessible names.
 *
 * ## What names a question with no label (issue #326)
 *
 * Its POSITION among the step's visible questions - "Question 3: ..." - never the
 * bare message and never a constant. Both of those were live here until #326: the
 * hydrated path substituted the constant `errorSummary.missingRequired`, so every
 * label-less entry was byte-identical, and the no-JS path emitted the raw
 * per-field message, so two questions sharing one authored message (which ADR-32
 * permits) were likewise identical. Opposite causes, the same WCAG 3.3.1 failure,
 * and two comments in this codebase asserted the property held in each. It did
 * not, in either.
 *
 * Position is what makes the property STRUCTURAL: no two questions share one, so
 * distinctness cannot regress when an author edits content. A guarantee that
 * depends on labels being present and distinct fails silently inside a
 * conformance claim, which is the failure mode worth designing out. The position
 * counts the PAGE and not the summary (`questionPositions` owns that, and says
 * why).
 *
 * The one entry still named by a constant is one whose question is in neither the
 * document nor the visible set: it has no label to read and no place on the page
 * to count to, and its anchor points at nothing rendered. Neither caller can
 * produce it - the hydrated flow intersects `missingRequired` with the step's
 * visible set before calling, and the no-JS route surfaces errors the API raised
 * against questions it just served - so this is the honest residue rather than a
 * guarantee: the summary is distinguishable for every entry it can actually draw.
 *
 * Both compositions live here, in one module, on purpose. They are the same
 * question asked twice ("what makes an entry distinguishable?"), and answering it
 * independently in each path is exactly how the two answers drifted apart.
 */
/**
 * One summary link. Shared by both compositions, so it is named for the summary
 * rather than for the missing-required set: the no-JS path lists every refused
 * answer, not only unanswered required questions.
 */
export interface ErrorSummaryEntry {
  /** The question this entry points at; the anchor target is `#<questionId>`. */
  readonly questionId: string;
  /** The link text, and therefore the link's accessible name. */
  readonly message: string;
}

/**
 * Name an entry whose question the document gave no label, by its 1-based
 * position among the step's visible questions. `body` is the sentence the entry
 * would otherwise have been reduced to; it is returned unchanged only when the
 * question has no position either, which is the residue the module comment
 * describes and neither caller can reach.
 *
 * Shared by both compositions below: it is the whole of what the two paths must
 * agree on, and the whole of what they disagreed on before issue #326.
 */
function unlabelledMessage(position: number | undefined, body: string): string {
  if (position === undefined) return body;
  return t("errorSummary.positional", { position, message: body });
}

/**
 * The hydrated flow's summary: one entry per still-missing required question
 * (issue #21), in `missing`'s order, which is the API's authoritative
 * missing-required set in document order - so the links read in the same order as
 * the fields.
 *
 * `visibleQuestions` is the API's visible set for the step being drawn, and is
 * only ever read for the ORDINAL a label-less entry is named by (R2).
 */
export function missingRequiredEntries(
  document: A2UIStepDocument | null,
  missing: readonly string[],
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  if (missing.length === 0) return [];
  const labels = document === null ? undefined : questionLabels(document);
  const messages = messagesOf(document);
  const positions = questionPositions(document, visibleQuestions);
  return missing.map((questionId) => {
    const label = labels?.get(questionId);
    const authored = authorMessageFor(messages.get(questionId), "required");
    let message: string;
    if (label === undefined) {
      message = unlabelledMessage(
        positions.get(questionId),
        authored ?? t("errorSummary.missingRequired"),
      );
    } else if (authored === undefined) {
      message = t("errorSummary.missingRequiredNamed", { label });
    } else {
      message = t("errorSummary.namedCustom", { label, message: authored });
    }
    return { questionId, message };
  });
}

/**
 * The no-JS re-render's summary (task 044): one entry per question the API
 * refused, in the order the route recorded them.
 *
 * The per-field message is already resolved by the time it gets here - the
 * author's wording for the failed constraint, else the default the BFF route
 * produced (`NativeStep.authoredErrors`) - so this only has to make each entry
 * name its own question. It composes exactly as the hydrated summary above does,
 * which is the point of the shared module.
 */
export function errorSummaryEntries(
  document: A2UIStepDocument | null,
  errors: A2UIErrors,
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  const entries = Object.entries(errors).filter(([, message]) => message !== undefined);
  if (entries.length === 0) return [];
  const labels = document === null ? undefined : questionLabels(document);
  const positions = questionPositions(document, visibleQuestions);
  return entries.map(([questionId, message]) => {
    const label = labels?.get(questionId);
    const body = message as string;
    return {
      questionId,
      message:
        label === undefined
          ? unlabelledMessage(positions.get(questionId), body)
          : t("errorSummary.namedCustom", { label, message: body }),
    };
  });
}
