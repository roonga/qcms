import { z } from "zod";

import { QcmsError, err, ok, type Result } from "./errors.js";
import { FormId, QuestionId, StepId } from "./ids.js";
import { addCodedIssue as addSharedCodedIssue, toCodedErrors } from "./internal/coded-issues.js";
import { LocaleCode, LocalizedText } from "./localized-text.js";

/**
 * Form definitions (task 004, DOMAIN_SCHEMA §2.3, ADR-02, ADR-11).
 *
 * A form is ordered steps of pinned question references plus visibility
 * rules. Pins are `{questionId, version}` pairs — question-level versioning
 * (ADR-02) with launch-minimal UX (manual pinning): drafts may float,
 * snapshots never do.
 *
 * Parsing enforces *parse-level* refinements only: unique `stepId`s, a
 * question pinned at most once per form, and the rules array being present.
 * Rule content is deliberately opaque here — the rules DSL schema is task
 * 005, and cross-entity publish invariants (dangling refs, locale
 * completeness, rule graph checks) are task 008's `compileDraft`.
 */

/**
 * Closed union of typed error codes for form-definition parsing. Validators
 * are all-errors-not-first (CONTRIBUTING): a parse failure carries every
 * issue, each with its code and path. The duplicate codes are shared strings
 * with `PublishErrorCode` — `compileDraft` (008) surfaces the same violations
 * verbatim in its publish report when handed a raw draft.
 */
export const FormDefinitionErrorCode = z.enum([
  "INVALID_FORM_DEFINITION",
  "DUPLICATE_STEP_ID",
  "DUPLICATE_QUESTION_IN_FORM",
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
 * A pinned reference to a question version (ADR-02). The pair is the whole
 * point: a snapshot freezes exactly which content each questionId had.
 * Whether the pin resolves (question exists, version published) is a publish
 * invariant (008), not a parse concern.
 */
export const QuestionRef = z.object({
  questionId: QuestionId,
  version: z.number().int().positive(),
});
export type QuestionRef = z.infer<typeof QuestionRef>;

export const Step = z.object({
  stepId: StepId,
  title: LocalizedText,
  items: z.array(QuestionRef).min(1),
});
export type Step = z.infer<typeof Step>;

/**
 * Placeholder for the rules DSL (DOMAIN_SCHEMA §3). Rule entries pass
 * through parsing opaque and unvalidated at this stage — parse only
 * guarantees the `rules` array is present. Task 005 replaces this with the
 * closed condition language; task 008 validates rule content at publish.
 */
export const VisibilityRule = z.unknown();
export type VisibilityRule = z.infer<typeof VisibilityRule>;

/**
 * The form aggregate (DOMAIN_SCHEMA §2.3). Parse-level refinements: unique
 * `stepId`s and a `questionId` pinned at most once across all steps —
 * duplicates make rule targeting and answer keying ambiguous, so they are
 * malformed input, not merely unpublishable.
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
      step.items.forEach((item, itemIndex) => {
        if (seenQuestions.has(item.questionId)) {
          addCodedIssue(
            ctx,
            "DUPLICATE_QUESTION_IN_FORM",
            `Question "${item.questionId}" is pinned more than once (again at steps[${stepIndex}].items[${itemIndex}])`,
            ["steps", stepIndex, "items", itemIndex, "questionId"],
          );
        } else {
          seenQuestions.add(item.questionId);
        }
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
