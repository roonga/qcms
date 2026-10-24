import type { A2UIAnswerValue, A2UIErrors, A2UIValues } from "@roonga/qcms-ui";

import type { CommitMoment } from "./visible";

/**
 * The flow's record of what the server has said about each answer: the value it holds,
 * and the value it refused.
 *
 * Its one job is suppressing a post that would say nothing new. What makes that safe is
 * when the record is written: on the post's issue rather than its resolution, with a
 * rollback if the post is refused.
 */

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

/**
 * JSON for its shape fidelity rather than as a wire format: absence has to stay distinct
 * from every real value, and it encodes as `null`, which no real answer can collide with
 * because every string is quoted.
 *
 * A multiChoice value is a set to the kernel (ADR-21), so it is sorted before encoding,
 * or the client and the server would differ on what the same answer is. The sort is the
 * only canonicalization: this key exists to agree with what the server stores, and
 * folding together values the server keeps apart would suppress a post the ledger wants.
 */
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

/**
 * Whether focus leaving a control is a commit worth posting. Two rules, both about a
 * post having to assert something:
 *
 * - an empty `completion` control commits nothing, because a never-finished date is not
 *   an answer and the one `null` it can post is the ADR-33 retraction, which arrives
 *   through the change event once editing ends;
 * - an empty control that holds no answer commits nothing either, whatever its moment,
 *   because a retraction needs something to retract. It cost a round trip per control a
 *   respondent tabbed through, plus a 422 whenever the question was required.
 *
 * A non-empty value always commits; suppressing a redundant repeat is `isRecorded`'s job
 * in the caller.
 */
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

/**
 * Undoes an issued post's optimistic entry when the post was not accepted, without
 * which a refused value would be remembered as held and the retry deduped into silence.
 * It restores absence when the server holds nothing, because no entry is what tells a
 * `completion` clear that the question was never answered.
 *
 * Conditional, compare and swap: if the record no longer holds `key`, a newer post has
 * been issued since and this stale rollback must not clobber it.
 *
 * What it restores comes from `confirmed`, never from `record`, because only the keys
 * the server seeded or accepted were ever true. With two overlapping refusals of one
 * question, the optimistic record's predecessor is the first post's refused value.
 */
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

/**
 * A rejection message describes one value, so it is shown exactly while the field still
 * holds that value and the edit replacing it is what clears it. Clearing on the next
 * accepted post instead leaves the message up while the respondent types, and leaves it
 * up for ever when the correction restores a value the server already holds, since that
 * commit is deduped and no accepted post ever arrives.
 */
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
