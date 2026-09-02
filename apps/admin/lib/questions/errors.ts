import { t, type MessageKey } from "../i18n/en.ts";

import type { DefinitionIssue } from "./types.ts";

/**
 * Turning the API's failures into something an author can act on (task 032).
 *
 * The API answers in codes (`VERSION_IMMUTABLE`, `QUESTION_ID_REUSED`) because a code is
 * a stable contract and a sentence is not. The screen's job is the other half: say what
 * happened **and what the rule is**, because every one of these codes exists to enforce a
 * governance rule the author is allowed not to have memorised. "This version is
 * published" on its own reads as a bug; "published versions are frozen, create version
 * N+1 to change it" teaches the model.
 *
 * Anything unrecognised falls back to a generic sentence rather than rendering the raw
 * code: a new API code must not be able to put machine text in front of a human, and the
 * `code` is still shown in small print so a bug report can name it.
 */

/** Codes the questions slice raises, mapped to the sentence that explains the rule. */
const CODE_MESSAGES: Readonly<Record<string, MessageKey>> = {
  INVALID_QUESTION_ID: "questions.error.invalidId",
  INVALID_QUESTION_DEFINITION: "questions.error.invalidDefinition",
  QUESTION_ID_MISMATCH: "questions.error.idMismatch",
  QUESTION_ID_REUSED: "questions.error.idReused",
  SLUG_TAKEN: "questions.error.slugTaken",
  QUESTION_NOT_FOUND: "questions.error.notFound",
  VERSION_NOT_FOUND: "questions.error.versionNotFound",
  VERSION_IMMUTABLE: "questions.error.versionImmutable",
  INVALID_VERSION_STATE: "questions.error.invalidVersionState",
  unauthorized: "questions.error.unauthorized",
  rate_limited: "questions.error.rateLimited",
  internal: "questions.error.internal",
};

/** The human sentence for one API error code. */
export function messageForCode(code: string): string {
  const key = CODE_MESSAGES[code];
  return key === undefined ? t("questions.error.unknown", { code }) : t(key);
}

/**
 * The editor field an issue belongs to, as a dotted path.
 *
 * The kernel addresses its issues by domain path, which is exactly the addressing the
 * editor lays its fields out on, so the mapping is a join rather than a table. An issue
 * whose path names something with no field of its own (a cross-field rule reported at
 * the object, or a path the editor does not render) returns `undefined` and is shown in
 * the summary instead - never dropped.
 */
export function fieldPathOf(issue: DefinitionIssue): string | undefined {
  if (issue.path === undefined || issue.path.length === 0) return undefined;
  return issue.path.join(".");
}

/** Index issues by field path, so a field can ask "is there an error on me?". */
export function issuesByField(
  issues: readonly DefinitionIssue[],
): ReadonlyMap<string, DefinitionIssue[]> {
  const byField = new Map<string, DefinitionIssue[]>();
  for (const issue of issues) {
    const field = fieldPathOf(issue);
    if (field === undefined) continue;
    const existing = byField.get(field);
    if (existing === undefined) byField.set(field, [issue]);
    else existing.push(issue);
  }
  return byField;
}

/** The first message for a field, ready to hand to a control's `errorMessage`. */
export function fieldError(
  byField: ReadonlyMap<string, DefinitionIssue[]>,
  field: string,
): string | undefined {
  return byField.get(field)?.[0]?.message;
}

/**
 * The `isInvalid` / `errorMessage` pair for a field, as props to spread.
 *
 * Spread rather than passed, because the repo runs with `exactOptionalPropertyTypes` and
 * the vendored controls declare `errorMessage?: string`: handing one an explicit
 * `undefined` is a type error, not a no-op. Returning `{}` when there is nothing to say
 * is the idiom that satisfies it, and doing it here means the editor's call sites stay
 * readable instead of carrying a ternary each.
 *
 * The two always travel together on purpose. `errorMessage` without `isInvalid` renders
 * a message the control does not consider itself in error about, so react-aria wires no
 * `aria-invalid` and a screen reader announces a normal field with some extra text next
 * to it. The screen contract's a11y note ("validation errors `aria-describedby`-linked") is
 * what this pairing delivers.
 */
export function fieldErrorProps(
  byField: ReadonlyMap<string, DefinitionIssue[]>,
  field: string,
): { isInvalid?: boolean; errorMessage?: string } {
  const message = fieldError(byField, field);
  return message === undefined ? {} : { isInvalid: true, errorMessage: message };
}

/**
 * One optional prop, present only when it has a value.
 *
 * Same `exactOptionalPropertyTypes` reason as `fieldErrorProps`: under that flag an
 * optional prop and a prop explicitly set to `undefined` are different types, so a value
 * that is genuinely absent has to be an omitted key rather than an explicit `undefined`.
 *
 * This used to carry the date constraints' `value` too, on the grounds that an omitted
 * prop was the only way to say "no bound set" to a control whose `value` was typed
 * `string`. That reason is gone: issues #148 and #549 widened the vendored controls to
 * `string | null`, so `null` says it directly and keeps the control CONTROLLED, which an
 * omitted prop never did (see `constraints-editor.tsx`). Reach for `null` before reaching
 * for this helper on any react-aria value prop; what is left here is genuinely optional
 * configuration like `step`.
 */
export function optionalProp<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

/**
 * Issues that no rendered field will show, so the summary has to.
 *
 * Exit criterion 1 is "every error surfaced somewhere readable", and this is the half
 * that makes it hold for codes nobody anticipated: an issue at an unknown path still
 * reaches the author, just at the top of the form rather than beside a control.
 */
export function unplacedIssues(
  issues: readonly DefinitionIssue[],
  rendered: ReadonlySet<string>,
): readonly DefinitionIssue[] {
  return issues.filter((issue) => {
    const field = fieldPathOf(issue);
    return field === undefined || !rendered.has(field);
  });
}
