import type { A2UIAnswerValue, A2UIErrors, A2UIValues } from "@roonga/qcms-ui";

import type { CommitMoment } from "./visible";

/**
 * An absent entry means the question has no stored answer; the key `"null"` means the
 * server holds an explicit retraction (ADR-33), which is a different state.
 */
export type PostedRecord = Readonly<Record<string, string | undefined>>;

export interface RejectedAnswer {
  readonly message: string;
  /** The `answerKey` of the value the server rejected. */
  readonly key: string;
}

export type RejectedAnswers = Readonly<Record<string, RejectedAnswer | undefined>>;

export function answerKey(value: A2UIAnswerValue | undefined): string {
  // Sorted into a copy: `value` is the value currently rendered in the control, and
  // sorting in place would reorder the respondent's selection.
  if (isSelection(value)) return JSON.stringify([...value].sort());
  return JSON.stringify(value ?? null);
}

/**
 * A predicate rather than a bare `Array.isArray`, which narrows a `readonly string[]`
 * member to `any[]`, and spreading that is an unchecked `any` the lint rules refuse.
 */
function isSelection(value: A2UIAnswerValue | undefined): value is readonly string[] {
  return Array.isArray(value);
}

/**
 * Seeding this alongside the displayed values is what makes a resumed control inert
 * until the respondent changes something: without it, focus entering and leaving an
 * untouched control posts a `null` retraction of an answer the server legitimately
 * holds. It also makes a resumed control's clear recognisable as a retraction.
 */
export function recordedAnswers(held: A2UIValues): PostedRecord {
  const recorded: Record<string, string> = {};
  for (const [questionId, value] of Object.entries(held)) {
    recorded[questionId] = answerKey(value);
  }
  return recorded;
}

/**
 * Merged over, never swapped in: a question the response does not carry leaves its
 * existing entry alone, so a value this client posted on another step is not forgotten.
 */
export function withServerHeld(record: PostedRecord, held: A2UIValues): PostedRecord {
  return { ...record, ...recordedAnswers(held) };
}

/**
 * True also while a post carrying the value is still in flight, which is the point:
 * `withIssued` records at issue time.
 */
export function isRecorded(
  record: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
): boolean {
  return record[name] === answerKey(value);
}

/**
 * A real answer, as opposed to no answer at all or an explicit retraction. It is what
 * separates a clear that retracts a stored answer, which posts, from a never-answered
 * control the respondent left empty, which does not (ADR-33).
 */
export function holdsAnswer(record: PostedRecord, name: string): boolean {
  const key = record[name];
  return key !== undefined && key !== answerKey(undefined);
}

export function commitsOnFocusExit(
  record: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
  moment: CommitMoment,
): boolean {
  if (value !== undefined) return true;
  if (moment === "completion") return false;
  return holdsAnswer(record, name);
}

/**
 * Called when the post is issued. Recording on resolution instead left a window in which
 * the answer was in flight and the record still held the previous value, so a blur
 * arriving inside it re-posted the same answer; an ordinary gesture reaches it, because
 * a selection issues its post while the respondent's hand is already moving to Continue.
 */
export function withIssued(
  record: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
): PostedRecord {
  return { ...record, [name]: answerKey(value) };
}

/**
 * Identical arithmetic to `withIssued`, kept as its own name because the two write
 * different records: that one the optimistic record that dedupes posts, this one the
 * confirmed record `withRollback` restores from.
 */
export function withConfirmed(
  confirmed: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
): PostedRecord {
  return { ...confirmed, [name]: answerKey(value) };
}

export function withRollback(
  record: PostedRecord,
  confirmed: PostedRecord,
  name: string,
  key: string,
): PostedRecord {
  if (record[name] !== key) return record;
  const previous = confirmed[name];
  const next = { ...record };
  if (previous === undefined) delete next[name];
  else next[name] = previous;
  return next;
}

// One frozen object, so an error-free render is referentially stable.
const NO_ERRORS: A2UIErrors = Object.freeze({});

export function visibleErrors(rejected: RejectedAnswers, values: A2UIValues): A2UIErrors {
  let shown: Record<string, string> | undefined;
  for (const [questionId, entry] of Object.entries(rejected)) {
    if (entry === undefined || answerKey(values[questionId]) !== entry.key) continue;
    shown ??= {};
    shown[questionId] = entry.message;
  }
  return shown ?? NO_ERRORS;
}

export function withoutRejection(rejected: RejectedAnswers, name: string): RejectedAnswers {
  if (rejected[name] === undefined) return rejected;
  const next = { ...rejected };
  delete next[name];
  return next;
}

export function withRejection(
  rejected: RejectedAnswers,
  name: string,
  value: A2UIAnswerValue | undefined,
  message: string,
): RejectedAnswers {
  return { ...rejected, [name]: { message, key: answerKey(value) } };
}
