import { z } from "zod";

import { QcmsError, err, ok, type Result } from "./errors.js";
import { FormId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";
import { LocaleCode, LocalizedText } from "./localized-text.js";
import { isRepeatGroup, Step, type StepItem } from "./step.js";
import { VisibilityRule } from "./visibility-rule.js";

/**
 * Form definitions (DOMAIN_SCHEMA §2.3, ADR-02, ADR-11): ordered steps of
 * pinned question references plus visibility rules. A draft may float, a
 * snapshot never does.
 *
 * Parsing enforces parse-level refinements only; the cross-entity publish
 * invariants are `compileDraft`'s.
 */

/**
 * Typed error codes for form-definition parsing. A parse failure carries every
 * issue with its code and path (CONTRIBUTING). The codes shared with
 * `PublishErrorCode` are deliberately the same strings, so publish surfaces the
 * same violation verbatim when handed a raw draft.
 */
export const FormDefinitionErrorCode = z.enum([
  "INVALID_FORM_DEFINITION",
  "DUPLICATE_STEP_ID",
  "DUPLICATE_QUESTION_IN_FORM",
  "DUPLICATE_GROUP_ID",
  "RULE_DEPTH_EXCEEDED",
]);
export type FormDefinitionErrorCode = z.infer<typeof FormDefinitionErrorCode>;

export const FormDefinitionError = QcmsError.extend({ code: FormDefinitionErrorCode });
export type FormDefinitionError = z.infer<typeof FormDefinitionError>;

/** Narrows the shared coded-issue plumbing to this module's codes, so a typo
 * is a compile error. */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: FormDefinitionErrorCode,
  message: string,
  path: readonly (string | number)[],
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/** Re-exported from `step.ts`, where the repeating group lives beside them. */
export { QuestionRef, Step } from "./step.js";

/**
 * The form aggregate (DOMAIN_SCHEMA §2.3). A duplicate `stepId` or a question
 * pinned twice makes rule targeting and answer keying ambiguous, so it is
 * malformed input rather than merely unpublishable.
 *
 * There is deliberately no per-form navigation escape: answering never changes
 * the rendered step by itself (ADR-28), so auto-advance would return as a
 * decision with a behaviour behind it rather than as a key nothing reads.
 */
export const FormDefinition = z
  .object({
    formId: FormId,
    defaultLocale: LocaleCode,
    title: LocalizedText,
    steps: z.array(Step).min(1),
    rules: z.array(VisibilityRule),
  })
  .superRefine((form, ctx) => {
    const seenSteps = new Set<string>();
    const seenQuestions = new Set<string>();
    const seenGroups = new Set<string>();

    // Reaches inside groups, so a question is either repeated or not in a given
    // form and answer keying stays unambiguous under the instance-qualified key.
    const pin = (questionId: string, where: string, path: readonly (string | number)[]): void => {
      if (seenQuestions.has(questionId)) {
        addCodedIssue(
          ctx,
          "DUPLICATE_QUESTION_IN_FORM",
          `Question "${questionId}" is pinned more than once (again at ${where})`,
          [...path, "questionId"],
        );
      } else {
        seenQuestions.add(questionId);
      }
    };

    form.steps.forEach((step, stepIndex) => {
      if (seenSteps.has(step.stepId)) {
        addCodedIssue(
          ctx,
          "DUPLICATE_STEP_ID",
          `Duplicate stepId "${step.stepId}" at steps[${stepIndex}]`,
          ["steps", stepIndex, "stepId"],
        );
      } else {
        seenSteps.add(step.stepId);
      }
      step.items.forEach((item: StepItem, itemIndex) => {
        const at = ["steps", stepIndex, "items", itemIndex] as const;
        const where = `steps[${stepIndex}].items[${itemIndex}]`;
        if (!isRepeatGroup(item)) {
          pin(item.questionId, where, at);
          return;
        }
        if (seenGroups.has(item.groupId)) {
          addCodedIssue(
            ctx,
            "DUPLICATE_GROUP_ID",
            `Duplicate groupId "${item.groupId}" at steps[${stepIndex}].items[${itemIndex}]`,
            [...at, "groupId"],
          );
        } else {
          seenGroups.add(item.groupId);
        }
        item.items.forEach((member, memberIndex) => {
          pin(member.questionId, `${where}.items[${memberIndex}]`, [...at, "items", memberIndex]);
        });
      });
    });
  });
export type FormDefinition = z.infer<typeof FormDefinition>;

/**
 * Parse an unknown value as a FormDefinition, reporting every violated
 * refinement with its typed code and path rather than only the first.
 */
export function parseFormDefinition(
  value: unknown,
): Result<FormDefinition, readonly FormDefinitionError[]> {
  const result = FormDefinition.safeParse(value);
  return result.success
    ? ok(result.data)
    : err(toCodedErrors(FormDefinitionErrorCode, result.error, "INVALID_FORM_DEFINITION"));
}

export function isFormDefinition(value: unknown): value is FormDefinition {
  return FormDefinition.safeParse(value).success;
}
