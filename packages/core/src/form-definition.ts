import { z } from "zod";

import { QcmsError, err, ok, type Result } from "./errors.js";
import { FormId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";
import { LocaleCode, LocalizedText } from "./localized-text.js";
import { isRepeatGroup, Step, type StepItem } from "./step.js";
import { VisibilityRule } from "./visibility-rule.js";

/**
 * Form definitions (task 004, DOMAIN_SCHEMA §2.3, ADR-02, ADR-11).
 *
 * A form is ordered steps of pinned question references plus visibility
 * rules. Pins are `{questionId, version}` pairs - question-level versioning
 * (ADR-02) with launch-minimal UX (manual pinning): drafts may float,
 * snapshots never do.
 *
 * Parsing enforces *parse-level* refinements only: unique `stepId`s, a
 * question pinned at most once per form, and every rule entry being valid
 * under the rules DSL (task 005, `visibility-rule.ts` - including the
 * condition nesting-depth cap, RULE_DEPTH_EXCEEDED). Cross-entity publish
 * invariants (dangling refs, locale completeness, rule graph checks) are
 * task 008's `compileDraft`.
 */

/**
 * Closed union of typed error codes for form-definition parsing. Validators
 * are all-errors-not-first (CONTRIBUTING): a parse failure carries every
 * issue, each with its code and path. The duplicate codes and
 * RULE_DEPTH_EXCEEDED are shared strings with `PublishErrorCode` -
 * `compileDraft` (008) surfaces the same violations verbatim in its publish
 * report when handed a raw draft.
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

/** Module-typed wrapper over the shared coded-issue plumbing: only members of
 * FormDefinitionErrorCode can be attached here (typos are compile errors). */
function addCodedIssue(
  ctx: z.core.$RefinementCtx,
  code: FormDefinitionErrorCode,
  message: string,
  path: readonly (string | number)[],
): void {
  addSharedCodedIssue(ctx, code, message, path);
}

/**
 * `QuestionRef` and `Step` moved to `step.ts` in task 071, where the repeating
 * group that may now sit in a step's item list lives beside them. They are
 * re-exported here so every existing importer of this module is unaffected.
 */
export { QuestionRef, Step } from "./step.js";

/**
 * The form aggregate (DOMAIN_SCHEMA §2.3). Parse-level refinements: unique
 * `stepId`s and a `questionId` pinned at most once across all steps -
 * duplicates make rule targeting and answer keying ambiguous, so they are
 * malformed input, not merely unpublishable.
 *
 * There is no per-form navigation escape here. Task 045 reserved an unhonored
 * `advanceOnComplete` boolean and the Code Owner removed it on 2026-08-31
 * (ADR-28, issue #725): "answering never changes the rendered step by itself"
 * is the contract, and auto-advance returns as a decision with a behaviour
 * behind it rather than as a key nothing reads. Nothing carried the field, and
 * this object strips unknown keys rather than rejecting them, so a document
 * that somehow holds the old key still parses.
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

    /** One pinned question, wherever it sits: a step's item list or a group's.
     * `DUPLICATE_QUESTION_IN_FORM` reaches inside groups (ADR-42), so a
     * question is either repeated or not in a given form and the refinement's
     * stated reason - unambiguous answer keying - holds under the instance-
     * qualified key exactly as it did under the bare one. */
    const pin = (
      questionId: string,
      where: string,
      path: readonly (string | number)[],
    ): void => {
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
 * Parse an unknown value as a FormDefinition. All-errors-not-first: every
 * violated refinement is reported, each with its typed code and path.
 * Structural failures carry INVALID_FORM_DEFINITION.
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
