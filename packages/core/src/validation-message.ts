import { z } from "zod";

import { LocalizedText } from "./localized-text.js";

/**
 * Author-supplied validation messages (task 048, ADR-32).
 *
 * A question author may decorate each constraint their question carries with a
 * message of their own wording. The messages are **presentation payload only**:
 * the kernel and API stay the validation authority and keep emitting the stable
 * {@link ValidationErrorCode} / {@link ValidationConstraint} pair
 * (`validate-answer.ts`); nothing here is ever evaluated, only rendered.
 *
 * The fallback is defined at the *edit* level (ADR-32): the authoring editor
 * shows the portal's default message as the field's placeholder and a blank
 * field means "inherit the default", so a form is publishable with zero
 * message-authoring effort and an override is always a conscious act. That is
 * why there is no "default" entry anywhere in this module: an absent key IS the
 * inheritance.
 */

/**
 * The closed set of constraint keys an author may decorate (ADR-32: "required,
 * pattern, length/value bounds, date range - the schema's closed constraint
 * set").
 *
 * These are the constraints an author *writes on the definition*, which is why
 * the set is not simply {@link ValidationConstraint}:
 *
 * - `required` is here but is not a `ValidationConstraint` at all: presence is a
 *   flow concern checked by `prepareSubmission`, never by `validateAnswer`.
 * - `encoding` and `options` are `ValidationConstraint`s but are **not** here:
 *   they report a value that is not a legal answer of the question's type at all
 *   (malformed encoding, an optionId the question does not declare). No author
 *   wrote a constraint to produce them, so there is nothing to decorate, and a
 *   respondent can only reach them by bypassing the control.
 *
 * `validation-message.test.ts` pins that relationship so the two enums cannot
 * drift apart silently.
 */
export const ValidationMessageKey = z.enum([
  "required",
  "minLength",
  "maxLength",
  "pattern",
  "min",
  "max",
  "integer",
  "minSelected",
  "maxSelected",
]);
export type ValidationMessageKey = z.infer<typeof ValidationMessageKey>;

/**
 * The canonical key order. Every projection of a message map (the compiler's
 * control-node prop, publish reports) iterates THIS array rather than the
 * authored object's own key order, so the compiled document is a deterministic
 * function of content and not of the order an editor happened to write the JSON
 * in (ADR-18: the stored compiled document is byte-compared by the golden
 * corpus).
 */
export const VALIDATION_MESSAGE_KEYS: readonly ValidationMessageKey[] =
  ValidationMessageKey.options;

/**
 * The optional per-constraint message map on a question definition: a partial
 * map from constraint key to {@link LocalizedText}. Unknown keys are rejected,
 * so a typo is a parse error rather than a message that silently never shows;
 * an absent key means "inherit the portal default".
 *
 * Locale completeness is a publish concern, not a parse one (invariant I3): a
 * message missing the form's `defaultLocale` is reported as `LOCALE_INCOMPLETE`
 * by `compileDraft`, exactly like a label or an option.
 *
 * `partialRecord`, not `record`: a `z.record` over an enum key is **exhaustive**
 * in Zod 4 (every member required), which would make "author one message" mean
 * "author all nine".
 */
export const ValidationMessages = z.partialRecord(ValidationMessageKey, LocalizedText);
export type ValidationMessages = z.infer<typeof ValidationMessages>;
