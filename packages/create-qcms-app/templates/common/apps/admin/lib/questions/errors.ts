import { t, type MessageKey } from "../i18n/en.ts";

import type { DefinitionIssue } from "./types.ts";

// Render catalog remedies, never raw unknown API prose; retain the code only for diagnostics.

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
  AGENT_PROPOSAL_DRAFT: "agent.card.note.draftMoved",
  unauthorized: "questions.error.unauthorized",
  rate_limited: "questions.error.rateLimited",
  internal: "questions.error.internal",
};

export function messageForCode(code: string): string {
  const key = CODE_MESSAGES[code];
  return key === undefined ? t("questions.error.unknown", { code }) : t(key);
}

// Unknown or cross-field paths belong in the summary; no issue may be silently dropped.
export function fieldPathOf(issue: DefinitionIssue): string | undefined {
  if (issue.path === undefined || issue.path.length === 0) return undefined;
  return issue.path.join(".");
}

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

export function fieldError(
  byField: ReadonlyMap<string, DefinitionIssue[]>,
  field: string,
): string | undefined {
  return byField.get(field)?.[0]?.message;
}

// Omit optional props rather than assigning undefined under exactOptionalPropertyTypes.
// Keep errorMessage with isInvalid so React Aria marks and describes the invalid field.
export function fieldErrorProps(
  byField: ReadonlyMap<string, DefinitionIssue[]>,
  field: string,
): { isInvalid?: boolean; errorMessage?: string } {
  const message = fieldError(byField, field);
  return message === undefined ? {} : { isInvalid: true, errorMessage: message };
}

// Omit genuinely absent configuration props. Controlled value props need null rather than omission.
export function optionalProp<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

// Keep unfamiliar error paths in the summary so newer kernel refusals remain visible in an older editor.
export function unplacedIssues(
  issues: readonly DefinitionIssue[],
  rendered: ReadonlySet<string>,
): readonly DefinitionIssue[] {
  return issues.filter((issue) => {
    const field = fieldPathOf(issue);
    return field === undefined || !rendered.has(field);
  });
}
