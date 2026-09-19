import type { A2UIErrors, A2UIStepDocument } from "@roonga/qcms-ui";

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
 *
 * ## The no-JS path reads the same set the hydrated one gates on (issue #920)
 *
 * It did not, until #920: the hydrated flow blocked Continue on the API's
 * `missingRequired` and drew this summary from it, while the no-JS route dropped the
 * set on the floor and 303'd back to an unchanged step. A respondent with scripting
 * off who left a required question blank saw a reload and no message - and the same
 * silence answered a crafted post that skipped the browser's own `required`
 * altogether. `missingOnStep`, `requiredFieldErrors` and `orderedEntries` below are
 * what that path needs on top of the two compositions, and all three are narrowings
 * and wordings: `required` stays the kernel's judgement, served by the API, on both
 * paths.
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

/**
 * The required questions a no-JS re-render must report: the API's own
 * missing-required set, narrowed to the step being drawn and to questions not
 * already carrying a refusal (issue #920).
 *
 * The narrowing to the visible set is what makes a forged re-render context inert.
 * The context cookie is `httpOnly` but unsigned, so a respondent can hand the render
 * any list of ids they like; all it can buy is a message beside a question on their
 * own screen, and the API - which never reads that cookie - still refuses the
 * submit. The narrowing around refusals is editorial rather than defensive: a
 * question the API refused is missing an answer by construction, and the kernel's
 * message about the value it refused says more than "this needs an answer".
 *
 * The result is DE-DUPLICATED, which the API's own set never needs: a forged cookie
 * can repeat an id, and each surviving id becomes a React key and a summary anchor, so
 * a repeat would draw one question twice under one key. De-duplicating here rather
 * than at the cookie's schema keeps the guarantee at the seam that produces the keys,
 * so it holds for any caller rather than only for the one path the cookie takes.
 *
 * Decides nothing about `required`. The set arrives from the kernel by way of the
 * API (`evaluateRules`, invariant I9), exactly as it does on the hydrated path.
 */
export function missingOnStep(
  missingRequired: readonly string[],
  visibleQuestions: readonly string[],
  errors: A2UIErrors,
): readonly string[] {
  if (missingRequired.length === 0) return [];
  const visible = new Set(visibleQuestions);
  return [...new Set(missingRequired)].filter(
    (questionId) => visible.has(questionId) && !Object.hasOwn(errors, questionId),
  );
}

/**
 * The field-slot message for a question with no answer: the author's wording for the
 * `required` constraint (ADR-32) if there is one, else the catalogue default.
 *
 * Deliberately the same resolution {@link missingRequiredEntries} makes for the
 * summary link, so the two places one respondent reads about one gap cannot say
 * different things - which is the drift this module exists to prevent.
 *
 * The hydrated path draws the summary alone and this one draws both. That is a
 * considered difference rather than an oversight: a no-JS respondent gets one render
 * per POST, with nothing re-validating under them as they type, so the field itself
 * has to carry the state until the next round trip. Whether the hydrated path should
 * mark the field too is **issue #967**, so the asymmetry is recorded rather than left
 * as a remark.
 */
export function requiredFieldErrors(
  document: A2UIStepDocument | null,
  missing: readonly string[],
): Readonly<Record<string, string>> {
  const messages = messagesOf(document);
  const resolved: Record<string, string> = {};
  for (const questionId of missing) {
    resolved[questionId] =
      authorMessageFor(messages.get(questionId), "required") ?? t("errorSummary.missingRequired");
  }
  return resolved;
}

/**
 * Put summary entries in the order the fields are asked, rather than in the order
 * the two compositions above happen to produce them (issue #920).
 *
 * Refused answers and unanswered required questions arrive as two document-ordered
 * lists, and concatenating them interleaves the page badly for a respondent holding
 * one of each - the summary would send them back up the form and then down again.
 * `visibleQuestions` is the API's own order for the drawn step, so it is the one
 * thing both lists can be sorted against. An entry naming a question outside that
 * set (which neither caller can produce - see the module comment) sorts last, and
 * the sort is stable within a rank, so equal entries keep their composition's order.
 */
export function orderedEntries(
  entries: readonly ErrorSummaryEntry[],
  visibleQuestions: readonly string[],
): readonly ErrorSummaryEntry[] {
  const order = new Map(visibleQuestions.map((questionId, index) => [questionId, index]));
  return entries
    .map((entry, index) => ({ entry, index, rank: order.get(entry.questionId) ?? order.size }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((row) => row.entry);
}
