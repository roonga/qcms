import type { A2UIAnswerValue, A2UIErrors, A2UIValues } from "@roonga/qcms-ui";

/**
 * The flow's record of what the server has said about each answer: the value it
 * holds, and the value it refused (issue #122).
 *
 * Both halves are decision rules rather than rendering, and both are wrong in
 * ways that are invisible on screen, so they live here as pure functions the
 * `answer-record.test.ts` slice can drive through whole sequences: `step-flow.tsx`
 * holds the record in a ref, replaces it through these functions, and derives the
 * displayed field errors from them.
 *
 * The record's one job is suppressing a post that would say nothing new: a
 * control that committed on change must not re-post the identical value when
 * focus later leaves it, and a resumed control must not post a `null` retraction
 * of an answer the respondent never touched (issue #146). What makes that safe is
 * WHEN the record is written: on the post's ISSUE, not on its resolution, with a
 * rollback if the post is refused (see `withIssued` / `withRollback`).
 */

/**
 * What the server holds, per question, as a comparable key. A record entry is
 * absent when the question has no stored answer; the key `"null"` means the
 * server holds an explicit retraction (ADR-33), which is a different state.
 */
export type PostedRecord = Readonly<Record<string, string | undefined>>;

/** One question's refused answer: the message to show, and the value refused. */
export interface RejectedAnswer {
  readonly message: string;
  /** The `answerKey` of the value the server rejected. */
  readonly key: string;
}

/** Every question whose last post was refused, keyed by questionId. */
export type RejectedAnswers = Readonly<Record<string, RejectedAnswer | undefined>>;

/**
 * One answer value as a comparable key.
 *
 * JSON is used for its shape fidelity, not as a wire format: absence must stay
 * distinct from every real value (issue #98 settled that an emptied control means
 * absence, and #95 made that a tombstone append), and a multiChoice selection has
 * to compare element-wise. Absence encodes as `null` - the same body the
 * retraction posts - and no real `A2UIAnswerValue` can collide with it, because
 * every string is quoted: the shortText answer `"null"` encodes as `"\"null\""`.
 */
export function answerKey(value: A2UIAnswerValue | undefined): string {
  return JSON.stringify(value ?? null);
}

/**
 * The record for a set of answers the server holds, in `answerKey` encoding.
 *
 * Seeding this alongside the displayed values is what makes a resumed control
 * inert until the respondent actually changes something (issue #146): without it,
 * focus entering and leaving an untouched control looked like a fresh commit of
 * an emptied field and posted a `null` retraction of an answer the server
 * legitimately held. It also restores the other direction: a resumed `completion`
 * control (the date) whose value the respondent clears is only recognisable as
 * retracting a *previously answered* question by comparing against this record.
 */
export function recordedAnswers(held: A2UIValues): PostedRecord {
  const recorded: Record<string, string> = {};
  for (const [questionId, value] of Object.entries(held)) {
    recorded[questionId] = answerKey(value);
  }
  return recorded;
}

/**
 * The record updated with the answers a freshly served step reports the server
 * holding. Merged over, never swapped in: a question the response carries is the
 * ledger's word on it, and one it does not carry leaves the existing entry alone,
 * so a value this client posted on another step is not forgotten.
 */
export function withServerHeld(record: PostedRecord, held: A2UIValues): PostedRecord {
  return { ...record, ...recordedAnswers(held) };
}

/**
 * Whether this exact value is already recorded for this question, so committing
 * it would be a redundant append. True also while a post carrying it is still in
 * flight, which is the point: `withIssued` records at issue time.
 */
export function isRecorded(
  record: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
): boolean {
  return record[name] === answerKey(value);
}

/**
 * Whether the server is known to hold a real answer for this question, as opposed
 * to no answer at all or an explicit retraction. What separates a `completion`
 * control's clear that RETRACTS a stored answer (post it) from a never-answered
 * control the respondent left empty (post nothing) - ADR-31 amended x ADR-33.
 */
export function holdsAnswer(record: PostedRecord, name: string): boolean {
  const key = record[name];
  return key !== undefined && key !== answerKey(undefined);
}

/**
 * The record with this question's value marked as posted, called when the post is
 * ISSUED (issue #122).
 *
 * Recording on resolution left a window in which the answer was in flight and the
 * record still held the previous value, so a blur arriving inside it re-posted the
 * same answer: two appends for one gesture, and a second `busy` flip racing the
 * Continue guard. That window is reachable from an ordinary gesture since ADR-31
 * made boolean and singleChoice commit on `change` - the selection issues the
 * post, and the respondent's hand is already moving to Continue.
 */
export function withIssued(
  record: PostedRecord,
  name: string,
  value: A2UIAnswerValue | undefined,
): PostedRecord {
  return { ...record, [name]: answerKey(value) };
}

/**
 * The record with an issued post's optimistic entry undone, called when that post
 * was NOT accepted.
 *
 * Without this, recording on issue would be worse than recording on resolution: a
 * refused value would be remembered as held, and the respondent could never retry
 * it (the retry would be deduped into silence, which matters the moment the same
 * body could succeed later - a transient failure, a changed constraint). Restoring
 * `previous` also has to restore ABSENCE when there was none, because "no entry"
 * is what tells a `completion` clear that the question was never answered.
 *
 * The rollback is conditional (compare and swap): if the record no longer holds
 * `key`, a newer post for this question has been issued since and its entry is the
 * current truth, so this stale rollback must not clobber it.
 */
export function withRollback(
  record: PostedRecord,
  name: string,
  key: string,
  previous: string | undefined,
): PostedRecord {
  if (record[name] !== key) return record;
  const next = { ...record };
  if (previous === undefined) delete next[name];
  else next[name] = previous;
  return next;
}

/** No field errors: one frozen object, so an error-free render is referentially stable. */
const NO_ERRORS: A2UIErrors = Object.freeze({});

/**
 * The field errors to display, derived from the refusals and the values on screen
 * (issue #122).
 *
 * A rejection message describes ONE value: the one the server refused. So it is
 * shown exactly while the field still holds that value, and the edit that replaces
 * the value is what clears it. The alternative - clearing on the next accepted post
 * - leaves the message up while the respondent types the correction, and leaves it
 * up forever when the correction restores the value the server already holds,
 * because that commit is deduped and no accepted post for the field ever arrives.
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

/** The refusals with this question's entry dropped (its post was accepted). */
export function withoutRejection(rejected: RejectedAnswers, name: string): RejectedAnswers {
  if (rejected[name] === undefined) return rejected;
  const next = { ...rejected };
  delete next[name];
  return next;
}

/** The refusals with this question's post recorded as refused. */
export function withRejection(
  rejected: RejectedAnswers,
  name: string,
  value: A2UIAnswerValue | undefined,
  message: string,
): RejectedAnswers {
  return { ...rejected, [name]: { message, key: answerKey(value) } };
}
